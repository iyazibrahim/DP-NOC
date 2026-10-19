import fs from "fs";
import path from "path";
import { dataDir, readConfig, stateDir, writeDevicesJson, bundledToolkitDir } from "./config";
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

function readLocalDevices(): Array<{ id?: string; snmpIp?: string; type?: string; vendor?: string }> {
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

/**
 * Vendor-pack strings that mean the image snmp.yml is newer than the volume copy.
 * Keep in sync with generate-config.sh MODULE_MARKERS.
 */
export const SNMP_MODULE_MARKERS = [
  "synology_health",
  "cambium_clients",
  "omada_clients",
  "cambiumClientInfo",
  "cambiumClientSNR",
  "cambiumClientTxDataBytes",
  "omadaClientInfo",
  "noc-snmp-no-lookups"
] as const;

/** Marker checks use the modules block only. Header comments are stripped on regenerate. */
function modulesSection(text: string): string {
  const idx = text.search(/(^|\n)modules:/);
  return idx === -1 ? text : text.slice(text.indexOf("modules:", idx));
}

export function snmpModulesNewerInBundled(bundled: string, live: string): string | null {
  const bundledModules = modulesSection(bundled);
  const liveModules = modulesSection(live);
  for (const m of SNMP_MODULE_MARKERS) {
    if (bundledModules.includes(m) && !liveModules.includes(m)) return m;
  }
  return null;
}

export type SnmpStaleReason =
  | { code: "missing_alloy"; detail: string }
  | { code: "missing_snmp_block"; detail: string }
  | { code: "missing_device"; detail: string }
  | { code: "stale_snmp_yml"; detail: string }
  | { code: "missing_synology_target"; detail: string }
  | { code: "missing_clients_scrape"; detail: string }
  | null;

/** Why Force-apply is still needed (null = not stale). */
export function alloySnmpStaleReason(_dataDir?: string): SnmpStaleReason {
  const devices = readLocalDevices().filter((d) => d.id && d.snmpIp);
  const alloyFile = configAlloyPath();
  if (!fs.existsSync(alloyFile)) {
    return devices.length > 0
      ? { code: "missing_alloy", detail: "config.alloy missing while devices.json has SNMP devices" }
      : null;
  }

  const alloy = fs.readFileSync(alloyFile, "utf8");
  if (devices.length === 0) return null;
  if (!alloy.includes("prometheus.exporter.snmp")) {
    return { code: "missing_snmp_block", detail: "config.alloy has no prometheus.exporter.snmp block" };
  }
  for (const d of devices) {
    if (!alloy.includes(`device = "${d.id}"`)) {
      return { code: "missing_device", detail: `device ${d.id} missing from config.alloy` };
    }
  }
  const liveSnmp = path.join(dataDir(), "snmp.yml");
  const bundledSnmp = path.join(bundledToolkitDir(), "snmp.yml");
  if (fs.existsSync(bundledSnmp) && fs.existsSync(liveSnmp)) {
    const bundled = fs.readFileSync(bundledSnmp, "utf8");
    const live = fs.readFileSync(liveSnmp, "utf8");
    const missing = snmpModulesNewerInBundled(bundled, live);
    if (missing) {
      return {
        code: "stale_snmp_yml",
        detail: `volume snmp.yml missing ${missing} (image has newer vendor packs — Force apply refreshes modules)`
      };
    }
  } else if (fs.existsSync(bundledSnmp) && !fs.existsSync(liveSnmp)) {
    return { code: "stale_snmp_yml", detail: "volume snmp.yml missing" };
  }
  // Must match generate-config.sh vendor_module(): type nas|storage AND
  // vendor synology/syno/empty/generic (not "any device with NAS in the name").
  const needsSynologyTarget = devices.some((d) => {
    const t = (d.type || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const v = (d.vendor || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (t !== "nas" && t !== "storage") return false;
    return v === "" || v === "generic" || v === "synology" || v === "syno" || v.startsWith("synology");
  });
  if (needsSynologyTarget && !alloy.includes("synology_health")) {
    return {
      code: "missing_synology_target",
      detail:
        "NAS/storage + Synology vendor should have a synology_health Alloy target — check type/vendor on the device, then Force apply"
    };
  }

  // Station list needs the slow site_snmp_clients scrape (separate from 15s health).
  const needsClientScrape = devices.some((d) => {
    const t = (d.type || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const v = (d.vendor || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const ap = t === "ap" || t === "accesspoint" || t === "wifi" || t === "wireless";
    if (!ap) return false;
    return (
      v === "cambium" ||
      v.startsWith("cambium") ||
      v === "omada" ||
      v === "tplink" ||
      v.startsWith("omada") ||
      v.startsWith("tplink")
    );
  });
  if (needsClientScrape && !alloy.includes("site_snmp_clients")) {
    return {
      code: "missing_clients_scrape",
      detail:
        "Wi‑Fi APs need the station scrape (site_snmp_clients). Rebuild collector-console, then Force apply so config.alloy includes it."
    };
  }
  return null;
}

/** True if config.alloy / snmp.yml is behind devices.json or the image toolkit. */
export function alloySnmpConfigStale(_dataDir?: string): boolean {
  return alloySnmpStaleReason(_dataDir) != null;
}

export async function ensureAlloySnmpApplied(
  _dataDir?: string,
  force = false
): Promise<{ reloaded: boolean; message: string }> {
  const reason = alloySnmpStaleReason();
  const stale = force || reason != null;
  if (!stale) {
    return { reloaded: false, message: "Device checks already match the list." };
  }

  await regenerateAlloyConfig();
  const still = alloySnmpStaleReason();
  await reloadAlloy({ forceRecreate: false });
  if (still) {
    return {
      reloaded: true,
      message: `Device checks were rebuilt, but they are still out of date: ${still.detail}`
    };
  }
  return {
    reloaded: true,
    message: "Device checks were updated."
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncDevices(
  _dataDir?: string,
  opts?: { forceAlloyReload?: boolean }
): Promise<SyncResult> {
  const forceAlloyReload = opts?.forceAlloyReload === true;

  // Force apply must not no-op when the 90s sync loop holds the lock.
  if (syncInFlight) {
    if (forceAlloyReload) {
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        if (!syncInFlight) break;
      }
    }
    if (syncInFlight) {
      return {
        ok: false,
        message: "A sync is already running. Wait a few seconds, then use Force apply again.",
        changed: false,
        at: new Date().toISOString()
      };
    }
  }

  syncInFlight = true;
  const at = new Date().toISOString();

  try {
    const config = readConfig();
    if (!config.nocApiUrl || !config.siteName || !config.collectorToken) {
      const result: SyncResult = {
        ok: false,
        message: "Finish Setup first. The NOC address, site, and collector token are required.",
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
      await res.text();
      const result: SyncResult = {
        ok: false,
        httpCode,
        message: "Could not load the device list from the NOC. Check Setup and try again.",
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

    let message = "Device list is already up to date.";
    if (!ensure.reloaded && (httpCode === 304 || !inventoryChanged)) {
      message = "Device list is already up to date.";
    } else if (ensure.message.startsWith("Device checks were rebuilt, but")) {
      message = ensure.message;
    } else if (inventoryChanged) {
      message = `Saved ${deviceCount} devices and updated the checks.`;
    } else if (ensure.reloaded) {
      message = "Device checks were updated.";
    }

    const result: SyncResult = {
      ok: !ensure.message.startsWith("Device checks were rebuilt, but"),
      httpCode,
      message,
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
