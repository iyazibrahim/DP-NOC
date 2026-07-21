import { getSiteById, siteList } from "../data/sites";
import { promQuery, parseFirstVectorValue, parseVectorToNumericValues } from "./prometheus";
import { getActiveAlerts, type Alert } from "./alertmanager";
import { hasUnregisteredHostMetrics, siteHasCollectorMetrics } from "./deviceDiscovery";
import { getGlobalWebsites } from "../data/globalWebsites";
import {
  dualHostMemFresh,
  dualHostUpFresh,
  METRIC_FRESH_WINDOW,
  METRIC_HISTORY_WINDOW
} from "./promLabels";

export type DomainState = "healthy" | "warning" | "critical" | "unknown";

export type DomainStatus = {
  state: DomainState;
  notes?: string;
};

export type SiteStatus = {
  siteId: string;
  /** @deprecated use uplink — kept for API compatibility */
  wan: DomainStatus;
  /** Alias of wan (Uplink / Internet) */
  uplink: DomainStatus;
  websites: DomainStatus;
  /** @deprecated use localDevices — kept for API compatibility */
  lan: DomainStatus;
  /** Alias of lan (Local devices) */
  localDevices: DomainStatus;
  /** Collector box host metrics health */
  collector: DomainStatus;
  websiteTargetCount: number;
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

export const STATUS_META: Omit<StatusMeta, "checkedAt"> = {
  dashboardRefreshSec: 10,
  metricFreshWindowSec: 90,
  typicalDetectionSec: 90,
  scrapeIntervalSec: 30
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
      notes: statuses.find((s) => s.notes)?.notes ?? "No data yet"
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
    return { state: "warning", notes: "Degraded readings" };
  }
  if (states.some((s) => s === "unknown")) {
    return { state: "warning", notes: "Partial data — other checks are up" };
  }
  return { state: "healthy" };
}

function stateFromBooleanSeries(values: number[]): DomainState {
  if (values.length === 0) return "unknown";
  if (values.some((v) => v === 0)) return "critical";
  if (values.some((v) => !Number.isFinite(v))) return "warning";
  return "healthy";
}

/**
 * Fresh sample required. Missing samples after we once had data = DOWN (silence).
 * Never seen = unknown.
 */
async function queryBooleanMetricState(
  metricSelector: string,
  opts?: { silenceMeansDown?: boolean; downNotes?: string }
): Promise<DomainStatus> {
  const silenceMeansDown = opts?.silenceMeansDown ?? true;
  const downNotes =
    opts?.downNotes ?? `No data in the last ${METRIC_FRESH_WINDOW} — treated as down`;

  try {
    const freshQ = `last_over_time(${metricSelector}[${METRIC_FRESH_WINDOW}])`;
    const fresh = parseFirstVectorValue(await promQuery(freshQ));
    if (fresh !== null) {
      const state = booleanValueToDomain(fresh);
      return {
        state,
        notes: state === "critical" ? "Reported down by the latest check" : undefined
      };
    }

    const histQ = `last_over_time(${metricSelector}[${METRIC_HISTORY_WINDOW}])`;
    const hist = parseFirstVectorValue(await promQuery(histQ));
    if (hist !== null) {
      return silenceMeansDown
        ? { state: "critical", notes: downNotes }
        : { state: "unknown", notes: downNotes };
    }

    return { state: "unknown", notes: "No data received yet" };
  } catch {
    return { state: "unknown", notes: "Could not read metrics" };
  }
}

async function queryProbeSuccessVector(siteId: string, labelKey: string, labelValue: string) {
  const selector = `probe_success{site="${siteId}",${labelKey}="${labelValue}"}`;
  const freshQ = `last_over_time(${selector}[${METRIC_FRESH_WINDOW}])`;
  const data = await promQuery(freshQ);
  const values = parseVectorToNumericValues(data);
  return { data, values };
}

async function collectorIdStatus(siteId: string, metricId: string): Promise<DomainStatus> {
  try {
    const upFresh = parseFirstVectorValue(
      await promQuery(dualHostUpFresh(siteId, metricId, METRIC_FRESH_WINDOW))
    );
    if (upFresh !== null) {
      const state = booleanValueToDomain(upFresh >= 1 ? 1 : upFresh === 0 ? 0 : upFresh);
      return {
        state,
        notes: state === "critical" ? "Collector not responding" : undefined
      };
    }

    const memFresh = parseFirstVectorValue(
      await promQuery(dualHostMemFresh(siteId, metricId, METRIC_FRESH_WINDOW))
    );
    if (memFresh !== null) {
      return { state: "healthy" };
    }

    const upHist = parseFirstVectorValue(
      await promQuery(dualHostUpFresh(siteId, metricId, METRIC_HISTORY_WINDOW))
    );
    const memHist = parseFirstVectorValue(
      await promQuery(dualHostMemFresh(siteId, metricId, METRIC_HISTORY_WINDOW))
    );
    if (upHist !== null || memHist !== null) {
      return {
        state: "critical",
        notes: `Collector silent for ${METRIC_FRESH_WINDOW} — treated as down`
      };
    }
    return { state: "unknown", notes: "Waiting for collector data" };
  } catch {
    return { state: "unknown", notes: "Could not read collector metrics" };
  }
}

async function computeCollectorStatus(siteId: string): Promise<DomainStatus> {
  const site = getSiteById(siteId);
  const servers = (site?.devices ?? []).filter((d) => (d.kind ?? "network") === "server");

  if (servers.length > 0) {
    const statuses: DomainStatus[] = [];
    for (const d of servers) {
      statuses.push(await collectorIdStatus(siteId, d.hostMetricId || d.id));
    }
    return aggregateProbeStatuses(statuses);
  }

  // No registered collector — if site once had uplink/host metrics but host is silent, still surface
  if (await siteHasCollectorMetrics(siteId)) {
    return {
      state: "warning",
      notes:
        "Collector is sending data but is not registered yet — it should appear under Devices shortly"
    };
  }
  if (await hasUnregisteredHostMetrics(siteId)) {
    return {
      state: "warning",
      notes: "Collector data found — waiting to add it automatically"
    };
  }
  return { state: "unknown", notes: "Waiting for collector data" };
}

export async function computeSiteStatus(
  siteId: string,
  activeAlerts?: Alert[]
): Promise<SiteStatus> {
  if (siteId === "global") {
    const globalTargets = getGlobalWebsites();
    const websiteVector = await queryProbeSuccessVector(siteId, "check", "website");
    let websites: DomainStatus = { state: stateFromBooleanSeries(websiteVector.values) };

    if (websiteVector.values.length === 0) {
      websites =
        globalTargets.length > 0
          ? {
              state: "unknown",
              notes: "Website checks are configured but no results yet"
            }
          : { state: "unknown", notes: "No website checks configured" };
    }

    const alerts = activeAlerts ?? (await getActiveAlerts());
    const relevant = alerts.filter((a) => (a.labels?.site ?? "") === siteId);
    const firing = relevant.filter((a) => a.status === "firing").length;
    const resolved = relevant.filter((a) => a.status === "resolved").length;

    const na = { state: "unknown" as const, notes: "Not applicable" };
    return {
      siteId,
      wan: na,
      uplink: na,
      websites,
      lan: na,
      localDevices: na,
      collector: na,
      alerts: { firing, resolved },
      websiteTargetCount: globalTargets.length,
      overall: websites.state
    };
  }

  const site = getSiteById(siteId);
  if (!site) {
    throw new Error(`Unknown site: ${siteId}`);
  }

  const wanDns = await queryBooleanMetricState(
    `probe_success{site="${siteId}",check="wan_dns"}`,
    {
      silenceMeansDown: true,
      downNotes: `Internet probe silent for ${METRIC_FRESH_WINDOW}`
    }
  );
  const wanVps = await queryBooleanMetricState(
    `probe_success{site="${siteId}",check="wan_vps"}`,
    {
      silenceMeansDown: true,
      downNotes: `Central uplink probe silent for ${METRIC_FRESH_WINDOW}`
    }
  );
  const uplink = aggregateProbeStatuses([
    {
      ...wanDns,
      notes:
        wanDns.state === "critical"
          ? wanDns.notes ?? "Cannot reach DNS (internet)"
          : wanDns.notes
    },
    {
      ...wanVps,
      notes:
        wanVps.state === "critical"
          ? wanVps.notes ?? "Cannot reach central server"
          : wanVps.notes
    }
  ]);
  if (uplink.state === "healthy") {
    uplink.notes = undefined;
  } else if (uplink.state === "critical" && !uplink.notes) {
    uplink.notes = "Internet / uplink down";
  }

  const websiteVector = await queryProbeSuccessVector(siteId, "check", "website");
  let websites: DomainStatus = { state: stateFromBooleanSeries(websiteVector.values) };
  if (websiteVector.values.length === 0) {
    const histQ = `last_over_time(probe_success{site="${siteId}",check="website"}[${METRIC_HISTORY_WINDOW}])`;
    const hadWebsites = parseFirstVectorValue(await promQuery(histQ));
    websites =
      hadWebsites !== null
        ? {
            state: "critical",
            notes: `Website checks silent for ${METRIC_FRESH_WINDOW}`
          }
        : { state: "unknown", notes: "No website checks configured" };
  }

  const collector = await computeCollectorStatus(siteId);

  let localDevices: DomainStatus = { state: "unknown", notes: "No local devices configured" };
  const devices = site.devices ?? [];
  const networkOrAll = devices.filter((d) => (d.kind ?? "network") === "network");
  if (networkOrAll.length > 0) {
    const deviceStatuses: DomainStatus[] = [];
    for (const d of networkOrAll) {
      deviceStatuses.push(
        await queryBooleanMetricState(`snmp_up{site="${siteId}",device="${d.id}"}`)
      );
    }
    localDevices = aggregateProbeStatuses(deviceStatuses);
  } else if (devices.length === 0 && (await hasUnregisteredHostMetrics(siteId))) {
    localDevices = {
      state: "warning",
      notes: "Collector is reporting — add local devices (switches, etc.) when ready"
    };
  }

  const alerts = activeAlerts ?? (await getActiveAlerts());
  const relevant = alerts.filter((a) => (a.labels?.site ?? "") === siteId);
  const firing = relevant.filter((a) => a.status === "firing").length;
  const resolved = relevant.filter((a) => a.status === "resolved").length;

  // Uplink is primary: critical uplink always forces overall DOWN.
  let overall: DomainState = uplink.state;
  if (uplink.state !== "critical") {
    overall = worst(overall, collector.state);
    overall = worst(overall, websites.state);
    overall = worst(overall, localDevices.state);
  }
  if (firing > 0) overall = "critical";

  return {
    siteId,
    wan: uplink,
    uplink,
    websites,
    lan: localDevices,
    localDevices,
    collector,
    websiteTargetCount: site.websiteTargets?.length ?? 0,
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

  const globalTargets = getGlobalWebsites();
  if (globalTargets.length > 0) {
    statuses.push(await computeSiteStatus("global", activeAlerts));
  }
  return {
    statuses,
    meta: {
      ...STATUS_META,
      checkedAt: new Date().toISOString()
    }
  };
}
