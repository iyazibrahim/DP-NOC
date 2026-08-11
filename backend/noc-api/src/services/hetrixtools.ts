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

export type HetrixDowntime = {
  id: string;
  start: number;
  end: number;
  maintenance: boolean;
};

export type HetrixDailyUptime = {
  /** Unix start of day (UTC) when known */
  dayStart: number | null;
  label: string;
  uptimePct: number | null;
};

export type HetrixUptimeReport = {
  uptimePct: number | null;
  downtimeCount: number | null;
  daily: HetrixDailyUptime[];
  /** Availability samples 0–1 */
  hourlySeries: Array<{ ts: number; value: number }>;
};

type CacheEntry = { at: number; monitors: HetrixMonitor[] };
type ReportCacheEntry = { at: number; report: HetrixUptimeReport };
type DowntimeCacheEntry = { at: number; downtimes: HetrixDowntime[] };

let cache: CacheEntry | null = null;
const reportCache = new Map<string, ReportCacheEntry>();
const downtimeCache = new Map<string, DowntimeCacheEntry>();
const CACHE_TTL_MS = 60_000;
const HISTORY_CACHE_TTL_MS = 180_000;

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
  reportCache.clear();
  downtimeCache.clear();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function normalizeUptimePct(raw: number | null): number | null {
  if (raw == null) return null;
  // Hetrix may return 0–1 or 0–100
  const pct = raw <= 1.5 ? raw * 100 : raw;
  return Math.round(pct * 10) / 10;
}

function parseDailyFromReport(data: Record<string, unknown>, days: number): HetrixDailyUptime[] {
  const candidates: unknown[] = [];
  for (const key of ["daily", "days", "day_stats", "stats"]) {
    const v = data[key];
    if (Array.isArray(v)) candidates.push(...v);
  }
  // Some payloads nest under data.uptime.daily
  const uptime = asRecord(data.uptime);
  if (uptime) {
    for (const key of ["daily", "days", "history"]) {
      const v = uptime[key];
      if (Array.isArray(v)) candidates.push(...v);
    }
  }

  const out: HetrixDailyUptime[] = [];
  for (const item of candidates) {
    const row = asRecord(item);
    if (!row) continue;
    const pct =
      normalizeUptimePct(numOrNull(row.uptime ?? row.percentage ?? row.uptime_percentage ?? row.value)) ??
      null;
    const ts =
      numOrNull(row.timestamp ?? row.ts ?? row.start ?? row.day ?? row.date_ts) ?? null;
    let label =
      typeof row.label === "string"
        ? row.label
        : typeof row.date === "string"
          ? row.date
          : typeof row.day === "string"
            ? row.day
            : "";
    let dayStart: number | null = null;
    if (ts != null) {
      dayStart = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
      if (!label) {
        label = new Date(dayStart * 1000).toISOString().slice(5, 10);
      }
    }
    if (!label && pct == null) continue;
    out.push({ dayStart, label: label || "—", uptimePct: pct });
  }

  if (out.length > 0) return out.slice(-days);

  // Fallback: history object keyed by YYYY-MM-DD or YYYY-MM
  const history = asRecord(data.history);
  if (history) {
    const keys = Object.keys(history).sort();
    for (const k of keys.slice(-days)) {
      const v = history[k];
      const row = asRecord(v);
      const pct = normalizeUptimePct(
        numOrNull(row ? row.uptime ?? row.percentage ?? row.value : typeof v === "number" ? v : null)
      );
      out.push({ dayStart: null, label: k.length >= 10 ? k.slice(5, 10) : k, uptimePct: pct });
    }
  }
  return out;
}

function parseHourlySeries(data: Record<string, unknown>): Array<{ ts: number; value: number }> {
  const buckets: unknown[] = [];
  for (const key of ["hourly", "hourly_stats", "hours"]) {
    const v = data[key];
    if (Array.isArray(v)) buckets.push(...v);
  }
  const stats = asRecord(data.hourly_stats);
  if (stats) {
    for (const v of Object.values(stats)) {
      if (Array.isArray(v)) buckets.push(...v);
      else if (asRecord(v)) buckets.push(v);
    }
  }

  const series: Array<{ ts: number; value: number }> = [];
  for (const item of buckets) {
    const row = asRecord(item);
    if (!row) continue;
    let ts = numOrNull(row.timestamp ?? row.ts ?? row.start ?? row.hour);
    if (ts == null) continue;
    if (ts > 1e12) ts = Math.floor(ts / 1000);
    const pct = normalizeUptimePct(
      numOrNull(row.uptime ?? row.percentage ?? row.uptime_percentage ?? row.value)
    );
    if (pct == null) continue;
    series.push({ ts, value: Math.max(0, Math.min(1, pct / 100)) });
  }
  series.sort((a, b) => a.ts - b.ts);
  return series;
}

/**
 * Build a coarse 0/1 availability series from downtime windows (1 = up).
 */
export function availabilitySeriesFromDowntimes(
  downtimes: HetrixDowntime[],
  startSec: number,
  endSec: number,
  stepSec: number
): Array<{ ts: number; value: number }> {
  const downs = downtimes
    .filter((d) => !d.maintenance)
    .map((d) => ({
      start: d.start,
      end: d.end > 0 ? d.end : endSec
    }))
    .filter((d) => d.end > startSec && d.start < endSec);

  const out: Array<{ ts: number; value: number }> = [];
  const step = Math.max(60, stepSec);
  for (let t = startSec; t <= endSec; t += step) {
    const down = downs.some((d) => t >= d.start && t < d.end);
    out.push({ ts: t, value: down ? 0 : 1 });
  }
  return out;
}

export function downtimesToOutages(
  downtimes: HetrixDowntime[],
  rangeStart: number,
  rangeEnd: number
): Array<{ start: number; end: number; durationSec: number; ongoing: boolean }> {
  const now = Math.floor(Date.now() / 1000);
  return downtimes
    .filter((d) => !d.maintenance)
    .map((d) => {
      const start = Math.max(d.start, rangeStart);
      const rawEnd = d.end > 0 ? d.end : rangeEnd;
      const end = Math.min(rawEnd, rangeEnd);
      const ongoing = !(d.end > 0) || d.end >= now - 60;
      return {
        start,
        end,
        durationSec: Math.max(0, end - start),
        ongoing
      };
    })
    .filter((o) => o.end > o.start && o.start < rangeEnd && o.end > rangeStart)
    .sort((a, b) => b.start - a.start);
}

export async function getHetrixUptimeReport(
  monitorId: string,
  opts: { days?: number; hourlyStats?: boolean } = {}
): Promise<HetrixUptimeReport | null> {
  if (!hetrixEnabled() || !monitorId.trim()) return null;
  const days = Math.min(30, Math.max(1, opts.days ?? 7));
  const hourlyStats = Boolean(opts.hourlyStats);
  const cacheKey = `${monitorId}:${days}:${hourlyStats ? 1 : 0}`;
  const hit = reportCache.get(cacheKey);
  if (hit && Date.now() - hit.at < HISTORY_CACHE_TTL_MS) return hit.report;

  try {
    const q = new URLSearchParams({
      days: String(days),
      timezone: "+00:00",
      hourly_stats: hourlyStats ? "true" : "false"
    });
    const raw = await v3Get(`/uptime-monitors/${encodeURIComponent(monitorId)}/report?${q}`);
    const root = asRecord(raw) ?? {};
    const data = asRecord(root.data) ?? root;
    const summary = asRecord(data.summary) ?? asRecord(root.summary) ?? {};
    const uptimeObj = asRecord(summary.uptime) ?? asRecord(data.uptime) ?? {};
    let uptimePct = normalizeUptimePct(
      numOrNull(
        uptimeObj.percentage ??
          uptimeObj.percentage_incl_maint ??
          uptimeObj.uptime ??
          summary.uptime_percentage ??
          summary.percentage ??
          data.uptime_percentage ??
          data.percentage ??
          root.uptime
      )
    );
    // Some plans return only daily points — average them for the window summary
    const daily = parseDailyFromReport(data, days);
    if (uptimePct == null && daily.length > 0) {
      const nums = daily.map((d) => d.uptimePct).filter((n): n is number => n != null);
      if (nums.length > 0) {
        uptimePct = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
      }
    }
    const downtimeCount =
      numOrNull(uptimeObj.downtimes ?? summary.downtimes ?? data.downtimes) ?? null;

    const report: HetrixUptimeReport = {
      uptimePct,
      downtimeCount,
      daily,
      hourlySeries: hourlyStats ? parseHourlySeries(data) : []
    };
    reportCache.set(cacheKey, { at: Date.now(), report });
    return report;
  } catch (err) {
    console.warn("[hetrixtools] report failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function listHetrixDowntimes(
  monitorId: string,
  opts: { startAfter?: number; startBefore?: number } = {}
): Promise<HetrixDowntime[]> {
  if (!hetrixEnabled() || !monitorId.trim()) return [];
  const cacheKey = `${monitorId}:${opts.startAfter ?? ""}:${opts.startBefore ?? ""}`;
  const hit = downtimeCache.get(cacheKey);
  if (hit && Date.now() - hit.at < HISTORY_CACHE_TTL_MS) return hit.downtimes;

  const downtimes: HetrixDowntime[] = [];
  try {
    let page = 1;
    for (;;) {
      const q = new URLSearchParams({
        per_page: "100",
        page: String(page)
      });
      if (opts.startAfter != null) q.set("start_after", String(opts.startAfter));
      if (opts.startBefore != null) q.set("start_before", String(opts.startBefore));
      const data = (await v3Get(
        `/uptime-monitors/${encodeURIComponent(monitorId)}/downtimes?${q}`
      )) as {
        downtimes?: Array<{
          id?: string;
          start?: number;
          end?: number;
          maintenance?: boolean;
        }>;
        meta?: { pagination?: { current?: number; last?: number } };
      };
      const batch = Array.isArray(data.downtimes) ? data.downtimes : [];
      for (const d of batch) {
        const start = numOrNull(d.start);
        if (start == null) continue;
        downtimes.push({
          id: String(d.id ?? `${start}`),
          start,
          end: numOrNull(d.end) ?? 0,
          maintenance: Boolean(d.maintenance)
        });
      }
      const last = data.meta?.pagination?.last ?? page;
      if (page >= last || batch.length === 0) break;
      page += 1;
      if (page > 20) break;
    }
    downtimeCache.set(cacheKey, { at: Date.now(), downtimes });
    return downtimes;
  } catch (err) {
    console.warn("[hetrixtools] downtimes failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Resolve monitor id from stored id or URL match. */
export async function resolveHetrixMonitorId(
  url: string,
  storedId?: string | null
): Promise<string | null> {
  const sid = storedId?.trim();
  if (sid) return sid;
  const mon = await findHetrixMonitorByUrl(url);
  return mon?.id ?? null;
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
