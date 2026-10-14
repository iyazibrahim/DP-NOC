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

function formatMac(raw: string): string | null {
  const hex = raw.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length === 12) {
    return hex
      .toLowerCase()
      .match(/.{2}/g)!
      .join(":");
  }
  const t = raw.trim();
  return t || null;
}

async function snmpWalk(ip: string, community: string, oid: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "snmpwalk",
      ["-v2c", "-c", community, "-t", "3", "-r", "1", "-On", ip, oid],
      { timeout: 45000, maxBuffer: 4 * 1024 * 1024 }
    );
    return stdout || "";
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    return e.stdout || "";
  }
}

/** Parse Cambium cambiumClientTable walk into rows keyed by client index. */
function parseCambiumWalk(text: string): Map<string, Record<string, string>> {
  const byIdx = new Map<string, Record<string, string>>();
  // .1.3.6.1.4.1.17713.22.1.3.1.<col>.<idx> = TYPE: value
  const re =
    /^\.1\.3\.6\.1\.4\.1\.17713\.22\.1\.3\.1\.(\d+)\.(\d+)\s*=\s*([A-Z0-9\-]+):\s*(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const col = m[1];
    const idx = m[2];
    let val = (m[4] || "").trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    // Hex-STRING: AA BB CC …
    if (/^[0-9A-Fa-f]{2}( [0-9A-Fa-f]{2})+$/.test(val)) {
      val = val.replace(/\s+/g, "");
    }
    let row = byIdx.get(idx);
    if (!row) {
      row = {};
      byIdx.set(idx, row);
    }
    row[col] = val;
  }
  return byIdx;
}

function parseOmadaWalk(text: string): Map<string, Record<string, string>> {
  const byIdx = new Map<string, Record<string, string>>();
  const re =
    /^\.1\.3\.6\.1\.4\.1\.11863\.10\.1\.1\.2\.1\.(\d+)\.(\d+)\s*=\s*([A-Z0-9\-]+):\s*(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const col = m[1];
    const idx = m[2];
    let val = (m[4] || "").trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (/^[0-9A-Fa-f]{2}( [0-9A-Fa-f]{2})+$/.test(val)) {
      val = val.replace(/\s+/g, "");
    }
    let row = byIdx.get(idx);
    if (!row) {
      row = {};
      byIdx.set(idx, row);
    }
    row[col] = val;
  }
  return byIdx;
}

async function scanDevice(d: LocalDevice, defaultCommunity: string): Promise<ScannedStation[]> {
  if (!d.id || !d.snmpIp) return [];
  const community = (d.snmpCommunity || defaultCommunity || "public").trim() || "public";
  const apLabel = (d.name || d.id).trim();
  const vendor = d.vendor || "generic";
  const out: ScannedStation[] = [];

  if (isCambium(d)) {
    const text = await snmpWalk(d.snmpIp, community, "1.3.6.1.4.1.17713.22.1.3.1");
    const rows = parseCambiumWalk(text);
    for (const [, cols] of rows) {
      const snrRaw = cols["11"];
      const snr = snrRaw != null && Number.isFinite(Number(snrRaw)) ? Math.round(Number(snrRaw)) : null;
      out.push({
        deviceId: d.id,
        apLabel,
        vendor,
        mac: formatMac(cols["2"] || ""),
        hostname: cols["4"]?.trim() || null,
        ip: cols["3"]?.trim() || null,
        ssid: cols["5"]?.trim() || null,
        snr,
        txRate: cols["12"]?.trim() || null,
        inBps: null,
        outBps: null,
        clientOs: cols["6"]?.trim() || null,
        hwMode: cols["7"]?.trim() || null
      });
    }
  } else if (isOmada(d)) {
    const text = await snmpWalk(d.snmpIp, community, "1.3.6.1.4.1.11863.10.1.1.2.1");
    const rows = parseOmadaWalk(text);
    for (const [, cols] of rows) {
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
        hwMode: null
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
  const stations: ScannedStation[] = [];
  let scanned = 0;
  for (const d of devices) {
    if (!isCambium(d) && !isOmada(d)) continue;
    scanned += 1;
    try {
      const rows = await scanDevice(d, defaultCommunity);
      stations.push(...rows);
    } catch {
      /* continue other APs */
    }
  }
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
  setInterval(tick, 120000);
}
