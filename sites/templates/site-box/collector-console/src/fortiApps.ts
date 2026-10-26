import https from "https";
import fs from "fs";
import path from "path";
import { stateDir } from "./config";
import type { ScannedStation } from "./scanClients";

type Firewall = { snmpIp: string; fortiApiToken: string };

function readFirewalls(): Firewall[] {
  const p = path.join(stateDir(), "devices.json");
  const fallback = path.join(process.env.DATA_DIR || "/data", "devices.json");
  const use = fs.existsSync(p) ? p : fallback;
  if (!fs.existsSync(use)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(use, "utf8"));
    if (!Array.isArray(parsed)) return [];
    const out: Firewall[] = [];
    for (const raw of parsed) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as { snmpIp?: string; vendor?: string; type?: string; fortiApiToken?: string };
      const vendor = `${row.vendor || ""} ${row.type || ""}`.toLowerCase();
      if (!row.snmpIp || !row.fortiApiToken) continue;
      if (!vendor.includes("forti") && !vendor.includes("firewall")) continue;
      out.push({ snmpIp: row.snmpIp, fortiApiToken: row.fortiApiToken });
    }
    return out;
  } catch {
    return [];
  }
}

function getJson(ip: string, token: string, pathName: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: ip,
        port: 443,
        path: pathName,
        method: "GET",
        rejectUnauthorized: false,
        timeout: 8000,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode || 500) >= 300) {
            reject(new Error(`FortiGate ${res.statusCode || 0}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error("FortiGate did not return JSON"));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("FortiGate timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

function asRecords(body: unknown): Array<Record<string, unknown>> {
  if (!body || typeof body !== "object") return [];
  const root = body as { results?: unknown };
  const results = root.results;
  if (Array.isArray(results)) return results.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  if (results && typeof results === "object") {
    const details = (results as { details?: unknown }).details;
    if (Array.isArray(details)) {
      return details.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function sourceIp(row: Record<string, unknown>): string | null {
  for (const key of ["srcip", "src", "source", "saddr"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function serviceName(row: Record<string, unknown>): string | null {
  for (const key of ["appname", "application", "app", "dstname", "hostname"]) {
    const value = row[key];
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (!name || /^\d+$/.test(name)) continue;
    if (key === "dstname" || key === "hostname") {
      if (!/[a-z]/i.test(name) || !name.includes(".")) continue;
    }
    return name;
  }
  return null;
}

function byteCount(row: Record<string, unknown>): number {
  for (const key of ["bytes", "rcvdbyte", "sentbyte"]) {
    const n = Number(row[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}

/** Top services per client IP. Empty when the firewall has no token or no app names in the session list. */
export async function appsByClientIp(): Promise<Map<string, string[]>> {
  const totals = new Map<string, Map<string, number>>();
  for (const fw of readFirewalls()) {
    let body: unknown;
    try {
      body = await getJson(fw.snmpIp, fw.fortiApiToken, "/api/v2/monitor/firewall/session?count=500");
    } catch {
      continue;
    }
    for (const row of asRecords(body)) {
      const ip = sourceIp(row);
      const name = serviceName(row);
      if (!ip || !name) continue;
      const bucket = totals.get(ip) ?? new Map<string, number>();
      bucket.set(name, (bucket.get(name) ?? 0) + byteCount(row));
      totals.set(ip, bucket);
    }
  }
  const out = new Map<string, string[]>();
  for (const [ip, bucket] of totals) {
    const names = [...bucket.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
    if (names.length > 0) out.set(ip, names);
  }
  return out;
}

export async function attachFortiApps(stations: ScannedStation[]): Promise<ScannedStation[]> {
  if (!stations.some((st) => st.ip)) return stations;
  const byIp = await appsByClientIp();
  if (byIp.size === 0) return stations;
  return stations.map((st) => {
    const apps = st.ip ? byIp.get(st.ip) : undefined;
    return apps && apps.length > 0 ? { ...st, apps } : st;
  });
}
