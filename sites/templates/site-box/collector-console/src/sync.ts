import fs from "fs";
import path from "path";
import { dataDir, readConfig, stateDir, writeDevicesJson } from "./config";
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

function etagPath(): string {
  return path.join(stateDir(), ".devices.etag");
}

function devicesPath(): string {
  return path.join(stateDir(), "devices.json");
}

function configAlloyPath(): string {
  return path.join(dataDir(), "config.alloy");
}

function readLocalDevices(): Array<{ id?: string; snmpIp?: string }> {
  const file = devicesPath();
  const fallback = path.join(dataDir(), "devices.json");
  const use = fs.existsSync(file) ? file : fallback;
  if (!fs.existsSync(use)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(use, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** True if config.alloy is missing SNMP exporter or any device id from devices.json. */
export function alloySnmpConfigStale(_dataDir?: string): boolean {
  const devices = readLocalDevices().filter((d) => d.id && d.snmpIp);
  const alloyFile = configAlloyPath();
  if (!fs.existsSync(alloyFile)) return devices.length > 0;

  const alloy = fs.readFileSync(alloyFile, "utf8");
  if (devices.length === 0) return false;
  if (!alloy.includes("prometheus.exporter.snmp")) return true;
  for (const d of devices) {
    if (!alloy.includes(`device = "${d.id}"`)) return true;
  }
  return false;
}

export async function ensureAlloySnmpApplied(
  _dataDir?: string,
  force = false
): Promise<{ reloaded: boolean; message: string }> {
  const stale = force || alloySnmpConfigStale();
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
  _dataDir?: string,
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

    const etagFile = etagPath();
    if (!forceAlloyReload && fs.existsSync(etagFile) && !alloySnmpConfigStale()) {
      headers["If-None-Match"] = fs.readFileSync(etagFile, "utf8").trim();
    }

    const res = await fetch(url, { headers });
    const httpCode = res.status;
    let inventoryChanged = false;
    let deviceCount = 0;

    if (httpCode === 304) {
      deviceCount = readLocalDevices().length;
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
      const existingPath = fs.existsSync(devicesPath())
        ? devicesPath()
        : path.join(dataDir(), "devices.json");

      if (fs.existsSync(existingPath)) {
        try {
          inventoryChanged = !fs.readFileSync(existingPath).equals(Buffer.from(body));
        } catch {
          inventoryChanged = true;
        }
      } else {
        inventoryChanged = true;
      }

      if (inventoryChanged) {
        writeDevicesJson(body.endsWith("\n") ? body : body + "\n");
      }

      try {
        const devices = JSON.parse(body);
        deviceCount = Array.isArray(devices) ? devices.length : 0;
      } catch {
        deviceCount = 0;
      }
    }

    const ensure = await ensureAlloySnmpApplied(undefined, forceAlloyReload || inventoryChanged);

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

export function startSyncLoop(_dataDir?: string): void {
  const config = readConfig();
  const intervalSec = Number(config.syncIntervalSec || process.env.SYNC_INTERVAL_SEC || "90");
  const ms = Math.max(30, intervalSec) * 1000;

  const tick = () => {
    void syncDevices().catch(() => undefined);
  };

  setTimeout(tick, 5000);
  setInterval(tick, ms);
}
