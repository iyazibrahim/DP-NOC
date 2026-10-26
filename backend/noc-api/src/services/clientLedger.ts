import fs from "fs";
import path from "path";
import { env } from "../env";
import { ymdInZone, zonedDayStartUnix, zonedHourKey } from "./lineUseWindow";

const HOUR_KEEP_DAYS = 14;
const DAY_KEEP_DAYS = 90;

export type LedgerSample = {
  deviceId: string;
  mac: string | null;
  hostname: string | null;
  ip: string | null;
  ssid: string | null;
  apLabel: string | null;
  vendor: string | null;
  /** AP rx bytes: download toward the client. */
  rxBytes: number | null;
  /** AP tx bytes: upload from the client. */
  txBytes: number | null;
  apps?: string[];
};

export type DayBytes = {
  inBytes: number;
  outBytes: number;
  ssid: string | null;
  apLabel: string | null;
};

export type ClientRollup = {
  mac: string;
  hostname: string | null;
  ip: string | null;
  ssid: string | null;
  apLabel: string | null;
  deviceId: string | null;
  vendor: string | null;
  apps: string[];
  lastSeen: string;
  hours: Record<string, { inBytes: number; outBytes: number }>;
  days: Record<string, DayBytes>;
};

export type LedgerState = {
  counters: Record<string, { rx: number; tx: number }>;
  clients: Record<string, ClientRollup>;
};

export type ClientDayRow = {
  mac: string;
  hostname: string | null;
  ip: string | null;
  ssid: string | null;
  apLabel: string | null;
  deviceId: string | null;
  vendor: string | null;
  apps: string[];
  inBytes: number;
  outBytes: number;
  lastSeen: string;
};

export function emptyLedger(): LedgerState {
  return { counters: {}, clients: {} };
}

export function normalizeMac(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hex = raw.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(":").toLowerCase();
}

/** Bytes since the previous sample. The first sighting of a counter adds nothing. A reset counts the new value. */
export function counterDelta(previous: number | undefined, next: number): number {
  if (!Number.isFinite(next) || next < 0) return 0;
  if (previous == null || !Number.isFinite(previous)) return 0;
  if (next >= previous) return next - previous;
  return next;
}

function cleanApps(apps: string[] | undefined): string[] {
  const out: string[] = [];
  for (const app of apps ?? []) {
    const name = app.trim();
    if (!name || out.includes(name)) continue;
    out.push(name);
    if (out.length >= 5) break;
  }
  return out;
}

function prune(state: LedgerState, now: Date, timeZone: string): void {
  const hourCutoff = zonedHourKey(
    timeZone,
    new Date(zonedDayStartUnix(timeZone, now, -HOUR_KEEP_DAYS) * 1000)
  );
  const dayCutoff = ymdInZone(timeZone, zonedDayStartUnix(timeZone, now, -DAY_KEEP_DAYS));
  for (const client of Object.values(state.clients)) {
    for (const key of Object.keys(client.hours)) {
      if (key < hourCutoff) delete client.hours[key];
    }
    for (const key of Object.keys(client.days)) {
      if (key < dayCutoff) delete client.days[key];
    }
  }
}

export function applyStationSamples(
  state: LedgerState,
  samples: LedgerSample[],
  now: Date,
  timeZone: string
): LedgerState {
  const next: LedgerState = {
    counters: { ...state.counters },
    clients: { ...state.clients }
  };
  const day = ymdInZone(timeZone, Math.floor(now.getTime() / 1000));
  const hour = zonedHourKey(timeZone, now);

  for (const sample of samples) {
    const mac = normalizeMac(sample.mac);
    if (!mac || !sample.deviceId) continue;
    const rx = sample.rxBytes;
    const tx = sample.txBytes;
    const hasCounters = rx != null && tx != null && Number.isFinite(rx) && Number.isFinite(tx);
    const counterKey = `${sample.deviceId}|${mac}`;
    let addIn = 0;
    let addOut = 0;
    if (hasCounters) {
      const prev = next.counters[counterKey];
      addIn = counterDelta(prev?.rx, rx);
      addOut = counterDelta(prev?.tx, tx);
      next.counters[counterKey] = { rx, tx };
    }

    const current = next.clients[mac] ?? {
      mac,
      hostname: null,
      ip: null,
      ssid: null,
      apLabel: null,
      deviceId: null,
      vendor: null,
      apps: [],
      lastSeen: now.toISOString(),
      hours: {},
      days: {}
    };
    const hours = { ...current.hours };
    const days = { ...current.days };
    if (hasCounters && (addIn > 0 || addOut > 0)) {
      const hourRow = hours[hour] ?? { inBytes: 0, outBytes: 0 };
      hours[hour] = { inBytes: hourRow.inBytes + addIn, outBytes: hourRow.outBytes + addOut };
      const dayRow = days[day] ?? {
        inBytes: 0,
        outBytes: 0,
        ssid: sample.ssid,
        apLabel: sample.apLabel
      };
      days[day] = {
        inBytes: dayRow.inBytes + addIn,
        outBytes: dayRow.outBytes + addOut,
        ssid: sample.ssid ?? dayRow.ssid,
        apLabel: sample.apLabel ?? dayRow.apLabel
      };
    } else if (days[day]) {
      days[day] = {
        ...days[day],
        ssid: sample.ssid ?? days[day].ssid,
        apLabel: sample.apLabel ?? days[day].apLabel
      };
    }

    const apps = cleanApps(sample.apps);
    next.clients[mac] = {
      ...current,
      hostname: sample.hostname || current.hostname,
      ip: sample.ip || current.ip,
      ssid: sample.ssid ?? current.ssid,
      apLabel: sample.apLabel ?? current.apLabel,
      deviceId: sample.deviceId || current.deviceId,
      vendor: sample.vendor ?? current.vendor,
      apps: apps.length > 0 ? apps : current.apps,
      lastSeen: now.toISOString(),
      hours,
      days
    };
  }

  prune(next, now, timeZone);
  return next;
}

function ledgerDir(): string {
  const dir = path.join(process.cwd(), "data/runtime/client-ledger");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ledgerPath(siteId: string): string {
  const safe = siteId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(ledgerDir(), `${safe}.json`);
}

export function loadLedger(siteId: string): LedgerState {
  const file = ledgerPath(siteId);
  if (!fs.existsSync(file)) return emptyLedger();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as LedgerState;
    if (!parsed || typeof parsed !== "object") return emptyLedger();
    return {
      counters: parsed.counters && typeof parsed.counters === "object" ? parsed.counters : {},
      clients: parsed.clients && typeof parsed.clients === "object" ? parsed.clients : {}
    };
  } catch {
    return emptyLedger();
  }
}

function saveLedger(siteId: string, state: LedgerState): void {
  fs.writeFileSync(ledgerPath(siteId), JSON.stringify({ siteId, ...state }) + "\n", "utf8");
}

export function ledgerSiteIds(): string[] {
  const dir = path.join(process.cwd(), "data/runtime/client-ledger");
  if (!fs.existsSync(dir)) return [];
  const ids: string[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { siteId?: string };
      if (parsed.siteId) ids.push(parsed.siteId);
    } catch {
      /* skip a damaged file */
    }
  }
  return ids;
}

export function recordStationSamples(siteId: string, samples: LedgerSample[], at = new Date()): LedgerState {
  const next = applyStationSamples(loadLedger(siteId), samples, at, env.NOC_TZ);
  saveLedger(siteId, next);
  return next;
}

export function clientDayRows(siteId: string, date: string): ClientDayRow[] {
  const state = loadLedger(siteId);
  const rows: ClientDayRow[] = [];
  for (const client of Object.values(state.clients)) {
    const day = client.days?.[date];
    if (!day || (day.inBytes <= 0 && day.outBytes <= 0)) continue;
    rows.push({
      mac: client.mac,
      hostname: client.hostname,
      ip: client.ip,
      ssid: day.ssid ?? client.ssid,
      apLabel: day.apLabel ?? client.apLabel,
      deviceId: client.deviceId,
      vendor: client.vendor,
      apps: client.apps ?? [],
      inBytes: Math.round(day.inBytes),
      outBytes: Math.round(day.outBytes),
      lastSeen: client.lastSeen
    });
  }
  rows.sort((a, b) => b.inBytes + b.outBytes - (a.inBytes + a.outBytes));
  return rows;
}

export function knownSsids(siteId: string): string[] {
  const found = new Set<string>();
  for (const client of Object.values(loadLedger(siteId).clients)) {
    if (client.ssid?.trim()) found.add(client.ssid.trim());
    for (const day of Object.values(client.days ?? {})) {
      if (day.ssid?.trim()) found.add(day.ssid.trim());
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}
