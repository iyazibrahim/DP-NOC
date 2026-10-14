import { execFile } from "child_process";
import { promisify } from "util";
import { readConfig, readSnmpCommunity, stateDir } from "./config";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

export type ScannedStation = {
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
};

type LocalDevice = {
  id?: string;
  name?: string;
  snmpIp?: string;
  type?: string;
  vendor?: string;
  snmpCommunity?: string;
};

function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isAp(d: LocalDevice): boolean {
  const t = norm(d.type || "");
  return t === "ap" || t === "accesspoint" || t === "wifi" || t === "wireless";
}

function isCambium(d: LocalDevice): boolean {
  const v = norm(d.vendor || "");
  return v === "cambium" || v.startsWith("cambium");
}

function isOmada(d: LocalDevice): boolean {
  const v = norm(d.vendor || "");
  return v === "omada" || v === "tplink" || v.startsWith("omada") || v.startsWith("tplink");
}

function readLocalDevices(): LocalDevice[] {
  const p = path.join(stateDir(), "devices.json");
  const fallback = path.join(process.env.DATA_DIR || "/data", "devices.json");
  const use = fs.existsSync(p) ? p : fallback;
  if (!fs.existsSync(use)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(use, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Normalize MAC from SNMP OctetString / Prom labels (binary or Omada ASCII Hex-STRING). */
function formatMac(raw: string): string | null {
  let t = (raw || "").trim();
  if (!t) return null;
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }

  // Spaced Hex-STRING: 6 bytes = binary MAC; longer = often ASCII "AA-BB-CC-DD-EE-FF" (Omada)
  if (/^[0-9A-Fa-f]{2}( [0-9A-Fa-f]{2})+$/.test(t)) {
    const parts = t.split(/\s+/);
    if (parts.length === 6) {
      return parts.map((h) => h.toLowerCase()).join(":");
    }
    t = parts
      .map((h) => String.fromCharCode(parseInt(h, 16)))
      .join("")
      .replace(/\0/g, "")
      .trim();
  }

  const extract12 = (s: string): string | null => {
    const hex = s.replace(/[^0-9a-fA-F]/g, "");
    if (hex.length === 12) {
      return hex.toLowerCase().match(/.{2}/g)!.join(":");
    }
    return null;
  };

  const direct = extract12(t);
  if (direct) return direct;

  // Collapsed ASCII Hex-STRING (no spaces): 31382D… → "18-69-…" → MAC
  const onlyHex = t.replace(/[^0-9a-fA-F]/g, "");
  if (onlyHex.length > 12 && onlyHex.length % 2 === 0 && !/[:\-]/.test(t)) {
    const ascii = onlyHex
      .match(/.{2}/g)!
      .map((h) => String.fromCharCode(parseInt(h, 16)))
      .join("")
      .replace(/[^\x20-\x7E]/g, "")
      .trim();
    return extract12(ascii);
  }

  return null;
}

async function snmpWalk(ip: string, community: string, oid: string): Promise<string> {
  try {
    // -OQne: numeric OIDs, quiet, enums as numbers — easier to parse STRING/Counter values
    const { stdout } = await execFileAsync(
      "snmpwalk",
      ["-v2c", "-c", community, "-t", "3", "-r", "1", "-OQne", ip, oid],
      { timeout: 45000, maxBuffer: 4 * 1024 * 1024 }
    );
    return stdout || "";
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    return e.stdout || "";
  }
}

function cleanSnmpValue(raw: string): string {
  let val = (raw || "").trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  // Keep spaced Hex-STRING intact — formatMac decides binary vs ASCII (Omada)
  return val.trim();
}

/** Parse OID table rows: ...1.<col>.<idx> = value  (Cambium / Omada style). */
function parseIndexedTable(
  text: string,
  prefix: string
): Map<string, Record<string, string>> {
  const byIdx = new Map<string, Record<string, string>>();
  const esc = prefix.replace(/\./g, "\\.");
  // With or without leading dot; TYPE optional ( -OQne often omits TYPE )
  const re = new RegExp(
    `^\\.?${esc}\\.(\\d+)\\.(\\d+)\\s*=\\s*(?:[A-Za-z][A-Za-z0-9\\-]*:\\s*)?(.*)$`,
    "gm"
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const col = m[1];
    const idx = m[2];
    const val = cleanSnmpValue(m[3] || "");
    let row = byIdx.get(idx);
    if (!row) {
      row = {};
      byIdx.set(idx, row);
    }
    row[col] = val;
  }
  return byIdx;
}

function formatLinkRate(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || t === "-" || t === "0") return null;
  if (/mbps|kbps|gbps/i.test(t)) return t;
  const n = Number(t.replace(/[^\d.]/g, ""));
  if (Number.isFinite(n) && n > 0) return `${n} Mbps`;
  return t;
}

type ByteCounters = { tx: number; rx: number };
type CounterSnap = { atMs: number; counters: Record<string, ByteCounters> };

function countersPath(): string {
  return path.join(stateDir(), ".client-byte-counters.json");
}

function loadCounterSnap(): CounterSnap | null {
  const file = countersPath();
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as CounterSnap;
  } catch {
    return null;
  }
}

function saveCounterSnap(snap: CounterSnap): void {
  try {
    fs.writeFileSync(countersPath(), JSON.stringify(snap) + "\n", "utf8");
  } catch {
    /* ignore */
  }
}

function stationCounterKey(deviceId: string, mac: string | null, idx: string): string {
  return mac ? `${deviceId}|${mac}` : `${deviceId}|idx:${idx}`;
}

function applyByteRates(
  stations: Array<ScannedStation & { _txBytes?: number; _rxBytes?: number; _idx?: string }>
): ScannedStation[] {
  const now = Date.now();
  const prev = loadCounterSnap();
  const next: CounterSnap = { atMs: now, counters: {} };
  const dtSec = prev?.atMs ? Math.max(1, (now - prev.atMs) / 1000) : 0;

  for (const st of stations) {
    const key = stationCounterKey(st.deviceId, st.mac, st._idx || "");
    const tx = st._txBytes ?? 0;
    const rx = st._rxBytes ?? 0;
    next.counters[key] = { tx, rx };
    if (prev?.counters[key] && dtSec > 0) {
      const p = prev.counters[key];
      // Rx bytes at AP = download to client → In; Tx bytes = upload from client → Out
      const dRx = rx >= p.rx ? rx - p.rx : rx;
      const dTx = tx >= p.tx ? tx - p.tx : tx;
      st.inBps = (dRx * 8) / dtSec;
      st.outBps = (dTx * 8) / dtSec;
    }
    delete st._txBytes;
    delete st._rxBytes;
    delete st._idx;
  }
  saveCounterSnap(next);
  return stations;
}

async function scanDevice(
  d: LocalDevice,
  defaultCommunity: string
): Promise<Array<ScannedStation & { _txBytes?: number; _rxBytes?: number; _idx?: string }>> {
  if (!d.id || !d.snmpIp) return [];
  const community = (d.snmpCommunity || defaultCommunity || "public").trim() || "public";
  const apLabel = (d.name || d.id).trim();
  const vendor = d.vendor || "generic";
  const out: Array<ScannedStation & { _txBytes?: number; _rxBytes?: number; _idx?: string }> = [];

  if (isCambium(d)) {
    const text = await snmpWalk(d.snmpIp, community, "1.3.6.1.4.1.17713.22.1.3.1");
    const rows = parseIndexedTable(text, "1.3.6.1.4.1.17713.22.1.3.1");
    for (const [idx, cols] of rows) {
      const snrRaw = cols["11"];
      const snr = snrRaw != null && Number.isFinite(Number(snrRaw)) ? Math.round(Number(snrRaw)) : null;
      const txBytes = Number(cols["14"]);
      const rxBytes = Number(cols["16"]);
      out.push({
        deviceId: d.id,
        apLabel,
        vendor,
        mac: formatMac(cols["2"] || ""),
        hostname: cols["4"]?.trim() || null,
        ip: cols["3"]?.trim() || null,
        ssid: cols["5"]?.trim() || null,
        snr,
        txRate: formatLinkRate(cols["12"]),
        inBps: null,
        outBps: null,
        clientOs: cols["6"]?.trim() || null,
        hwMode: cols["7"]?.trim() || null,
        _txBytes: Number.isFinite(txBytes) ? txBytes : undefined,
        _rxBytes: Number.isFinite(rxBytes) ? rxBytes : undefined,
        _idx: idx
      });
    }
  } else if (isOmada(d)) {
    const text = await snmpWalk(d.snmpIp, community, "1.3.6.1.4.1.11863.10.1.1.2.1");
    const rows = parseIndexedTable(text, "1.3.6.1.4.1.11863.10.1.1.2.1");
    for (const [idx, cols] of rows) {
      out.push({
        deviceId: d.id,
        apLabel,
        vendor,
        mac: formatMac(cols["2"] || ""),
        hostname: null,
        ip: null,
        ssid: null,
        snr: null,
        txRate: null,
        inBps: null,
        outBps: null,
        clientOs: null,
        hwMode: null,
        _idx: idx
      });
    }
  }

  return out.filter((s) => s.mac || s.hostname || s.ip);
}

export async function scanAllStations(): Promise<{
  ok: boolean;
  stations: ScannedStation[];
  message: string;
  scannedAps: number;
}> {
  const devices = readLocalDevices().filter((d) => d.id && d.snmpIp && isAp(d));
  const defaultCommunity = readSnmpCommunity();
  const raw: Array<ScannedStation & { _txBytes?: number; _rxBytes?: number; _idx?: string }> = [];
  let scanned = 0;
  for (const d of devices) {
    if (!isCambium(d) && !isOmada(d)) continue;
    scanned += 1;
    try {
      const rows = await scanDevice(d, defaultCommunity);
      raw.push(...rows);
    } catch {
      /* continue other APs */
    }
  }
  const stations = applyByteRates(raw);
  return {
    ok: true,
    stations,
    scannedAps: scanned,
    message: `Scanned ${scanned} AP(s), found ${stations.length} station(s)`
  };
}

export async function pushStationsToNoc(
  stations: ScannedStation[]
): Promise<{ ok: boolean; message: string }> {
  const config = readConfig();
  if (!config.nocApiUrl || !config.siteName || !config.collectorToken) {
    return { ok: false, message: "Missing NOC setup — cannot push stations" };
  }
  const url = `${config.nocApiUrl.replace(/\/$/, "")}/api/collector/${config.siteName}/stations`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.collectorToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ stations, at: new Date().toISOString() }),
      signal: AbortSignal.timeout(20000)
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, message: `NOC rejected stations (HTTP ${res.status}): ${text.slice(0, 160)}` };
    }
    return { ok: true, message: `Pushed ${stations.length} station(s) to NOC` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

let scanInFlight = false;

export async function scanAndPushStations(): Promise<{ ok: boolean; message: string }> {
  if (scanInFlight) return { ok: false, message: "Client scan already running" };
  scanInFlight = true;
  try {
    const scan = await scanAllStations();
    const push = await pushStationsToNoc(scan.stations);
    return {
      ok: push.ok,
      message: `${scan.message} — ${push.message}`
    };
  } finally {
    scanInFlight = false;
  }
}

export function startClientsScanLoop(): void {
  const tick = () => {
    void scanAndPushStations().catch(() => undefined);
  };
  // After boot + sync settle
  setTimeout(tick, 20000);
  // ~90s so In/Out rates have a prior counter sample after the first scan
  setInterval(tick, 90000);
}
