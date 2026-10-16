import fs from "fs";
import path from "path";
import { env } from "../env";

export type ProbeLevel = "up" | "down" | "unknown";

export type DeviceProbe = {
  deviceId: string;
  ping: ProbeLevel;
  snmp: ProbeLevel;
};

export type DeviceSnapshot = {
  siteId: string;
  at: string;
  devices: DeviceProbe[];
};

function snapshotsDir(): string {
  const dir = path.join(process.cwd(), "data/runtime/device-snapshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function snapshotPath(siteId: string): string {
  const safe = siteId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(snapshotsDir(), `${safe}.json`);
}

function asLevel(value: unknown): ProbeLevel {
  return value === "up" || value === "down" || value === "unknown" ? value : "unknown";
}

export function saveDeviceSnapshot(siteId: string, devices: DeviceProbe[], at?: string): DeviceSnapshot {
  const payload: DeviceSnapshot = {
    siteId,
    at: at && !Number.isNaN(Date.parse(at)) ? at : new Date().toISOString(),
    devices: devices
      .filter((d) => d.deviceId.trim())
      .map((d) => ({
        deviceId: d.deviceId.trim(),
        ping: asLevel(d.ping),
        snmp: asLevel(d.snmp)
      }))
  };
  fs.writeFileSync(snapshotPath(siteId), JSON.stringify(payload, null, 2));
  return payload;
}

/** Fresh collector report, or null when missing or older than the metrics window. */
export function getFreshDeviceSnapshot(siteId: string): DeviceSnapshot | null {
  const file = snapshotPath(siteId);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as DeviceSnapshot;
    const at = Date.parse(raw.at);
    if (!Number.isFinite(at)) return null;
    if (Date.now() - at > env.STATUS_METRIC_FRESH_SEC * 1000) return null;
    if (!Array.isArray(raw.devices)) return null;
    return raw;
  } catch {
    return null;
  }
}
