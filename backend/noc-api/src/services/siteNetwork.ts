import {
  promQuery,
  promQueryRange,
  parseFirstVectorValue,
  type PromQueryResult
} from "./prometheus";
import { getSiteById, type Site } from "../data/sites";
import { loadSiteStations } from "../data/siteStations";
import { dualSnmpUpFresh, probeSuccessFresh, METRIC_FRESH_WINDOW } from "./promLabels";
import { env } from "../env";
import {
  bucketVolumeDays,
  calendarMonthSlots,
  calendarWeekSlots,
  sumLineUseDays,
  ymdInZone,
  zonedDayStartUnix,
  type LineUseDay
} from "./lineUseWindow";

export type { LineUseDay };

function escapePromLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Seconds elapsed since local midnight in `timeZone` (IANA).
 * Used for calendar-day “Today” line-use (resets at 00:00).
 */
export function secondsSinceMidnightInTz(timeZone: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const h = num("hour");
  const m = num("minute");
  const s = num("second");
  if (![h, m, s].every((n) => Number.isFinite(n))) return 24 * 3600;
  return Math.max(0, h * 3600 + m * 60 + s);
}

/** Prom range selector for calendar Today, e.g. `15234s` (min 60s). */
export function calendarTodayPromRange(timeZone = env.NOC_TZ, now = new Date()): string {
  const sec = Math.max(60, secondsSinceMidnightInTz(timeZone, now));
  return `${sec}s`;
}

export type SnmpInterfaceInfo = {
  ifName: string;
  ifDescr?: string;
  ifIndex?: string;
};

export type SiteNetworkSeriesPoint = { ts: number; value: number };

export type SiteNetworkApRow = {
  deviceId: string;
  name: string;
  nickname: string | null;
  /** nickname if set, else inventory name — use for charts/table */
  label: string;
  vendor: string;
  clients: number | null;
  inBps: number | null;
  outBps: number | null;
  snmpUp: number | null;
};

export type SiteNetworkStation = {
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

export type SiteNetworkSummary = {
  siteId: string;
  wanUplink: Site["wanUplink"] | null;
  wanDeviceName: string | null;
  uplink: {
    dns: number | null;
    dns2: number | null;
    vps: number | null;
  };
  traffic: {
    inBps: number | null;
    outBps: number | null;
    utilInPct: number | null;
    utilOutPct: number | null;
    capacityBps: number | null;
  };
  trafficSeries: {
    inBps: SiteNetworkSeriesPoint[];
    outBps: SiteNetworkSeriesPoint[];
  };
  /** @deprecated prefer `aps` */
  clients: {
    total: number | null;
    byDevice: Array<{ deviceId: string; name: string; clients: number | null; vendor: string }>;
  };
  aps: SiteNetworkApRow[];
  /** Per-station Wi‑Fi clients (Cambium rich; Omada MAC-only when table walks). */
  stations: SiteNetworkStation[];
  speedtest: {
    available: boolean;
    downloadBps: number | null;
    uploadBps: number | null;
    pingMs: number | null;
    lastSuccessAt: number | null;
    downloadSeries: SiteNetworkSeriesPoint[];
    uploadSeries: SiteNetworkSeriesPoint[];
    message?: string;
  };
  /**
   * Line-use totals for Today, this week, and this month.
   * Byte totals are sums of local calendar days (see `days`).
   */
  utilWindows?: {
    "1d": SiteNetworkUtilWindow;
    "7d": SiteNetworkUtilWindow;
    "30d": SiteNetworkUtilWindow;
  };
  /** Access-point volume since midnight, and the busiest client. */
  todayBreakdown?: TodayLineBreakdown;
};

export type SiteNetworkUtilWindow = {
  avgInPct: number | null;
  avgOutPct: number | null;
  peakInPct: number | null;
  peakOutPct: number | null;
  /** Total octets downloaded (in) over the window. */
  inBytes: number | null;
  /** Total octets uploaded (out) over the window. */
  outBytes: number | null;
  /** Local calendar days, oldest first. The week is Monday–Sunday. The month is the current calendar month. */
  days?: LineUseDay[];
  /** YYYY-MM-DD of today in NOC_TZ, so a week view can mark the current day. */
  today?: string;
  /** Hourly octets for the calendar day. Set on the Today window. */
  hours?: TodayLineHour[];
};

export type TodayLineHour = { ts: number; inBytes: number; outBytes: number };

export type TodayApUse = {
  deviceId: string;
  label: string;
  clients: number | null;
  inBytes: number | null;
  outBytes: number | null;
};

export type TodayTopClient = {
  label: string;
  apLabel: string;
  inBytes: number | null;
  outBytes: number | null;
  inBps: number | null;
  outBps: number | null;
  /** True when the row is a live rate because the client has no byte counter. */
  live: boolean;
};

export type TodayLineBreakdown = {
  aps: TodayApUse[];
  topClient: TodayTopClient | null;
};

function parseSeries(data: PromQueryResult): SiteNetworkSeriesPoint[] {
  if (data.resultType !== "matrix" || !Array.isArray(data.result) || data.result.length === 0) {
    return [];
  }
  const row = data.result[0] as { values?: [number, string][] };
  if (!row.values?.length) return [];
  return row.values
    .map(([ts, v]) => {
      const n = Number(v);
      return { ts, value: Number.isFinite(n) ? n : 0 };
    })
    .filter((p) => Number.isFinite(p.ts));
}

function escapePromRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ifNameJoinMatcher(siteId: string, deviceId: string, ifName: string): string {
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  const indexOnly = /^ifIndex:(\d+)$/i.exec(ifName.trim());
  if (indexOnly) {
    return `ifHCInOctets{site="${s}",device="${d}",ifIndex="${indexOnly[1]}"}`;
  }
  const n = escapePromLabel(ifName);
  const nRe = escapePromRegex(ifName);
  return `(
  ifName{site="${s}",device="${d}",ifName="${n}"}
  or ifDescr{site="${s}",device="${d}",ifDescr="${n}"}
  or ifName{site="${s}",device="${d}",ifName=~"(?i)^${nRe}$"}
  or ifDescr{site="${s}",device="${d}",ifDescr=~"(?i)^${nRe}$"}
)`;
}

function buildIfTrafficQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string,
  ifName: string
): string {
  const octets = direction === "in" ? "ifHCInOctets" : "ifHCOutOctets";
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  const join = ifNameJoinMatcher(siteId, deviceId, ifName);
  const indexOnly = /^ifIndex:(\d+)$/i.test(ifName.trim());
  if (indexOnly) {
    const idx = /^ifIndex:(\d+)$/i.exec(ifName.trim())![1];
    return `sum(rate(${octets}{site="${s}",device="${d}",ifIndex="${idx}"}[5m]) * 8)`;
  }
  return `sum(
  rate(${octets}{site="${s}",device="${d}"}[5m]) * 8
  and on(ifIndex) ${join}
)`;
}

function buildDeviceTrafficQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string
): string {
  const octets = direction === "in" ? "ifHCInOctets" : "ifHCOutOctets";
  return `sum(rate(${octets}{site="${escapePromLabel(siteId)}",device="${escapePromLabel(deviceId)}"}[5m]) * 8)`;
}

function buildIfCapacityQuery(siteId: string, deviceId: string, ifName: string): string {
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  const indexOnly = /^ifIndex:(\d+)$/i.exec(ifName.trim());
  if (indexOnly) {
    const idx = indexOnly[1];
    return `(sum(ifHighSpeed{site="${s}",device="${d}",ifIndex="${idx}"} * 1000000) > 0)
  or sum(ifSpeed{site="${s}",device="${d}",ifIndex="${idx}"} > 0)`;
  }
  const join = ifNameJoinMatcher(siteId, deviceId, ifName);
  return `(sum(ifHighSpeed{site="${s}",device="${d}"} * 1000000 and on(ifIndex) ${join}) > 0)
  or sum(ifSpeed{site="${s}",device="${d}"} and on(ifIndex) ${join})`;
}

function buildIfUtilQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string,
  ifName: string
): string {
  const cap = `clamp_min((${buildIfCapacityQuery(siteId, deviceId, ifName)}), 1)`;
  return `(${buildIfTrafficQuery(direction, siteId, deviceId, ifName)} / ${cap}) * 100`;
}

/**
 * Octets transferred over `range` on the tagged WAN interface.
 * `max by (ifIndex)` keeps one counter when the same interface is written twice.
 */
function buildIfVolumeQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string,
  ifName: string,
  range: string
): string {
  const octets = direction === "in" ? "ifHCInOctets" : "ifHCOutOctets";
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  const indexOnly = /^ifIndex:(\d+)$/i.exec(ifName.trim());
  const increaseExpr = indexOnly
    ? `increase(${octets}{site="${s}",device="${d}",ifIndex="${indexOnly[1]}"}[${range}])`
    : `increase(${octets}{site="${s}",device="${d}"}[${range}]) and on(ifIndex) ${ifNameJoinMatcher(siteId, deviceId, ifName)}`;
  return `sum(max by (ifIndex) (${increaseExpr}))`;
}

function collectInterfacesFromProm(
  data: PromQueryResult,
  labelKeys: string[]
): Map<string, SnmpInterfaceInfo> {
  const seen = new Map<string, SnmpInterfaceInfo>();
  if (data.resultType !== "vector" || !Array.isArray(data.result)) return seen;
  for (const row of data.result as Array<{ metric?: Record<string, string> }>) {
    const m = row.metric ?? {};
    let name = "";
    for (const key of labelKeys) {
      if (m[key]?.trim()) {
        name = m[key].trim();
        break;
      }
    }
    if (!name && m.ifIndex) name = `ifIndex:${m.ifIndex}`;
    if (!name) continue;
    if (!seen.has(name)) {
      seen.set(name, {
        ifName: name,
        ifDescr: m.ifDescr,
        ifIndex: m.ifIndex
      });
    }
  }
  return seen;
}

export async function listDeviceInterfaces(
  siteId: string,
  deviceId: string
): Promise<SnmpInterfaceInfo[]> {
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  const seen = new Map<string, SnmpInterfaceInfo>();
  try {
    const [byName, byDescr, byOper, byOctets] = await Promise.all([
      promQuery(`ifName{site="${s}",device="${d}"}`).catch(() => null),
      promQuery(`ifDescr{site="${s}",device="${d}"}`).catch(() => null),
      promQuery(`ifOperStatus{site="${s}",device="${d}"}`).catch(() => null),
      promQuery(`ifHCInOctets{site="${s}",device="${d}"}`).catch(() => null)
    ]);
    if (byName) {
      for (const [k, v] of collectInterfacesFromProm(byName, ["ifName"])) seen.set(k, v);
    }
    if (byDescr) {
      for (const [k, v] of collectInterfacesFromProm(byDescr, ["ifDescr", "ifName"])) {
        if (!seen.has(k)) seen.set(k, v);
      }
    }
    if (seen.size === 0 && byOper) {
      for (const [k, v] of collectInterfacesFromProm(byOper, ["ifName", "ifDescr"])) seen.set(k, v);
    }
    if (seen.size === 0 && byOctets) {
      for (const [k, v] of collectInterfacesFromProm(byOctets, ["ifName", "ifDescr"])) seen.set(k, v);
    }
  } catch {
    return [];
  }
  return [...seen.values()].sort((a, b) => a.ifName.localeCompare(b.ifName));
}

const SUMMARY_CACHE_MS = 20_000;
const summaryCache = new Map<string, { at: number; value: SiteNetworkSummary | null }>();
const summaryInflight = new Map<string, Promise<SiteNetworkSummary | null>>();

export function getSiteNetworkSummary(siteId: string, hours = 24): Promise<SiteNetworkSummary | null> {
  const key = `${siteId}:${Math.max(1, Math.round(hours))}`;
  const hit = summaryCache.get(key);
  if (hit && Date.now() - hit.at < SUMMARY_CACHE_MS) return Promise.resolve(hit.value);
  const pending = summaryInflight.get(key);
  if (pending) return pending;
  const job = loadSiteNetworkSummary(siteId, hours).then(
    (value) => {
      summaryCache.set(key, { at: Date.now(), value });
      summaryInflight.delete(key);
      return value;
    },
    (err: unknown) => {
      summaryInflight.delete(key);
      throw err;
    }
  );
  summaryInflight.set(key, job);
  return job;
}

async function loadSiteNetworkSummary(
  siteId: string,
  hours = 24
): Promise<SiteNetworkSummary | null> {
  const site = getSiteById(siteId);
  if (!site) return null;

  const wanUplink = site.wanUplink ?? null;
  const wanDevice = wanUplink
    ? site.devices.find((d) => d.id === wanUplink.deviceId) ?? null
    : null;

  let dns: number | null = null;
  let dns2: number | null = null;
  let vps: number | null = null;
  try {
    dns = parseFirstVectorValue(await promQuery(probeSuccessFresh(siteId, "wan_dns", METRIC_FRESH_WINDOW)));
    dns2 = parseFirstVectorValue(await promQuery(probeSuccessFresh(siteId, "wan_dns2", METRIC_FRESH_WINDOW)));
    vps = parseFirstVectorValue(await promQuery(probeSuccessFresh(siteId, "wan_vps", METRIC_FRESH_WINDOW)));
  } catch {
    /* ignore */
  }

  const traffic = {
    inBps: null as number | null,
    outBps: null as number | null,
    utilInPct: null as number | null,
    utilOutPct: null as number | null,
    capacityBps: null as number | null
  };
  let inSeries: SiteNetworkSeriesPoint[] = [];
  let outSeries: SiteNetworkSeriesPoint[] = [];

  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.max(1, hours) * 3600;
  const step = hours >= 720 ? "1h" : hours > 48 ? "15m" : hours > 6 ? "5m" : "60s";

  if (wanUplink) {
    try {
      const [inBps, outBps, utilIn, utilOut, cap] = await Promise.all([
        parseFirstVectorValue(
          await promQuery(buildIfTrafficQuery("in", siteId, wanUplink.deviceId, wanUplink.ifName))
        ),
        parseFirstVectorValue(
          await promQuery(buildIfTrafficQuery("out", siteId, wanUplink.deviceId, wanUplink.ifName))
        ),
        parseFirstVectorValue(
          await promQuery(buildIfUtilQuery("in", siteId, wanUplink.deviceId, wanUplink.ifName))
        ),
        parseFirstVectorValue(
          await promQuery(buildIfUtilQuery("out", siteId, wanUplink.deviceId, wanUplink.ifName))
        ),
        parseFirstVectorValue(
          await promQuery(buildIfCapacityQuery(siteId, wanUplink.deviceId, wanUplink.ifName))
        )
      ]);
      traffic.inBps = inBps;
      traffic.outBps = outBps;
      traffic.utilInPct = utilIn != null ? Math.round(utilIn * 10) / 10 : null;
      traffic.utilOutPct = utilOut != null ? Math.round(utilOut * 10) / 10 : null;
      traffic.capacityBps = cap;

      const [inRange, outRange] = await Promise.all([
        promQueryRange(
          buildIfTrafficQuery("in", siteId, wanUplink.deviceId, wanUplink.ifName),
          start,
          end,
          step
        ),
        promQueryRange(
          buildIfTrafficQuery("out", siteId, wanUplink.deviceId, wanUplink.ifName),
          start,
          end,
          step
        )
      ]);
      inSeries = parseSeries(inRange);
      outSeries = parseSeries(outRange);
    } catch {
      /* keep nulls */
    }
  }

  const [aps, stations] = await Promise.all([
    collectApRows(siteId, site),
    collectStations(siteId, site)
  ]);
  let totalClients = 0;
  let anyClient = false;
  for (const row of aps) {
    if (row.clients != null) {
      anyClient = true;
      totalClients += row.clients;
    }
  }

  const speedtest = await collectSpeedtest(siteId, start, end, step);

  const utilWindows = wanUplink
    ? await collectUtilWindows(siteId, wanUplink.deviceId, wanUplink.ifName)
    : undefined;

  return {
    siteId,
    wanUplink,
    wanDeviceName: wanDevice?.name ?? null,
    uplink: { dns, dns2, vps },
    traffic,
    trafficSeries: { inBps: inSeries, outBps: outSeries },
    clients: {
      total: anyClient ? totalClients : null,
      byDevice: aps.map((a) => ({
        deviceId: a.deviceId,
        name: a.label,
        clients: a.clients,
        vendor: a.vendor
      }))
    },
    aps,
    stations,
    speedtest,
    utilWindows,
    todayBreakdown: await collectTodayBreakdown(siteId, aps, stations).catch(() => undefined)
  };
}

const LINE_USE_HOUR = 3600;

function parseVolumeMatrix(data: PromQueryResult): Array<{ ts: number; value: number }> {
  if (data.resultType !== "matrix" || !Array.isArray(data.result)) return [];
  const out: Array<{ ts: number; value: number }> = [];
  for (const row of data.result as Array<{ values?: [number, string][] }>) {
    for (const [ts, raw] of row.values ?? []) {
      const n = Number(raw);
      if (!Number.isFinite(ts) || !Number.isFinite(n) || n < 0) continue;
      out.push({ ts, value: n });
    }
  }
  return out;
}

/**
 * Hourly counter increases from the start of the oldest calendar day through now,
 * plus the unfinished current hour (query_range only lands on the hour).
 */
async function loadHourlyVolume(
  direction: "in" | "out",
  siteId: string,
  deviceId: string,
  ifName: string,
  windowStart: number,
  nowSec: number
): Promise<Array<{ ts: number; value: number }>> {
  const series = parseVolumeMatrix(
    await promQueryRange(
      buildIfVolumeQuery(direction, siteId, deviceId, ifName, "1h"),
      windowStart,
      nowSec,
      String(LINE_USE_HOUR)
    )
  ).filter((point) => point.ts > windowStart && point.ts <= nowSec + 1);

  const last = series.reduce((max, point) => Math.max(max, point.ts), 0);
  const gap = last > 0 ? nowSec - last : 0;
  if (last > 0 && gap >= 30 && gap < LINE_USE_HOUR) {
    try {
      const extra = parseFirstVectorValue(
        await promQuery(
          buildIfVolumeQuery(direction, siteId, deviceId, ifName, `${Math.round(gap)}s`),
          nowSec
        )
      );
      if (extra != null && Number.isFinite(extra) && extra >= 0) {
        series.push({ ts: nowSec, value: extra });
      }
    } catch {
      /* Completed hours still count when the current partial hour cannot be read. */
    }
  }
  return series;
}

export async function collectLineUseDays(
  siteId: string,
  deviceId: string,
  ifName: string,
  now = new Date()
): Promise<{ monthDays: LineUseDay[]; weekDays: LineUseDay[]; today: string; todayHours: TodayLineHour[] }> {
  const monthSlots = calendarMonthSlots(env.NOC_TZ, now);
  const weekSlots = calendarWeekSlots(env.NOC_TZ, now);
  const windowStart = Math.min(
    monthSlots[0]?.start ?? Math.floor(now.getTime() / 1000),
    weekSlots[0]?.start ?? Infinity
  );
  const nowSec = Math.floor(now.getTime() / 1000);
  const todayStart = zonedDayStartUnix(env.NOC_TZ, now, 0);
  const [inbound, outbound] = await Promise.all([
    loadHourlyVolume("in", siteId, deviceId, ifName, windowStart, nowSec),
    loadHourlyVolume("out", siteId, deviceId, ifName, windowStart, nowSec)
  ]);
  return {
    monthDays: bucketVolumeDays(monthSlots, inbound, outbound, nowSec),
    weekDays: bucketVolumeDays(weekSlots, inbound, outbound, nowSec),
    today: ymdInZone(env.NOC_TZ, todayStart),
    todayHours: hoursFromSamples(inbound, outbound, todayStart, nowSec)
  };
}

function hoursFromSamples(
  inbound: Array<{ ts: number; value: number }>,
  outbound: Array<{ ts: number; value: number }>,
  todayStart: number,
  nowSec: number
): TodayLineHour[] {
  const byTs = new Map<number, { inBytes: number; outBytes: number }>();
  const add = (samples: Array<{ ts: number; value: number }>, dir: "in" | "out") => {
    for (const sample of samples) {
      if (sample.ts <= todayStart || sample.ts > nowSec + 1) continue;
      const row = byTs.get(sample.ts) ?? { inBytes: 0, outBytes: 0 };
      if (dir === "in") row.inBytes += sample.value;
      else row.outBytes += sample.value;
      byTs.set(sample.ts, row);
    }
  };
  add(inbound, "in");
  add(outbound, "out");
  return [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, row]) => ({
      ts,
      inBytes: Math.round(row.inBytes),
      outBytes: Math.round(row.outBytes)
    }));
}

async function collectUtilWindows(
  siteId: string,
  deviceId: string,
  ifName: string
): Promise<NonNullable<SiteNetworkSummary["utilWindows"]>> {
  const utilIn = buildIfUtilQuery("in", siteId, deviceId, ifName);
  const utilOut = buildIfUtilQuery("out", siteId, deviceId, ifName);

  const roundPct = (v: number | null) =>
    v != null && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;

  const roundBytes = (v: number | null) =>
    v != null && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

  const emptyPercents = () => ({
    avgInPct: null as number | null,
    avgOutPct: null as number | null,
    peakInPct: null as number | null,
    peakOutPct: null as number | null
  });

  const queryPercents = async (utilRange: string) => {
    try {
      const step = utilRange.endsWith("s") || utilRange.endsWith("m") ? "5m" : "1h";
      const [avgIn, avgOut, peakIn, peakOut] = await Promise.all([
        parseFirstVectorValue(await promQuery(`avg_over_time((${utilIn})[${utilRange}:${step}])`)),
        parseFirstVectorValue(await promQuery(`avg_over_time((${utilOut})[${utilRange}:${step}])`)),
        parseFirstVectorValue(await promQuery(`max_over_time((${utilIn})[${utilRange}:${step}])`)),
        parseFirstVectorValue(await promQuery(`max_over_time((${utilOut})[${utilRange}:${step}])`))
      ]);
      return {
        avgInPct: roundPct(avgIn),
        avgOutPct: roundPct(avgOut),
        peakInPct: roundPct(peakIn),
        peakOutPct: roundPct(peakOut)
      };
    } catch {
      return emptyPercents();
    }
  };

  const queryRawVolume = async (range: string) => {
    try {
      const [inBytes, outBytes] = await Promise.all([
        parseFirstVectorValue(await promQuery(buildIfVolumeQuery("in", siteId, deviceId, ifName, range))),
        parseFirstVectorValue(await promQuery(buildIfVolumeQuery("out", siteId, deviceId, ifName, range)))
      ]);
      return { inBytes: roundBytes(inBytes), outBytes: roundBytes(outBytes) };
    } catch {
      return { inBytes: null, outBytes: null };
    }
  };

  // Today is the calendar day. This week is Monday–Sunday. This month is the current
  // calendar month in NOC_TZ (28–31 days) and resets on the first.
  const todayRange = calendarTodayPromRange();
  const [p1, p7, p30, collected] = await Promise.all([
    queryPercents(todayRange),
    queryPercents("7d"),
    queryPercents("30d"),
    collectLineUseDays(siteId, deviceId, ifName).catch(() => null)
  ]);

  let b1: { inBytes: number | null; outBytes: number | null };
  let b7: { inBytes: number | null; outBytes: number | null };
  let b30: { inBytes: number | null; outBytes: number | null };
  let monthRows: LineUseDay[] | undefined;
  let weekRows: LineUseDay[] | undefined;
  let todayKey: string | undefined;
  let todayHours: TodayLineHour[] | undefined;
  if (collected) {
    monthRows = collected.monthDays;
    weekRows = collected.weekDays;
    todayKey = collected.today;
    todayHours = collected.todayHours;
    b1 = sumLineUseDays(collected.monthDays.filter((day) => day.date === collected.today));
    b7 = sumLineUseDays(collected.weekDays);
    b30 = sumLineUseDays(collected.monthDays);
  } else {
    [b1, b7, b30] = await Promise.all([
      queryRawVolume(todayRange),
      queryRawVolume("7d"),
      queryRawVolume("30d")
    ]);
  }

  return {
    "1d": { ...p1, ...b1, hours: todayHours, today: todayKey },
    "7d": { ...p7, ...b7, days: weekRows, today: todayKey },
    "30d": { ...p30, ...b30, days: monthRows, today: todayKey }
  };
}

async function collectTodayBreakdown(
  siteId: string,
  aps: SiteNetworkApRow[],
  stations: SiteNetworkStation[]
): Promise<TodayLineBreakdown> {
  const range = calendarTodayPromRange();
  const s = escapePromLabel(siteId);
  const apIds = new Set(aps.map((ap) => ap.deviceId));
  const [inRows, outRows, rxRows, txRows] = await Promise.all([
    readPromDeviceValues(
      `sum by (device) (max by (device, ifIndex) (increase(ifHCInOctets{site="${s}"}[${range}])))`
    ),
    readPromDeviceValues(
      `sum by (device) (max by (device, ifIndex) (increase(ifHCOutOctets{site="${s}"}[${range}])))`
    ),
    readPromLabeledValues(
      `max by (device, clientIndex) (increase(cambiumClientRxDataBytes{site="${s}"}[${range}]))`
    ),
    readPromLabeledValues(
      `max by (device, clientIndex) (increase(cambiumClientTxDataBytes{site="${s}"}[${range}]))`
    )
  ]);
  const inByDevice = new Map(inRows.map((row) => [row.deviceId, row.value]));
  const outByDevice = new Map(outRows.map((row) => [row.deviceId, row.value]));
  const apUses: TodayApUse[] = aps
    .map((ap) => {
      const inbound = inByDevice.get(ap.deviceId);
      const outbound = outByDevice.get(ap.deviceId);
      return {
        deviceId: ap.deviceId,
        label: ap.label,
        clients: ap.clients,
        inBytes: inbound != null && inbound >= 0 ? Math.round(inbound) : null,
        outBytes: outbound != null && outbound >= 0 ? Math.round(outbound) : null
      };
    })
    .sort((a, b) => (b.inBytes ?? 0) + (b.outBytes ?? 0) - ((a.inBytes ?? 0) + (a.outBytes ?? 0)));

  const identity = new Map<string, { label: string; apLabel: string }>();
  for (const st of loadSiteStations(siteId)?.stations ?? []) {
    const idx = (st.clientIndex || "").trim();
    if (!st.deviceId || !idx) continue;
    identity.set(`${st.deviceId}|${idx}`, {
      label: st.hostname || st.mac || `Client ${idx}`,
      apLabel: st.apLabel || aps.find((ap) => ap.deviceId === st.deviceId)?.label || st.deviceId
    });
  }

  const clients = new Map<
    string,
    { deviceId: string; clientIndex: string; inBytes: number; outBytes: number }
  >();
  const addClient = (rows: PromLabeledRow[], dir: "in" | "out") => {
    for (const row of rows) {
      const deviceId = (row.metric.device || "").trim();
      const clientIndex = (row.metric.clientIndex || "").trim();
      if (!deviceId || !clientIndex || !apIds.has(deviceId)) continue;
      if (!Number.isFinite(row.value) || row.value < 0) continue;
      const key = `${deviceId}|${clientIndex}`;
      const acc = clients.get(key) ?? { deviceId, clientIndex, inBytes: 0, outBytes: 0 };
      if (dir === "in") acc.inBytes += row.value;
      else acc.outBytes += row.value;
      clients.set(key, acc);
    }
  };
  addClient(rxRows, "in");
  addClient(txRows, "out");

  let topClient: TodayTopClient | null = null;
  let best = -1;
  for (const acc of clients.values()) {
    const total = acc.inBytes + acc.outBytes;
    if (total <= best) continue;
    best = total;
    const who = identity.get(`${acc.deviceId}|${acc.clientIndex}`);
    const ap = aps.find((row) => row.deviceId === acc.deviceId);
    topClient = {
      label: who?.label || `Client ${acc.clientIndex}`,
      apLabel: who?.apLabel || ap?.label || acc.deviceId,
      inBytes: Math.round(acc.inBytes),
      outBytes: Math.round(acc.outBytes),
      inBps: null,
      outBps: null,
      live: false
    };
  }

  if (!topClient) {
    const live = [...stations].sort(
      (a, b) => (b.inBps ?? 0) + (b.outBps ?? 0) - ((a.inBps ?? 0) + (a.outBps ?? 0))
    )[0];
    if (live && ((live.inBps ?? 0) > 0 || (live.outBps ?? 0) > 0)) {
      topClient = {
        label: live.hostname || live.mac || "Client",
        apLabel: live.apLabel,
        inBytes: null,
        outBytes: null,
        inBps: live.inBps,
        outBps: live.outBps,
        live: true
      };
    }
  }

  return { aps: apUses, topClient };
}

function isApLikeDevice(d: { type: string; kind: string; vendor: string }): boolean {
  if (d.kind !== "network") return false;
  const type = (d.type || "").toLowerCase();
  const vendor = (d.vendor || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (type === "ap" || /access.?point|wifi|wireless/.test(type)) return true;
  if (/cambium|omada|tplink|ubiquiti|unifi/.test(vendor)) return true;
  return false;
}

function normalizeVendorKey(vendor: string): string {
  return (vendor || "generic").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function readPromDeviceValues(
  query: string
): Promise<Array<{ deviceId: string; value: number }>> {
  try {
    const data = await promQuery(query);
    if (data.resultType !== "vector" || !Array.isArray(data.result)) return [];
    const out: Array<{ deviceId: string; value: number }> = [];
    for (const row of data.result as Array<{
      metric?: Record<string, string>;
      value?: [number, string];
    }>) {
      const deviceId = (row.metric?.device || "").trim();
      const n = Number(row.value?.[1]);
      if (!deviceId || !Number.isFinite(n)) continue;
      out.push({ deviceId, value: n });
    }
    return out;
  } catch {
    return [];
  }
}

function deviceLabel(d: { name: string; nickname?: string } | undefined, fallback: string): {
  name: string;
  nickname: string | null;
  label: string;
} {
  const name = d?.name?.trim() || fallback;
  const nickname = d?.nickname?.trim() ? d.nickname.trim() : null;
  return { name, nickname, label: nickname || name };
}

async function collectApRows(siteId: string, site: Site): Promise<SiteNetworkApRow[]> {
  const s = escapePromLabel(siteId);
  const inventoryAps = site.devices.filter(isApLikeDevice);
  const byId = new Map<string, SiteNetworkApRow>();

  for (const ap of inventoryAps) {
    const labels = deviceLabel(ap, ap.id);
    byId.set(ap.id, {
      deviceId: ap.id,
      name: labels.name,
      nickname: labels.nickname,
      label: labels.label,
      vendor: ap.vendor || "generic",
      clients: null,
      inBps: null,
      outBps: null,
      snmpUp: null
    });
  }

  const [cambiumRows, omadaRows] = await Promise.all([
    readPromDeviceValues(`cambiumAPTotalClients{site="${s}"}`),
    readPromDeviceValues(`omadaClientCount{site="${s}"}`)
  ]);

  for (const row of cambiumRows) {
    const existing = byId.get(row.deviceId);
    if (existing) {
      existing.clients = (existing.clients ?? 0) + row.value;
      if (normalizeVendorKey(existing.vendor) === "generic") existing.vendor = "cambium";
    } else {
      const inv = site.devices.find((d) => d.id === row.deviceId);
      const labels = deviceLabel(inv, row.deviceId);
      byId.set(row.deviceId, {
        deviceId: row.deviceId,
        name: labels.name,
        nickname: labels.nickname,
        label: labels.label,
        vendor: inv?.vendor || "cambium",
        clients: row.value,
        inBps: null,
        outBps: null,
        snmpUp: null
      });
    }
  }

  for (const row of omadaRows) {
    const existing = byId.get(row.deviceId);
    if (existing) {
      existing.clients = (existing.clients ?? 0) + row.value;
      if (normalizeVendorKey(existing.vendor) === "generic") existing.vendor = "omada";
    } else {
      const inv = site.devices.find((d) => d.id === row.deviceId);
      const labels = deviceLabel(inv, row.deviceId);
      byId.set(row.deviceId, {
        deviceId: row.deviceId,
        name: labels.name,
        nickname: labels.nickname,
        label: labels.label,
        vendor: inv?.vendor || "omada",
        clients: row.value,
        inBps: null,
        outBps: null,
        snmpUp: null
      });
    }
  }

  for (const ap of inventoryAps) {
    const row = byId.get(ap.id);
    if (!row || row.clients != null) continue;
    const vendor = normalizeVendorKey(ap.vendor);
    try {
      if (vendor === "cambium") {
        row.clients = parseFirstVectorValue(
          await promQuery(
            `sum(cambiumAPTotalClients{site="${s}",device="${escapePromLabel(ap.id)}"})`
          )
        );
      } else if (vendor === "omada" || vendor === "tplink") {
        row.clients = parseFirstVectorValue(
          await promQuery(`omadaClientCount{site="${s}",device="${escapePromLabel(ap.id)}"}`)
        );
      }
    } catch {
      /* leave null */
    }
  }

  await Promise.all(
    [...byId.values()].map(async (row) => {
      try {
        const [inBps, outBps, snmpUp] = await Promise.all([
          parseFirstVectorValue(await promQuery(buildDeviceTrafficQuery("in", siteId, row.deviceId))),
          parseFirstVectorValue(await promQuery(buildDeviceTrafficQuery("out", siteId, row.deviceId))),
          parseFirstVectorValue(await promQuery(dualSnmpUpFresh(siteId, row.deviceId, METRIC_FRESH_WINDOW)))
        ]);
        row.inBps = inBps;
        row.outBps = outBps;
        row.snmpUp = snmpUp;
      } catch {
        /* leave nulls */
      }
    })
  );

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

type PromLabeledRow = {
  metric: Record<string, string>;
  value: number;
};

async function readPromLabeledValues(query: string): Promise<PromLabeledRow[]> {
  try {
    const data = await promQuery(query);
    if (data.resultType !== "vector" || !Array.isArray(data.result)) return [];
    const out: PromLabeledRow[] = [];
    for (const row of data.result as Array<{
      metric?: Record<string, string>;
      value?: [number, string];
    }>) {
      const n = Number(row.value?.[1]);
      if (!Number.isFinite(n) || !row.metric) continue;
      out.push({ metric: row.metric, value: n });
    }
    return out;
  } catch {
    return [];
  }
}

function stationKey(deviceId: string, clientIndex: string, mac: string | null): string {
  if (mac) return `${deviceId}|mac:${mac.toLowerCase()}`;
  return `${deviceId}|idx:${clientIndex}`;
}

function cleanLabel(v: string | undefined | null): string | null {
  const t = (v || "").trim();
  if (!t || t === "<nil>" || t === "0.0.0.0") return null;
  return t;
}

/** Normalize MAC from Prom SNMP labels (binary PhysAddress or Omada ASCII Hex-STRING). */
function formatMacLabel(v: string | undefined | null): string | null {
  let t = cleanLabel(v);
  if (!t) return null;
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }

  // Spaced Hex-STRING: 6 bytes = binary MAC; longer = Omada ASCII "AA-BB-CC-DD-EE-FF"
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

async function collectStations(siteId: string, site: Site): Promise<SiteNetworkStation[]> {
  const s = escapePromLabel(siteId);
  const apLabelById = new Map<string, { label: string; vendor: string }>();
  for (const d of site.devices.filter(isApLikeDevice)) {
    const labels = deviceLabel(d, d.id);
    apLabelById.set(d.id, { label: labels.label, vendor: d.vendor || "generic" });
  }

  const byKey = new Map<string, SiteNetworkStation & { clientIndex?: string }>();

  const ensureRow = (
    deviceId: string,
    clientIndex: string,
    macRaw: string | undefined,
    vendorFallback: string
  ): SiteNetworkStation & { clientIndex?: string } => {
    const mac = formatMacLabel(macRaw);
    const key = stationKey(deviceId, clientIndex, mac);
    let row = byKey.get(key);
    if (!row) {
      const inv = apLabelById.get(deviceId);
      row = {
        deviceId,
        apLabel: inv?.label || deviceId,
        vendor: inv?.vendor || vendorFallback,
        mac,
        hostname: null,
        ip: null,
        ssid: null,
        snr: null,
        txRate: null,
        inBps: null,
        outBps: null,
        clientOs: null,
        hwMode: null,
        clientIndex
      };
      byKey.set(key, row);
    } else if (mac && !row.mac) {
      row.mac = mac;
    }
    return row;
  };

  const [infoRows, snrRows, txBpsRows, rxBpsRows, omadaRows] = await Promise.all([
    readPromLabeledValues(`cambiumClientInfo{site="${s}"}`),
    readPromLabeledValues(`cambiumClientSNR{site="${s}"}`),
    readPromLabeledValues(`rate(cambiumClientTxDataBytes{site="${s}"}[5m]) * 8`),
    readPromLabeledValues(`rate(cambiumClientRxDataBytes{site="${s}"}[5m]) * 8`),
    readPromLabeledValues(`omadaClientInfo{site="${s}"}`)
  ]);

  for (const row of infoRows) {
    const deviceId = (row.metric.device || "").trim();
    const clientIndex = (row.metric.clientIndex || "").trim();
    if (!deviceId || !clientIndex) continue;
    const st = ensureRow(deviceId, clientIndex, row.metric.mac, "cambium");
    st.hostname = cleanLabel(row.metric.client_name) ?? st.hostname;
    st.ip = cleanLabel(row.metric.client_ip) ?? st.ip;
    st.ssid = cleanLabel(row.metric.ssid) ?? st.ssid;
    st.txRate = cleanLabel(row.metric.tx_rate) ?? st.txRate;
    st.clientOs = cleanLabel(row.metric.client_os) ?? st.clientOs;
    st.hwMode = cleanLabel(row.metric.hw_mode) ?? st.hwMode;
    if (normalizeVendorKey(st.vendor) === "generic") st.vendor = "cambium";
  }

  for (const row of snrRows) {
    const deviceId = (row.metric.device || "").trim();
    const clientIndex = (row.metric.clientIndex || "").trim();
    if (!deviceId || !clientIndex) continue;
    const st = ensureRow(deviceId, clientIndex, row.metric.mac, "cambium");
    st.snr = Number.isFinite(row.value) ? Math.round(row.value) : st.snr;
  }

  // Cambium TxDataBytes = bytes transmitted by the client (uplink from client → AP).
  // RxDataBytes = bytes received by the client (downlink AP → client).
  // UI "In" = download to client (rx), "Out" = upload from client (tx).
  for (const row of rxBpsRows) {
    const deviceId = (row.metric.device || "").trim();
    const clientIndex = (row.metric.clientIndex || "").trim();
    if (!deviceId || !clientIndex) continue;
    const st = ensureRow(deviceId, clientIndex, row.metric.mac, "cambium");
    st.inBps = Number.isFinite(row.value) && row.value >= 0 ? row.value : st.inBps;
  }
  for (const row of txBpsRows) {
    const deviceId = (row.metric.device || "").trim();
    const clientIndex = (row.metric.clientIndex || "").trim();
    if (!deviceId || !clientIndex) continue;
    const st = ensureRow(deviceId, clientIndex, row.metric.mac, "cambium");
    st.outBps = Number.isFinite(row.value) && row.value >= 0 ? row.value : st.outBps;
  }

  for (const row of omadaRows) {
    const deviceId = (row.metric.device || "").trim();
    const clientIndex = (row.metric.clientIndex || "").trim();
    if (!deviceId || !clientIndex) continue;
    const st = ensureRow(deviceId, clientIndex, row.metric.mac, "omada");
    if (normalizeVendorKey(st.vendor) === "generic") st.vendor = "omada";
  }

  let stations: SiteNetworkStation[] = [...byKey.values()].map(({ clientIndex: _ci, ...rest }) => rest);

  // Prometheus rows carry SNR and byte rates, but not hostname/MAC/IP (those lookups
  // crash snmp_exporter). The collector walk is the identity source and must win
  // even when Prometheus already has a row per client index.
  const stored = loadSiteStations(siteId);
  const storedAt = stored ? Date.parse(stored.at) : NaN;
  const storedFresh = Number.isFinite(storedAt) && Date.now() - storedAt < 10 * 60 * 1000;
  const identified = (stored?.stations ?? []).filter((st) => st.mac || st.hostname || st.ip);
  if (storedFresh && identified.length > 0) {
    const promByIdx = new Map<
      string,
      { snr: number | null; inBps: number | null; outBps: number | null }
    >();
    for (const row of byKey.values()) {
      const idx = (row.clientIndex || "").trim();
      if (!idx) continue;
      promByIdx.set(`${row.deviceId}|${idx}`, {
        snr: row.snr,
        inBps: row.inBps,
        outBps: row.outBps
      });
    }
    stations = identified.map((st) => {
      const idx = (st.clientIndex || "").trim();
      const live = idx ? promByIdx.get(`${st.deviceId}|${idx}`) : undefined;
      return {
        deviceId: st.deviceId,
        apLabel: st.apLabel || apLabelById.get(st.deviceId)?.label || st.deviceId,
        vendor: st.vendor || apLabelById.get(st.deviceId)?.vendor || "generic",
        mac: st.mac,
        hostname: st.hostname,
        ip: st.ip,
        ssid: st.ssid,
        snr: live?.snr ?? st.snr,
        txRate: st.txRate,
        inBps: live?.inBps ?? st.inBps,
        outBps: live?.outBps ?? st.outBps,
        clientOs: st.clientOs,
        hwMode: st.hwMode
      };
    });
  }

  stations.sort((a, b) => {
    const ta = (a.inBps ?? 0) + (a.outBps ?? 0);
    const tb = (b.inBps ?? 0) + (b.outBps ?? 0);
    if (tb !== ta) return tb - ta;
    const na = (a.hostname || a.mac || "").toLowerCase();
    const nb = (b.hostname || b.mac || "").toLowerCase();
    return na.localeCompare(nb);
  });

  return stations;
}

async function collectSpeedtest(
  siteId: string,
  start: number,
  end: number,
  step: string
): Promise<SiteNetworkSummary["speedtest"]> {
  const s = escapePromLabel(siteId);
  const empty: SiteNetworkSummary["speedtest"] = {
    available: false,
    downloadBps: null,
    uploadBps: null,
    pingMs: null,
    lastSuccessAt: null,
    downloadSeries: [],
    uploadSeries: [],
    message:
      "No speedtest data yet. Deploy the site-box speedtest service (every 15m) and Force-apply collectors."
  };
  try {
    const [downloadBps, uploadBps, pingMs, lastSuccessAt] = await Promise.all([
      parseFirstVectorValue(
        await promQuery(`last_over_time(noc_speedtest_download_bps{site="${s}"}[30m])`)
      ),
      parseFirstVectorValue(
        await promQuery(`last_over_time(noc_speedtest_upload_bps{site="${s}"}[30m])`)
      ),
      parseFirstVectorValue(
        await promQuery(`last_over_time(noc_speedtest_ping_ms{site="${s}"}[30m])`)
      ),
      parseFirstVectorValue(
        await promQuery(`last_over_time(noc_speedtest_last_success_timestamp{site="${s}"}[30m])`)
      )
    ]);

    if (downloadBps == null && uploadBps == null && pingMs == null) {
      return empty;
    }

    const [downloadSeries, uploadSeries] = await Promise.all([
      promQueryRange(`noc_speedtest_download_bps{site="${s}"}`, start, end, step)
        .then(parseSeries)
        .catch(() => [] as SiteNetworkSeriesPoint[]),
      promQueryRange(`noc_speedtest_upload_bps{site="${s}"}`, start, end, step)
        .then(parseSeries)
        .catch(() => [] as SiteNetworkSeriesPoint[])
    ]);

    return {
      available: true,
      downloadBps,
      uploadBps,
      pingMs: pingMs != null ? Math.round(pingMs * 10) / 10 : null,
      lastSuccessAt: lastSuccessAt != null ? Math.floor(lastSuccessAt) : null,
      downloadSeries,
      uploadSeries
    };
  } catch {
    return empty;
  }
}

export type WirelessClusterStation = {
  deviceId: string;
  apLabel: string;
  mac: string | null;
  hostname: string | null;
  ip: string | null;
  ssid: string | null;
  snr: number | null;
  txRate: string | null;
  inBps: number | null;
  outBps: number | null;
};

export type WirelessClusterAp = {
  deviceId: string;
  label: string;
  clients: number | null;
  radioInBps: number | null;
  radioOutBps: number | null;
  snrAvg: number | null;
  snrMin: number | null;
};

export type WirelessClusterSummary = {
  selected: number;
  reporting: number;
  clients: number | null;
  radioInBps: number | null;
  radioOutBps: number | null;
  snrAvg: number | null;
  snrMin: number | null;
  byAp: WirelessClusterAp[];
  stations: WirelessClusterStation[];
};

/** One glance for a site or a chosen set of access points. Missing APs stay out of the sums. */
export async function getWirelessClusterSummary(
  siteId: string,
  deviceIds: string[]
): Promise<WirelessClusterSummary | null> {
  const site = getSiteById(siteId);
  if (!site) return null;
  const wanted = new Set(deviceIds.map((id) => id.trim()).filter(Boolean));
  const [aps, stations] = await Promise.all([
    collectApRows(siteId, site),
    collectStations(siteId, site)
  ]);
  const selected = aps.filter((ap) => (wanted.size === 0 ? true : wanted.has(ap.deviceId)));
  let clients: number | null = null;
  let reporting = 0;
  for (const ap of selected) {
    if (ap.clients == null) continue;
    reporting += 1;
    clients = (clients ?? 0) + ap.clients;
  }
  const selectedIds = new Set(selected.map((ap) => ap.deviceId));
  const rows = stations.filter((st) => selectedIds.has(st.deviceId));
  const snrs = rows
    .map((st) => st.snr)
    .filter((n): n is number => n != null && Number.isFinite(n));
  let radioInBps: number | null = null;
  let radioOutBps: number | null = null;
  for (const st of rows) {
    if (st.inBps != null && Number.isFinite(st.inBps)) radioInBps = (radioInBps ?? 0) + st.inBps;
    if (st.outBps != null && Number.isFinite(st.outBps)) radioOutBps = (radioOutBps ?? 0) + st.outBps;
  }
  return {
    selected: selected.length,
    reporting,
    clients,
    radioInBps,
    radioOutBps,
    snrAvg: snrs.length ? Math.round((snrs.reduce((sum, n) => sum + n, 0) / snrs.length) * 10) / 10 : null,
    snrMin: snrs.length ? Math.round(Math.min(...snrs) * 10) / 10 : null,
    byAp: selected.map((ap) => {
      const apStations = rows.filter((st) => st.deviceId === ap.deviceId);
      let radioInBpsAp: number | null = null;
      let radioOutBpsAp: number | null = null;
      const apSnrs: number[] = [];
      for (const st of apStations) {
        if (st.inBps != null && Number.isFinite(st.inBps)) radioInBpsAp = (radioInBpsAp ?? 0) + st.inBps;
        if (st.outBps != null && Number.isFinite(st.outBps)) radioOutBpsAp = (radioOutBpsAp ?? 0) + st.outBps;
        if (st.snr != null && Number.isFinite(st.snr)) apSnrs.push(st.snr);
      }
      return {
        deviceId: ap.deviceId,
        label: ap.label,
        clients: ap.clients,
        radioInBps: radioInBpsAp,
        radioOutBps: radioOutBpsAp,
        snrAvg: apSnrs.length
          ? Math.round((apSnrs.reduce((sum, n) => sum + n, 0) / apSnrs.length) * 10) / 10
          : null,
        snrMin: apSnrs.length ? Math.round(Math.min(...apSnrs) * 10) / 10 : null
      };
    }),
    stations: rows.map((st) => ({
      deviceId: st.deviceId,
      apLabel: st.apLabel,
      mac: st.mac,
      hostname: st.hostname,
      ip: st.ip,
      ssid: st.ssid,
      snr: st.snr,
      txRate: st.txRate,
      inBps: st.inBps,
      outBps: st.outBps
    }))
  };
}
