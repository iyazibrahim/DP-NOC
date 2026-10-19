import fs from "fs";
import path from "path";

export type StoredStation = {
  deviceId: string;
  apLabel: string;
  vendor: string;
  mac: string | null;
  hostname: string | null;
  ip: string | null;
  ssid: string | null;
  snr: number | null;
  txRate: string | null;
  inBps: number | null;
  outBps: number | null;
  clientOs: string | null;
  hwMode: string | null;
  /** SNMP table index, used to attach this walk to the matching Prometheus row. */
  clientIndex?: string | null;
};

export type SiteStationsPayload = {
  siteId: string;
  at: string;
  stations: StoredStation[];
};

function stationsDir(): string {
  const dir = path.join(process.cwd(), "data/runtime/site-stations");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stationsPath(siteId: string): string {
  const safe = siteId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(stationsDir(), `${safe}.json`);
}

export function saveSiteStations(siteId: string, stations: StoredStation[], at?: string): SiteStationsPayload {
  const payload: SiteStationsPayload = {
    siteId,
    at: at || new Date().toISOString(),
    stations
  };
  fs.writeFileSync(stationsPath(siteId), JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

export function loadSiteStations(siteId: string): SiteStationsPayload | null {
  const file = stationsPath(siteId);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SiteStationsPayload;
    if (!parsed || !Array.isArray(parsed.stations)) return null;
    return parsed;
  } catch {
    return null;
  }
}
