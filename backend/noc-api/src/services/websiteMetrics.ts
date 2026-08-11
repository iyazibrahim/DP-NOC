import {
  promQuery,
  promQueryRange,
  parseFirstVectorValue,
  type PromQueryResult
} from "./prometheus";
import { METRIC_FRESH_WINDOW } from "./promLabels";

export type WebsiteRange = "24h" | "7d" | "30d";

export type WebsiteProbeMetrics = {
  latencyMs: number | null;
  uptime24h: number | null;
  sparkline: number[];
  state: "healthy" | "warning" | "critical" | "unknown";
  notes?: string;
};

export type WebsiteSeriesPoint = {
  ts: number;
  value: number;
};

export type WebsiteOutageInterval = {
  start: number;
  end: number;
  durationSec: number;
  ongoing: boolean;
};

export type WebsiteTrendBar = {
  label: string;
  start: number;
  end: number;
  uptimePct: number | null;
};

export type WebsiteDetailMetrics = WebsiteProbeMetrics & {
  name: string;
  url: string;
  siteId: string;
  siteName: string;
  range: WebsiteRange;
  uptime7d: number | null;
  uptime30d: number | null;
  uptimeRangePct: number | null;
  latencyAvgMs: number | null;
  latencyMaxMs: number | null;
  latencySeries: WebsiteSeriesPoint[];
  availabilitySeries: WebsiteSeriesPoint[];
  outages: WebsiteOutageInterval[];
  weeklyTrend: WebsiteTrendBar[];
  monthlyTrend: WebsiteTrendBar[];
  lastCheckAt: number | null;
};

function escapePromLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function selectorForUrl(siteId: string, url: string): string {
  const instance = escapePromLabel(url);
  return `site="${escapePromLabel(siteId)}",check="website",instance="${instance}"`;
}

function parseSparkline(data: PromQueryResult): number[] {
  if (data.resultType !== "matrix" || !Array.isArray(data.result) || data.result.length === 0) {
    return [];
  }
  const row = data.result[0] as { values?: [number, string][] };
  if (!row.values?.length) return [];
  return row.values.map(([, v]) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
}

function parseSeries(data: PromQueryResult): WebsiteSeriesPoint[] {
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

function pctFromRatio(uptime: number | null): number | null {
  if (uptime == null || !Number.isFinite(uptime)) return null;
  return Math.round(uptime * 1000) / 10;
}

function rangeConfig(range: WebsiteRange): {
  rangeSec: number;
  step: string;
  avgWindow: string;
} {
  if (range === "30d") {
    return { rangeSec: 30 * 24 * 3600, step: "6h", avgWindow: "6h" };
  }
  if (range === "7d") {
    return { rangeSec: 7 * 24 * 3600, step: "1h", avgWindow: "1h" };
  }
  return { rangeSec: 24 * 3600, step: "5m", avgWindow: "5m" };
}

/** Fine-grained probe series for event-level outage detection (separate from chart smoothing). */
function outageSeriesConfig(range: WebsiteRange): {
  query: (sel: string) => string;
  step: string;
} {
  if (range === "30d") {
    return {
      query: (sel) => `min_over_time(probe_success{${sel}}[5m])`,
      step: "5m"
    };
  }
  if (range === "7d") {
    return {
      query: (sel) => `min_over_time(probe_success{${sel}}[1m])`,
      step: "1m"
    };
  }
  return {
    query: (sel) => `probe_success{${sel}}`,
    step: "15s"
  };
}

/**
 * Derive contiguous down intervals from probe samples.
 * Event-level: any sample with value &lt; 1 counts as down (not majority avg &lt; 0.5).
 */
export function outagesFromAvailability(
  series: WebsiteSeriesPoint[],
  rangeEndSec: number
): WebsiteOutageInterval[] {
  const outages: WebsiteOutageInterval[] = [];
  let downStart: number | null = null;

  for (const p of series) {
    const down = p.value < 1;
    if (down && downStart == null) {
      downStart = p.ts;
    } else if (!down && downStart != null) {
      outages.push({
        start: downStart,
        end: p.ts,
        durationSec: Math.max(0, p.ts - downStart),
        ongoing: false
      });
      downStart = null;
    }
  }
  if (downStart != null) {
    outages.push({
      start: downStart,
      end: rangeEndSec,
      durationSec: Math.max(0, rangeEndSec - downStart),
      ongoing: true
    });
  }
  return outages.reverse();
}

async function uptimeWindow(sel: string, window: string): Promise<number | null> {
  return pctFromRatio(
    parseFirstVectorValue(await promQuery(`avg_over_time(probe_success{${sel}}[${window}])`))
  );
}

/** Build daily uptime bars for the last `days` calendar days (UTC day buckets). */
async function dailyTrendBars(sel: string, days: number, endSec: number): Promise<WebsiteTrendBar[]> {
  const bars: WebsiteTrendBar[] = [];
  const daySec = 24 * 3600;
  // Align to start of current UTC day, then go back
  const endDay = Math.floor(endSec / daySec) * daySec + daySec;
  for (let i = days - 1; i >= 0; i--) {
    const start = endDay - (i + 1) * daySec;
    const end = endDay - i * daySec;
    const label = new Date(start * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });
    let uptimePct: number | null = null;
    try {
      const range = await promQueryRange(
        `avg_over_time(probe_success{${sel}}[1h])`,
        start,
        Math.min(end, endSec),
        "1h"
      );
      const series = parseSeries(range);
      if (series.length > 0) {
        const avg = series.reduce((s, p) => s + p.value, 0) / series.length;
        uptimePct = pctFromRatio(avg);
      }
    } catch {
      uptimePct = null;
    }
    bars.push({ label, start, end: Math.min(end, endSec), uptimePct });
  }
  return bars;
}

export async function getWebsiteProbeMetrics(
  siteId: string,
  url: string
): Promise<WebsiteProbeMetrics> {
  const sel = selectorForUrl(siteId, url);
  try {
    const successFresh = parseFirstVectorValue(
      await promQuery(`last_over_time(probe_success{${sel}}[${METRIC_FRESH_WINDOW}])`)
    );
    const durationSec = parseFirstVectorValue(
      await promQuery(`last_over_time(probe_duration_seconds{${sel}}[${METRIC_FRESH_WINDOW}])`)
    );
    const httpStatus = parseFirstVectorValue(
      await promQuery(`last_over_time(probe_http_status_code{${sel}}[${METRIC_FRESH_WINDOW}])`)
    );
    const uptime = parseFirstVectorValue(
      await promQuery(`avg_over_time(probe_success{${sel}}[24h])`)
    );

    const end = Math.floor(Date.now() / 1000);
    const start = end - 24 * 3600;
    const range = await promQueryRange(
      `avg_over_time(probe_success{${sel}}[15m])`,
      start,
      end,
      "15m"
    );
    const sparkline = parseSparkline(range);

    let state: WebsiteProbeMetrics["state"] = "unknown";
    let notes: string | undefined;
    if (successFresh === null) {
      const hist = parseFirstVectorValue(
        await promQuery(`last_over_time(probe_success{${sel}}[30m])`)
      );
      if (hist !== null) {
        state = "critical";
        notes = `Probe silent for ${METRIC_FRESH_WINDOW}`;
      } else {
        state = "unknown";
        notes = "No probe data yet";
      }
    } else if (successFresh >= 1) {
      state = "healthy";
    } else {
      state = "critical";
      if (httpStatus != null && Number.isFinite(httpStatus) && httpStatus > 0) {
        notes = `Blackbox probe failed (HTTP ${Math.round(httpStatus)}) — site may block datacenter IPs or return a non-success status to the probe`;
      } else {
        notes =
          "Blackbox probe failed (no HTTP status — TLS/DNS/connect error, often broken IPv6). Check VPS: curl -4 -I <url>";
      }
    }

    let latencyMs =
      durationSec != null && Number.isFinite(durationSec)
        ? Math.round(durationSec * 1000)
        : null;
    let uptime24h =
      uptime != null && Number.isFinite(uptime) ? Math.round(uptime * 1000) / 10 : null;

    // HetrixTools overlay — prefer multi-location status when a monitor matches this URL
    try {
      const { getHetrixStatusForUrl, hetrixEnabled } = await import("./hetrixtools");
      if (hetrixEnabled()) {
        const hx = await getHetrixStatusForUrl(url);
        if (hx) {
          void persistHetrixId(siteId, url, hx.id);
          if (hx.uptimePct != null) uptime24h = hx.uptimePct;
          if (hx.latencyMs != null) latencyMs = hx.latencyMs;
          if (hx.uptimeStatus === "up") {
            if (state === "critical" || state === "unknown") {
              notes = `HetrixTools: up${notes ? ` (${notes})` : " (local probe disagreed)"}`;
            } else {
              notes = notes || "HetrixTools: up";
            }
            state = "healthy";
          } else if (hx.uptimeStatus === "down") {
            state = "critical";
            notes = "HetrixTools: down";
          }
        }
      }
    } catch {
      /* overlay is best-effort */
    }

    return {
      latencyMs,
      uptime24h,
      sparkline,
      state,
      notes
    };
  } catch {
    return {
      latencyMs: null,
      uptime24h: null,
      sparkline: [],
      state: "unknown",
      notes: "Could not read probe metrics"
    };
  }
}

async function persistHetrixId(siteId: string, url: string, monitorId: string): Promise<void> {
  try {
    if (siteId === "global") {
      const { findGlobalWebsite, setGlobalWebsiteHetrixId } = await import("../data/globalWebsites");
      const cur = findGlobalWebsite(url);
      if (cur && cur.hetrixMonitorId !== monitorId) {
        setGlobalWebsiteHetrixId(url, monitorId);
      }
      return;
    }
    const { findWebsite, setWebsiteHetrixId } = await import("../data/sites");
    const cur = findWebsite(siteId, url);
    if (cur && cur.hetrixMonitorId !== monitorId) {
      setWebsiteHetrixId(siteId, url, monitorId);
    }
  } catch {
    /* ignore */
  }
}

export async function getWebsiteDetailMetrics(
  siteId: string,
  url: string,
  range: WebsiteRange,
  meta: { name: string; siteName: string }
): Promise<WebsiteDetailMetrics> {
  const base = await getWebsiteProbeMetrics(siteId, url);
  const sel = selectorForUrl(siteId, url);
  const end = Math.floor(Date.now() / 1000);
  const { rangeSec, step, avgWindow } = rangeConfig(range);
  const start = end - rangeSec;

  let availabilitySeries: WebsiteSeriesPoint[] = [];
  let latencySeries: WebsiteSeriesPoint[] = [];
  let uptimeRangePct: number | null = null;
  let uptime7d: number | null = null;
  let uptime30d: number | null = null;
  let latencyAvgMs: number | null = null;
  let latencyMaxMs: number | null = null;
  let lastCheckAt: number | null = null;
  let weeklyTrend: WebsiteTrendBar[] = [];
  let monthlyTrend: WebsiteTrendBar[] = [];

  try {
    const [uRange, u7, u30] = await Promise.all([
      uptimeWindow(sel, range),
      uptimeWindow(sel, "7d"),
      uptimeWindow(sel, "30d")
    ]);
    uptimeRangePct = uRange;
    uptime7d = u7;
    uptime30d = u30;

    const availRange = await promQueryRange(
      `avg_over_time(probe_success{${sel}}[${avgWindow}])`,
      start,
      end,
      step
    );
    availabilitySeries = parseSeries(availRange);

    const latRange = await promQueryRange(
      `avg_over_time(probe_duration_seconds{${sel}}[${avgWindow}])`,
      start,
      end,
      step
    );
    latencySeries = parseSeries(latRange).map((p) => ({
      ts: p.ts,
      value: Math.round(p.value * 1000)
    }));

    if (latencySeries.length > 0) {
      const sum = latencySeries.reduce((s, p) => s + p.value, 0);
      latencyAvgMs = Math.round(sum / latencySeries.length);
      latencyMaxMs = Math.max(...latencySeries.map((p) => p.value));
    }

    const lastTs = parseFirstVectorValue(
      await promQuery(`timestamp(last_over_time(probe_success{${sel}}[${METRIC_FRESH_WINDOW}]))`)
    );
    if (lastTs != null && Number.isFinite(lastTs)) {
      lastCheckAt = Math.floor(lastTs);
    } else if (availabilitySeries.length > 0) {
      lastCheckAt = availabilitySeries[availabilitySeries.length - 1]?.ts ?? null;
    }

    weeklyTrend = await dailyTrendBars(sel, 7, end);
    monthlyTrend = await dailyTrendBars(sel, 30, end);
  } catch {
    /* keep base + empty series */
  }

  let outages: WebsiteOutageInterval[] = [];
  try {
    const outageCfg = outageSeriesConfig(range);
    const outageRange = await promQueryRange(outageCfg.query(sel), start, end, outageCfg.step);
    outages = outagesFromAvailability(parseSeries(outageRange), end);
  } catch {
    /* leave empty */
  }

  return {
    ...base,
    name: meta.name,
    url,
    siteId,
    siteName: meta.siteName,
    range,
    uptime7d,
    uptime30d,
    uptimeRangePct: uptimeRangePct ?? (range === "24h" ? base.uptime24h : null),
    latencyAvgMs,
    latencyMaxMs,
    latencySeries,
    availabilitySeries,
    outages,
    weeklyTrend,
    monthlyTrend,
    lastCheckAt
  };
}
