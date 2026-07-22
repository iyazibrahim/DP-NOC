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
};

let lastSync: SyncResult | null = null;
let syncInFlight = false;

export function getLastSync(): SyncResult | null {
  return lastSync;
}

function etagPath(dataDir: string): string {
  return path.join(dataDir, ".devices.etag");
}

export async function syncDevices(dataDir: string): Promise<SyncResult> {
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
    if (fs.existsSync(etagFile)) {
      headers["If-None-Match"] = fs.readFileSync(etagFile, "utf8").trim();
    }

    const res = await fetch(url, { headers });
    const httpCode = res.status;

    if (httpCode === 304) {
      let deviceCount = 0;
      const devicesFile304 = path.join(dataDir, "devices.json");
      if (fs.existsSync(devicesFile304)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(devicesFile304, "utf8"));
          deviceCount = Array.isArray(parsed) ? parsed.length : 0;
        } catch {
          deviceCount = 0;
        }
      }
      const result: SyncResult = {
        ok: true,
        httpCode,
        message: "Inventory unchanged (304)",
        deviceCount,
        changed: false,
        at
      };
      lastSync = result;
      return result;
    }

    if (httpCode !== 200) {
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
    }

    const etag = res.headers.get("etag");
    if (etag) {
      fs.writeFileSync(etagFile, etag, "utf8");
    }

    const body = await res.text();
    const devicesFile = path.join(dataDir, "devices.json");
    let changed = true;

    if (fs.existsSync(devicesFile)) {
      try {
        changed = !fs.readFileSync(devicesFile).equals(Buffer.from(body));
      } catch {
        changed = true;
      }
    }

    if (!changed) {
      const devices = JSON.parse(body);
      const result: SyncResult = {
        ok: true,
        httpCode,
        message: "Content identical — no Alloy restart needed",
        deviceCount: Array.isArray(devices) ? devices.length : 0,
        changed: false,
        at
      };
      lastSync = result;
      return result;
    }

    fs.writeFileSync(devicesFile, body, "utf8");
    const devices = JSON.parse(body);
    const deviceCount = Array.isArray(devices) ? devices.length : 0;

    const genMsg = await regenerateAlloyConfig();
    const recreateMsg = await reloadAlloy({ forceRecreate: false });

    const result: SyncResult = {
      ok: true,
      httpCode,
      message: `Synced ${deviceCount} device(s). ${genMsg} ${recreateMsg}`.trim(),
      deviceCount,
      changed: true,
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
