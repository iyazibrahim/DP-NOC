import {
  promQuery,
  promQueryRange,
  parseFirstVectorValue,
  type PromQueryResult
} from "./prometheus";
import { METRIC_FRESH_WINDOW } from "./promLabels";

export type WebsiteProbeMetrics = {
  latencyMs: number | null;
  uptime24h: number | null;
  sparkline: number[];
  state: "healthy" | "warning" | "critical" | "unknown";
  notes?: string;
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
      notes = "Website probe failed";
    }

    return {
      latencyMs:
        durationSec != null && Number.isFinite(durationSec)
          ? Math.round(durationSec * 1000)
          : null,
      uptime24h:
        uptime != null && Number.isFinite(uptime) ? Math.round(uptime * 1000) / 10 : null,
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
