import { env } from "../env";

export type HetrixMonitor = {
  id: string;
  name: string;
  type: string;
  target: string;
  uptime_status?: string;
  monitor_status?: string;
  uptime?: number;
  locations?: Record<
    string,
    { uptime_status?: string; response_time?: number; last_check?: number }
  >;
};

export type HetrixStatus = {
  id: string;
  name: string;
  target: string;
  uptimeStatus: "up" | "down" | "unknown";
  uptimePct: number | null;
  latencyMs: number | null;
};

type CacheEntry = { at: number; monitors: HetrixMonitor[] };

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60_000;

export function hetrixEnabled(): boolean {
  return Boolean(env.HETRIXTOOLS_API_TOKEN?.trim());
}

export function normalizeWebsiteUrl(url: string): string {
  const raw = url.trim();
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, "") || "";
    return `${u.protocol}//${u.host}${path}${u.search}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

function sanitizeMonitorName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9 .\-]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 64) || "Website";
}

function parseLocations(): Record<string, boolean> {
  const all = {
    nyc: false,
    sfo: false,
    dal: false,
    ams: false,
    lon: false,
    fra: false,
    sgp: false,
    syd: false,
    sao: false,
    tok: false,
    mba: false,
    waw: false
  };
  const keys = env.HETRIXTOOLS_LOCATIONS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const k of keys) {
    if (k in all) (all as Record<string, boolean>)[k] = true;
  }
  if (!Object.values(all).some(Boolean)) {
    all.sgp = true;
    all.ams = true;
    all.nyc = true;
  }
  return all;
}

async function v3Get(path: string): Promise<unknown> {
  const token = env.HETRIXTOOLS_API_TOKEN.trim();
  const res = await fetch(`https://api.hetrixtools.com/v3${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HetrixTools API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function v2Post(action: "add" | "delete", payload: Record<string, unknown>): Promise<unknown> {
  const token = env.HETRIXTOOLS_API_TOKEN.trim();
  const res = await fetch(`https://api.hetrixtools.com/v2/${token}/uptime/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`HetrixTools ${action} returned non-JSON: ${text.slice(0, 200)}`);
  }
  return data;
}

function invalidateCache(): void {
  cache = null;
}

export async function listHetrixMonitors(force = false): Promise<HetrixMonitor[]> {
  if (!hetrixEnabled()) return [];
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.monitors;
  }

  const monitors: HetrixMonitor[] = [];
  let page = 1;
  for (;;) {
    const data = (await v3Get(
      `/uptime-monitors?type=website&per_page=100&page=${page}`
    )) as { monitors?: HetrixMonitor[]; meta?: { pagination?: { current?: number; last?: number } } };
    const batch = Array.isArray(data.monitors) ? data.monitors : [];
    monitors.push(...batch);
    const last = data.meta?.pagination?.last ?? page;
    if (page >= last || batch.length === 0) break;
    page += 1;
    if (page > 50) break;
  }

  cache = { at: Date.now(), monitors };
  return monitors;
}

export async function findHetrixMonitorByUrl(url: string): Promise<HetrixMonitor | null> {
  const want = normalizeWebsiteUrl(url);
  const monitors = await listHetrixMonitors();
  return monitors.find((m) => normalizeWebsiteUrl(m.target || "") === want) ?? null;
}

export async function getHetrixStatusForUrl(url: string): Promise<HetrixStatus | null> {
  if (!hetrixEnabled()) return null;
  try {
    const mon = await findHetrixMonitorByUrl(url);
    if (!mon) return null;

    const locTimes: number[] = [];
    if (mon.locations) {
      for (const loc of Object.values(mon.locations)) {
        if (typeof loc.response_time === "number" && Number.isFinite(loc.response_time)) {
          locTimes.push(loc.response_time);
        }
      }
    }

    const raw = String(mon.uptime_status || "").toLowerCase();
    const uptimeStatus: HetrixStatus["uptimeStatus"] =
      raw === "up" ? "up" : raw === "down" ? "down" : "unknown";

    return {
      id: mon.id,
      name: mon.name,
      target: mon.target,
      uptimeStatus,
      uptimePct:
        typeof mon.uptime === "number" && Number.isFinite(mon.uptime)
          ? Math.round(mon.uptime * 10) / 10
          : null,
      latencyMs: locTimes.length
        ? Math.round(locTimes.reduce((a, b) => a + b, 0) / locTimes.length)
        : null
    };
  } catch (err) {
    console.warn("[hetrixtools] status lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function ensureHetrixWebsiteMonitor(
  name: string,
  url: string
): Promise<{ ok: boolean; monitorId: string | null; message: string; created: boolean }> {
  if (!hetrixEnabled()) {
    return { ok: true, monitorId: null, message: "HetrixTools not configured", created: false };
  }

  const existing = await findHetrixMonitorByUrl(url);
  if (existing) {
    return {
      ok: true,
      monitorId: existing.id,
      message: "Matched existing HetrixTools monitor",
      created: false
    };
  }

  const contact = env.HETRIXTOOLS_CONTACT_LIST.trim();
  const payload: Record<string, unknown> = {
    Type: 1,
    Name: sanitizeMonitorName(name),
    Target: url.trim(),
    Timeout: 10,
    Frequency: 1,
    FailsBeforeAlert: 3,
    FailedLocations: "",
    ContactList: contact,
    Category: "NOC",
    AlertAfter: "",
    RepeatTimes: "",
    RepeatEvery: "",
    Public: false,
    ShowTarget: true,
    VerSSLCert: false,
    VerSSLHost: false,
    Locations: parseLocations(),
    Method: "GET",
    Keyword: "",
    HTTPCodes: "200",
    MaxRedirects: "5",
    SSLExpiryReminder: "0",
    DomainExpiryReminder: "0",
    NSChangeAlert: "0"
  };

  try {
    const data = (await v2Post("add", payload)) as {
      status?: string;
      monitor_id?: string;
      error_message?: string;
      action?: string;
    };

    if (String(data.status).toUpperCase() === "SUCCESS" && data.monitor_id) {
      invalidateCache();
      return {
        ok: true,
        monitorId: data.monitor_id,
        message: "Created HetrixTools monitor",
        created: true
      };
    }

    // Already monitoring — resolve by URL
    if (/already monitoring/i.test(data.error_message || "")) {
      invalidateCache();
      const again = await findHetrixMonitorByUrl(url);
      if (again) {
        return {
          ok: true,
          monitorId: again.id,
          message: "HetrixTools already monitoring this URL",
          created: false
        };
      }
    }

    return {
      ok: false,
      monitorId: null,
      message: data.error_message || `HetrixTools add failed (${data.status || "unknown"})`,
      created: false
    };
  } catch (err) {
    return {
      ok: false,
      monitorId: null,
      message: err instanceof Error ? err.message : String(err),
      created: false
    };
  }
}

export async function deleteHetrixWebsiteMonitor(
  opts: { monitorId?: string | null; url?: string }
): Promise<{ ok: boolean; message: string }> {
  if (!hetrixEnabled()) {
    return { ok: true, message: "HetrixTools not configured" };
  }

  let mid = opts.monitorId?.trim() || "";
  if (!mid && opts.url) {
    const found = await findHetrixMonitorByUrl(opts.url);
    mid = found?.id || "";
  }
  if (!mid) {
    return { ok: true, message: "No HetrixTools monitor to delete" };
  }

  try {
    const data = (await v2Post("delete", { MID: mid })) as {
      status?: string;
      error_message?: string;
    };
    invalidateCache();
    if (String(data.status).toUpperCase() === "SUCCESS") {
      return { ok: true, message: "Deleted HetrixTools monitor" };
    }
    if (/does not exist/i.test(data.error_message || "")) {
      return { ok: true, message: "HetrixTools monitor already gone" };
    }
    return {
      ok: false,
      message: data.error_message || `HetrixTools delete failed (${data.status || "unknown"})`
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
