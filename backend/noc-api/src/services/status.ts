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
  /** Per-network-device SNMP status for signal boards */
  localDeviceStates: Array<{
    deviceId: string;
    name: string;
    snmpIp?: string;
    state: DomainState;
    notes?: string;
  }>;
  /** Collector box host metrics health */
  collector: DomainStatus;
  /** Per-collector device host health (for Devices page) */
  collectorDeviceStates: Array<{
    deviceId: string;
    name: string;
    metricId: string;
    state: DomainState;
    notes?: string;
    live: boolean;
  }>;
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
  dashboardRefreshSec: 5,
  metricFreshWindowSec: 45,
  typicalDetectionSec: 45,
  scrapeIntervalSec: 15
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

async function computeCollectorStatus(siteId: string): Promise<{
  aggregate: DomainStatus;
  devices: SiteStatus["collectorDeviceStates"];
}> {
  const site = getSiteById(siteId);
  const servers = (site?.devices ?? []).filter((d) => (d.kind ?? "network") === "server");

  if (servers.length > 0) {
    const devices: SiteStatus["collectorDeviceStates"] = [];
    const statuses: DomainStatus[] = [];
    for (const d of servers) {
      const metricId = d.hostMetricId || d.id;
      const st = await collectorIdStatus(siteId, metricId);
      statuses.push(st);
      devices.push({
        deviceId: d.id,
        name: d.name,
        metricId,
        state: st.state,
        notes: st.notes,
        live: false
      });
    }
    // Prefer the healthy device whose id matches preferred HOST_DEVICE_ID pattern (site-*-nuc)
    // or any healthy one; mark exactly one Live when possible.
    const preferred =
      devices.find((x) => x.state === "healthy" && /-(nuc|collector)$/i.test(x.deviceId)) ??
      devices.find((x) => x.state === "healthy") ??
      devices.find((x) => x.state === "warning") ??
      null;
    if (preferred) preferred.live = true;
    else if (devices.length === 1) devices[0].live = devices[0].state !== "unknown";

    return { aggregate: aggregateProbeStatuses(statuses), devices };
  }

  // No registered collector — if site once had uplink/host metrics but host is silent, still surface
  if (await siteHasCollectorMetrics(siteId)) {
    return {
      aggregate: {
        state: "warning",
        notes:
          "Collector is sending data but is not registered yet — it should appear under Devices shortly"
      },
      devices: []
    };
  }
  if (await hasUnregisteredHostMetrics(siteId)) {
    return {
      aggregate: {
        state: "warning",
        notes: "Collector data found — waiting to add it automatically"
      },
      devices: []
    };
  }
  return {
    aggregate: { state: "unknown", notes: "Waiting for collector data" },
    devices: []
  };
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
      localDeviceStates: [],
      collector: na,
      collectorDeviceStates: [],
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

  const { aggregate: collector, devices: collectorDeviceStates } =
    await computeCollectorStatus(siteId);

  let localDevices: DomainStatus = { state: "unknown", notes: "No local devices configured" };
  const localDeviceStates: SiteStatus["localDeviceStates"] = [];
  const devices = site.devices ?? [];
  const networkOrAll = devices.filter((d) => (d.kind ?? "network") === "network");
  if (networkOrAll.length > 0) {
    const deviceStatuses: DomainStatus[] = [];
    for (const d of networkOrAll) {
      if (!d.snmpIp) {
        const st: DomainStatus = {
          state: "unknown",
          notes: "Needs SNMP IP — collector cannot poll yet"
        };
        deviceStatuses.push(st);
        localDeviceStates.push({
          deviceId: d.id,
          name: d.name,
          snmpIp: d.snmpIp,
          state: st.state,
          notes: st.notes
        });
        continue;
      }
      // Prefer snmp_up; then site_snmp_if_mib scrape up (Alloy may omit snmp_up); then legacy job name.
      let st = await queryBooleanMetricState(`snmp_up{site="${siteId}",device="${d.id}"}`);
      if (st.state === "unknown") {
        const fallbackSelectors = [
          `up{job="site_snmp_if_mib",site="${siteId}",device="${d.id}"}`,
          `up{job="site_snmp_if_mib",device="${d.id}"}`,
          `up{job=~"integrations/snmp/.*",device="${d.id}"}`,
          `up{job=~"integrations/snmp/.*",site="${siteId}",device="${d.id}"}`
        ];
        if (d.snmpIp) {
          const ipRe = d.snmpIp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          fallbackSelectors.push(`up{job=~"integrations/snmp/.*",instance=~".*${ipRe}.*"}`);
        }
        for (const sel of fallbackSelectors) {
          const fb = await queryBooleanMetricState(sel);
          if (fb.state === "unknown") continue;
          const viaSiteJob = sel.includes('job="site_snmp_if_mib"');
          st = {
            ...fb,
            notes:
              fb.state === "healthy"
                ? viaSiteJob
                  ? "OK via site_snmp_if_mib scrape up (snmp_up metric not present)"
                  : "OK via legacy integrations/snmp up (site-box snmp_up not publishing yet)"
                : fb.notes ?? "SNMP scrape reports down"
          };
          break;
        }
        if (st.state === "unknown" && !st.notes) {
          st.notes = "Not polled yet — waiting for collector SNMP scrape";
        }
      }
      deviceStatuses.push(st);
      localDeviceStates.push({
        deviceId: d.id,
        name: d.name,
        snmpIp: d.snmpIp,
        state: st.state,
        notes: st.notes
      });
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
    localDeviceStates,
    collector,
    collectorDeviceStates,
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

  // Keep acknowledgeable incidents in sync with live status.
  try {
    // Lazy require avoids circular import with incidents → status types
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { syncIncidentsFromStatuses } = require("./incidents") as typeof import("./incidents");
    syncIncidentsFromStatuses(statuses);
  } catch {
    /* ignore sync errors */
  }

  return {
    statuses,
    meta: {
      ...STATUS_META,
      checkedAt: new Date().toISOString()
    }
  };
}
