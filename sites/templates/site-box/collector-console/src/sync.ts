import fs from "fs";
import path from "path";
import { readConfig } from "./config";
import { regenerateAlloyConfig, reloadAlloy } from "./alloy";

export type SyncResult = {
  ok: boolean;
  httpCode?: number;
  message: string;
  deviceCount?: number;
  changed: boolean;
  at: string;
  alloyReloaded?: boolean;
};

let lastSync: SyncResult | null = null;
let syncInFlight = false;

export function getLastSync(): SyncResult | null {
  return lastSync;
}

function etagPath(dataDir: string): string {
  return path.join(dataDir, ".devices.etag");
}

function devicesPath(dataDir: string): string {
  return path.join(dataDir, "devices.json");
}

function configAlloyPath(dataDir: string): string {
  return path.join(dataDir, "config.alloy");
}

function readLocalDevices(dataDir: string): Array<{ id?: string; snmpIp?: string }> {
  const file = devicesPath(dataDir);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** True if config.alloy is missing SNMP exporter or any device id from devices.json. */
export function alloySnmpConfigStale(dataDir: string): boolean {
  const devices = readLocalDevices(dataDir).filter((d) => d.id && d.snmpIp);
  const alloyFile = configAlloyPath(dataDir);
  if (!fs.existsSync(alloyFile)) return devices.length > 0;

  const alloy = fs.readFileSync(alloyFile, "utf8");
  if (devices.length === 0) {
    // No SNMP devices — stale only if an old SNMP block is harmless; no reload required
    return false;
  }
  if (!alloy.includes("prometheus.exporter.snmp")) return true;
  for (const d of devices) {
    const id = d.id!;
    // generate-config embeds: device = "<id>"
    if (!alloy.includes(`device = "${id}"`)) return true;
  }
  return false;
}

/**
 * Ensure config.alloy matches devices.json and Alloy has reloaded.
 * Fixes the case where inventory is synced but SNMP block was never applied
 * (304 / content-identical short-circuit, or Dokploy patch overwrote config.alloy).
 */
export async function ensureAlloySnmpApplied(
  dataDir: string,
  force = false
): Promise<{ reloaded: boolean; message: string }> {
  const stale = force || alloySnmpConfigStale(dataDir);
  if (!stale) {
    return { reloaded: false, message: "Alloy SNMP config already matches devices.json" };
  }

  const genMsg = await regenerateAlloyConfig();
  const reloadMsg = await reloadAlloy({ forceRecreate: false });
  return {
    reloaded: true,
    message: `${genMsg}; ${reloadMsg}`
  };
}

export async function syncDevices(
  dataDir: string,
  opts?: { forceAlloyReload?: boolean }
): Promise<SyncResult> {
  if (syncInFlight) {
    return {
      ok: false,
      message: "Sync already in progress",
      changed: false,
      at: new Date().toISOString()
    };
  }

  syncInFlight = true;
  const at = new Date().toISOString();
  const forceAlloyReload = opts?.forceAlloyReload === true;

  try {
    const config = readConfig();
    if (!config.nocApiUrl || !config.siteName || !config.collectorToken) {
      const result: SyncResult = {
        ok: false,
        message: "Missing NOC_API_URL, SITE_NAME, or COLLECTOR_TOKEN",
        changed: false,
        at
      };
      lastSync = result;
      return result;
    }

    const url = `${config.nocApiUrl.replace(/\/$/, "")}/api/collector/${config.siteName}/devices.json`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.collectorToken}`,
      Accept: "application/json"
    };

    const etagFile = etagPath(dataDir);
    // Force full body when we need to re-apply Alloy SNMP
    if (!forceAlloyReload && fs.existsSync(etagFile) && !alloySnmpConfigStale(dataDir)) {
      headers["If-None-Match"] = fs.readFileSync(etagFile, "utf8").trim();
    }

    const res = await fetch(url, { headers });
    const httpCode = res.status;
    let inventoryChanged = false;
    let deviceCount = 0;

    if (httpCode === 304) {
      deviceCount = readLocalDevices(dataDir).length;
    } else if (httpCode !== 200) {
      const body = await res.text();
      const result: SyncResult = {
        ok: false,
        httpCode,
        message: `Fetch failed HTTP ${httpCode}: ${body.slice(0, 200)}`,
        changed: false,
        at
      };
      lastSync = result;
      return result;
    } else {
      const etag = res.headers.get("etag");
      if (etag) {
        fs.writeFileSync(etagFile, etag, "utf8");
      }

      const body = await res.text();
      const devicesFile = devicesPath(dataDir);

      if (fs.existsSync(devicesFile)) {
        try {
          inventoryChanged = !fs.readFileSync(devicesFile).equals(Buffer.from(body));
        } catch {
          inventoryChanged = true;
        }
      } else {
        inventoryChanged = true;
      }

      if (inventoryChanged) {
        fs.writeFileSync(devicesFile, body, "utf8");
      }

      try {
        const devices = JSON.parse(body);
        deviceCount = Array.isArray(devices) ? devices.length : 0;
      } catch {
        deviceCount = 0;
      }
    }

    // Always ensure Alloy SNMP targets match devices.json (even on 304 / identical)
    const ensure = await ensureAlloySnmpApplied(dataDir, forceAlloyReload || inventoryChanged);

    const parts: string[] = [];
    if (httpCode === 304) parts.push("Inventory unchanged (304)");
    else if (!inventoryChanged) parts.push("Inventory content identical");
    else parts.push(`Synced ${deviceCount} device(s)`);
    parts.push(ensure.message);

    const result: SyncResult = {
      ok: true,
      httpCode,
      message: parts.join(" — "),
      deviceCount,
      changed: inventoryChanged || ensure.reloaded,
      alloyReloaded: ensure.reloaded,
      at
    };
    lastSync = result;
    return result;
  } catch (err) {
    const result: SyncResult = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      changed: false,
      at
    };
    lastSync = result;
    return result;
  } finally {
    syncInFlight = false;
  }
}

export function startSyncLoop(dataDir: string): void {
  const config = readConfig();
  const intervalSec = Number(config.syncIntervalSec || process.env.SYNC_INTERVAL_SEC || "90");
  const ms = Math.max(30, intervalSec) * 1000;

  const tick = () => {
    void syncDevices(dataDir).catch(() => undefined);
  };

  setTimeout(tick, 5000);
  setInterval(tick, ms);
}
