import { getSiteById, siteList } from "../data/sites";
import { promQuery, parseFirstVectorValue, parseVectorToNumericValues } from "./prometheus";
import { getActiveAlerts, type Alert } from "./alertmanager";
import { hasUnregisteredHostMetrics } from "./deviceDiscovery";

export type DomainState = "healthy" | "warning" | "critical" | "unknown";

export type DomainStatus = {
  state: DomainState;
  notes?: string;
};

export type SiteStatus = {
  siteId: string;
  wan: DomainStatus;
  websites: DomainStatus;
  lan: DomainStatus;
  alerts: {
    firing: number;
    resolved: number;
  };
  overall: DomainState;
};

export type StatusMeta = {
  checkedAt: string;
  dashboardRefreshSec: number;
  metricFreshWindowSec: number;
  typicalDetectionSec: number;
  scrapeIntervalSec: number;
};

const METRIC_FRESH_WINDOW = "3m";
const METRIC_HISTORY_WINDOW = "30m";

export const STATUS_META: Omit<StatusMeta, "checkedAt"> = {
  dashboardRefreshSec: 10,
  metricFreshWindowSec: 180,
  typicalDetectionSec: 90,
  scrapeIntervalSec: 60
};

function booleanValueToDomain(v: number | null): DomainState {
  if (v === null) return "unknown";
  if (v === 0) return "critical";
  if (v === 1) return "healthy";
  return "warning";
}

function worst(a: DomainState, b: DomainState): DomainState {
  const score: Record<DomainState, number> = {
    critical: 4,
    warning: 3,
    healthy: 2,
    unknown: 1
  };
  return score[a] >= score[b] ? a : b;
}

function aggregateProbeStatuses(statuses: DomainStatus[]): DomainStatus {
  const states = statuses.map((s) => s.state);
  if (states.every((s) => s === "unknown")) {
    return {
      state: "unknown",
      notes: statuses.find((s) => s.notes)?.notes ?? "No probe metrics yet"
    };
  }
  if (states.some((s) => s === "critical")) {
    const notes = statuses
      .filter((s) => s.state === "critical")
      .map((s) => s.notes)
      .filter(Boolean)
      .join("; ");
    return { state: "critical", notes: notes || "One or more checks are down" };
  }
  if (states.some((s) => s === "warning")) {
    return { state: "warning", notes: "Degraded probe readings" };
  }
  if (states.some((s) => s === "unknown")) {
    return { state: "warning", notes: "Partial probe data — other checks are up" };
  }
  return { state: "healthy" };
}

function stateFromBooleanSeries(values: number[]): DomainState {
  if (values.length === 0) return "unknown";
  if (values.some((v) => v === 0)) return "critical";
  if (values.some((v) => !Number.isFinite(v))) return "warning";
  return "healthy";
}

async function queryBooleanMetricState(metricSelector: string): Promise<DomainStatus> {
  try {
    const freshQ = `last_over_time(${metricSelector}[${METRIC_FRESH_WINDOW}])`;
    const fresh = parseFirstVectorValue(await promQuery(freshQ));
    if (fresh !== null) {
      const state = booleanValueToDomain(fresh);
      return {
        state,
        notes:
          state === "critical"
            ? "Reported down by the latest metric sample"
            : undefined
      };
    }

    const histQ = `last_over_time(${metricSelector}[${METRIC_HISTORY_WINDOW}])`;
    const hist = parseFirstVectorValue(await promQuery(histQ));
    if (hist !== null) {
      return {
        state: "critical",
        notes: `No metrics in the last ${METRIC_FRESH_WINDOW} — collector or link may be down`
      };
    }

    return { state: "unknown", notes: "No metrics received yet" };
  } catch {
    return { state: "unknown", notes: "Could not query Prometheus" };
  }
}

async function queryProbeSuccessVector(siteId: string, labelKey: string, labelValue: string) {
  const selector = `probe_success{site="${siteId}",${labelKey}="${labelValue}"}`;
  const freshQ = `last_over_time(${selector}[${METRIC_FRESH_WINDOW}])`;
  const data = await promQuery(freshQ);
  const values = parseVectorToNumericValues(data);
  return { data, values };
}

export async function computeSiteStatus(
  siteId: string,
  activeAlerts?: Alert[]
): Promise<SiteStatus> {
  const site = getSiteById(siteId);
  if (!site) {
    throw new Error(`Unknown site: ${siteId}`);
  }

  const wanDns = await queryBooleanMetricState(
    `probe_success{site="${siteId}",check="wan_dns"}`
  );
  const wanVps = await queryBooleanMetricState(
    `probe_success{site="${siteId}",check="wan_vps"}`
  );
  const wan = aggregateProbeStatuses([wanDns, wanVps]);

  const websiteVector = await queryProbeSuccessVector(siteId, "check", "website");
  let websites: DomainStatus = { state: stateFromBooleanSeries(websiteVector.values) };
  if (websiteVector.values.length === 0) {
    const histQ = `last_over_time(probe_success{site="${siteId}",check="website"}[${METRIC_HISTORY_WINDOW}])`;
    const hadWebsites = parseFirstVectorValue(await promQuery(histQ));
    websites =
      hadWebsites !== null
        ? {
            state: "critical",
            notes: `Website probes silent for ${METRIC_FRESH_WINDOW}`
          }
        : { state: "unknown", notes: "No website targets configured or probed" };
  }

  let lan: DomainStatus = { state: "unknown", notes: "No devices configured" };
  const devices = site.devices ?? [];
  if (devices.length > 0) {
    const deviceStatuses: DomainStatus[] = [];
    for (const d of devices) {
      const kind = d.kind ?? "network";
      const metricId = kind === "server" ? d.hostMetricId || d.id : d.id;
      const selector =
        kind === "server"
          ? `up{job="site_host",site="${siteId}",device="${metricId}"}`
          : `snmp_up{site="${siteId}",device="${metricId}"}`;
      deviceStatuses.push(await queryBooleanMetricState(selector));
    }
    lan = aggregateProbeStatuses(deviceStatuses);
  } else if (await hasUnregisteredHostMetrics(siteId)) {
    lan = {
      state: "warning",
      notes: "NUC reporting metrics but no devices registered — register in Sites"
    };
  }

  const alerts = activeAlerts ?? (await getActiveAlerts());
  const relevant = alerts.filter((a) => (a.labels?.site ?? "") === siteId);
  const firing = relevant.filter((a) => a.status === "firing").length;
  const resolved = relevant.filter((a) => a.status === "resolved").length;

  let overall = worst(wan.state, websites.state);
  overall = worst(overall, lan.state);
  if (firing > 0) overall = "critical";

  return {
    siteId,
    wan,
    websites,
    lan,
    alerts: { firing, resolved },
    overall
  };
}

export async function computeAllSitesStatus(): Promise<{
  statuses: SiteStatus[];
  meta: StatusMeta;
}> {
  const activeAlerts = await getActiveAlerts();
  const statuses: SiteStatus[] = [];
  for (const s of siteList) {
    statuses.push(await computeSiteStatus(s.id, activeAlerts));
  }
  return {
    statuses,
    meta: {
      ...STATUS_META,
      checkedAt: new Date().toISOString()
    }
  };
}
