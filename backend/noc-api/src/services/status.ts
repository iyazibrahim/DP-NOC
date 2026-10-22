import { getSiteById, siteList } from "../data/sites";
import { promQuery, parseFirstVectorValue, parseVectorToNumericValues } from "./prometheus";
import { getActiveAlerts, type Alert } from "./alertmanager";
import { hasUnregisteredHostMetrics, siteHasCollectorMetrics } from "./deviceDiscovery";
import { getGlobalWebsites } from "../data/globalWebsites";
import {
  getFreshDeviceSnapshot,
  type DeviceSnapshot,
  type ProbeLevel
} from "../data/deviceSnapshots";
import { env } from "../env";
import {
  dualHostMemFresh,
  dualHostUpFresh,
  METRIC_FRESH_WINDOW,
  METRIC_HISTORY_WINDOW,
  SITE_SNMP_JOB_SELECTOR
} from "./promLabels";

export type DomainState = "healthy" | "warning" | "critical" | "unknown";

export type DomainStatus = {
  state: DomainState;
  notes?: string;
};

export type WebsiteTargetState = {
  name: string;
  url: string;
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
  /** Per-URL website check status (after Hetrix failover) */
  websiteStates: WebsiteTargetState[];
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

/** Consecutive healthy status polls before clearing a sticky critical display. */
const RECOVERY_HEALTHY_POLLS = 2;

type StickyDomain = {
  displayed: DomainState;
  consecutiveHealthy: number;
  lastNotes?: string;
};

const recoverySticky = new Map<string, StickyDomain>();

/**
 * Keep critical sticky until ≥2 consecutive healthy samples (reduces flap).
 * Transition to warning/unknown is allowed immediately (not a false recovery).
 */
function applyRecoveryHysteresis(key: string, raw: DomainStatus): DomainStatus {
  const prev = recoverySticky.get(key);

  if (raw.state === "critical") {
    recoverySticky.set(key, {
      displayed: "critical",
      consecutiveHealthy: 0,
      lastNotes: raw.notes
    });
    return raw;
  }

  if (prev?.displayed === "critical" && raw.state === "healthy") {
    const consecutiveHealthy = (prev.consecutiveHealthy ?? 0) + 1;
    if (consecutiveHealthy >= RECOVERY_HEALTHY_POLLS) {
      recoverySticky.set(key, { displayed: "healthy", consecutiveHealthy: 0 });
      return raw;
    }
    recoverySticky.set(key, {
      displayed: "critical",
      consecutiveHealthy,
      lastNotes: prev.lastNotes
    });
    return {
      state: "critical",
      notes: prev.lastNotes ?? raw.notes
    };
  }

  recoverySticky.set(key, {
    displayed: raw.state,
    consecutiveHealthy: 0,
    lastNotes: raw.notes
  });
  return raw;
}

export const STATUS_META: Omit<StatusMeta, "checkedAt"> = {
  dashboardRefreshSec: env.STATUS_DASHBOARD_REFRESH_SEC,
  metricFreshWindowSec: env.STATUS_METRIC_FRESH_SEC,
  /** Alertmanager for: 2m — typical page time for sustained outages */
  typicalDetectionSec: 120,
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

/** Collapse repeated per-device notes into one short summary line. */
function summarizeCriticalNotes(statuses: DomainStatus[]): string {
  const notes = statuses
    .filter((s) => s.state === "critical")
    .map((s) => s.notes?.trim())
    .filter((n): n is string => Boolean(n));
  if (notes.length === 0) return "One or more checks are down";

  const counts = new Map<string, number>();
  for (const n of notes) {
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([note, count]) => (count > 1 ? `${note} (${count} devices)` : note))
    .join(" ");
}

/**
 * One failed device is a warning for the location. The site is down only when
 * every local device that has reported is down.
 */
function aggregateLocalDevices(statuses: DomainStatus[]): DomainStatus {
  const states = statuses.map((s) => s.state);
  if (states.every((s) => s === "unknown")) {
    return {
      state: "unknown",
      notes: statuses.find((s) => s.notes)?.notes ?? "No data yet"
    };
  }
  const critical = statuses.filter((s) => s.state === "critical");
  const reported = states.filter((s) => s !== "unknown");
  const allReportedDown = reported.length > 0 && reported.every((s) => s === "critical");
  if (allReportedDown && critical.length === statuses.length) {
    return { state: "critical", notes: summarizeCriticalNotes(statuses) };
  }
  if (critical.length > 0) {
    return { state: "warning", notes: summarizeCriticalNotes(critical) };
  }
  if (states.some((s) => s === "warning")) {
    const note = statuses.find((s) => s.state === "warning" && s.notes)?.notes;
    return { state: "warning", notes: note ?? "Some devices need attention." };
  }
  if (states.some((s) => s === "unknown")) {
    return { state: "unknown", notes: "Some devices have not reported yet." };
  }
  return { state: "healthy" };
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
    return { state: "critical", notes: summarizeCriticalNotes(statuses) };
  }
  if (states.some((s) => s === "warning")) {
    const note = statuses.find((s) => s.state === "warning" && s.notes)?.notes;
    return { state: "warning", notes: note ?? "Some checks need attention." };
  }
  if (states.some((s) => s === "unknown")) {
    return { state: "unknown", notes: "Some devices have not reported yet." };
  }
  return { state: "healthy" };
}

/** DNS is up when either server answers. Both must fail before DNS is down. */
function aggregateDns(primary: DomainStatus, secondary: DomainStatus): DomainStatus {
  if (primary.state === "healthy" || secondary.state === "healthy") {
    if (primary.state === "critical" || secondary.state === "critical") {
      return {
        state: "healthy",
        notes: "One DNS server did not answer. The other did."
      };
    }
    return { state: "healthy" };
  }
  if (primary.state === "critical" && secondary.state === "critical") {
    return {
      state: "critical",
      notes: "Both DNS checks failed."
    };
  }
  if (primary.state === "critical" && secondary.state === "unknown") return primary;
  if (secondary.state === "critical" && primary.state === "unknown") return secondary;
  if (primary.state === "unknown" && secondary.state === "unknown") {
    return { state: "unknown", notes: primary.notes ?? secondary.notes ?? "No DNS check yet" };
  }
  return primary.state === "unknown" ? secondary : primary;
}

/** Critical only when both WAN paths fail; single-path failure = warning. */
function aggregateUplinkQuorum(wanDns: DomainStatus, wanVps: DomainStatus): DomainStatus {
  const a = wanDns.state;
  const b = wanVps.state;

  if (a === "healthy" && b === "healthy") {
    return { state: "healthy" };
  }
  if (a === "unknown" && b === "unknown") {
    return {
      state: "unknown",
      notes: wanDns.notes ?? wanVps.notes ?? "No uplink data yet"
    };
  }

  const criticalCount = [a, b].filter((s) => s === "critical").length;
  if (criticalCount >= 2) {
    return {
      state: "critical",
      notes:
        [wanDns.notes, wanVps.notes].filter(Boolean).join(" ") ||
        "Both internet checks failed. Check the uplink and the collector."
    };
  }
  if (criticalCount === 1) {
    const bad = a === "critical" ? wanDns : wanVps;
    return {
      state: "warning",
      notes: bad.notes
        ? `One internet path failed. ${bad.notes}`
        : "One internet path failed. The location is still reachable on the other path."
    };
  }
  if (a === "warning" || b === "warning" || a === "unknown" || b === "unknown") {
    return {
      state: "warning",
      notes: "The internet check is incomplete."
    };
  }
  return { state: "healthy" };
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
  const downNotes = opts?.downNotes ?? "No recent data";

  try {
    // max(): one device can have several SNMP targets (if_mib + vendor pack).
    // Taking only the first series falsely marks APs DOWN when the vendor walk times out
    // while IF-MIB (and ICMP ping) still succeed.
    const freshQ = `max(last_over_time(${metricSelector}[${METRIC_FRESH_WINDOW}]))`;
    const fresh = parseFirstVectorValue(await promQuery(freshQ));
    if (fresh !== null) {
      const state = booleanValueToDomain(fresh);
      return {
        state,
        notes: state === "critical" ? "Down" : undefined
      };
    }

    const histQ = `max(last_over_time(${metricSelector}[${METRIC_HISTORY_WINDOW}]))`;
    const hist = parseFirstVectorValue(await promQuery(histQ));
    if (hist !== null) {
      return silenceMeansDown
        ? { state: "critical", notes: downNotes }
        : { state: "unknown", notes: downNotes };
    }

    return { state: "unknown", notes: "No data yet" };
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

function escapePromLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const COLLECTOR_EXPLICIT_DOWN =
  "The collector reported itself down. Check power and the network on the collector.";

const COLLECTOR_SILENCE_NOTE = "The NOC is not receiving this collector.";

const SNMP_WARNING_NOTE = (name: string) =>
  `${name} is online, but SNMP is not answering. Check the SNMP community and that UDP port 161 is allowed, then use Force apply on the collector.`;

const BOTH_DOWN_NOTE = (name: string) =>
  `${name} is not answering ping or SNMP. Check power and the network cable.`;

type PromLevel = ProbeLevel | "stale";

async function queryPromLevel(metricSelector: string): Promise<PromLevel> {
  try {
    const freshQ = `max(last_over_time(${metricSelector}[${METRIC_FRESH_WINDOW}]))`;
    const fresh = parseFirstVectorValue(await promQuery(freshQ));
    if (fresh !== null) {
      if (fresh >= 1) return "up";
      if (fresh === 0) return "down";
    }
    const histQ = `max(last_over_time(${metricSelector}[${METRIC_HISTORY_WINDOW}]))`;
    const hist = parseFirstVectorValue(await promQuery(histQ));
    if (hist !== null) return "stale";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function preferFresh(prom: PromLevel, snap?: ProbeLevel): ProbeLevel {
  if (prom === "up" || prom === "down") return prom;
  if (snap === "up" || snap === "down") return snap;
  if (prom === "stale") return "down";
  return "unknown";
}

export function combineDeviceChecks(
  name: string,
  snmp: ProbeLevel,
  ping: ProbeLevel
): DomainStatus {
  if (snmp === "up") return { state: "healthy" };
  if (ping === "up") return { state: "warning", notes: SNMP_WARNING_NOTE(name) };
  if (ping === "down") return { state: "critical", notes: BOTH_DOWN_NOTE(name) };
  if (snmp === "down") {
    return {
      state: "warning",
      notes: `${name} is not answering SNMP. Ping has not reported yet. Check the SNMP community and that UDP port 161 is allowed, then use Force apply on the collector.`
    };
  }
  return { state: "unknown", notes: "Not checked yet." };
}

async function querySnmpLevel(siteId: string, deviceId: string, snmpIp?: string): Promise<PromLevel> {
  const id = escapePromLabel(deviceId);
  const selectors = [
    `snmp_up{site="${siteId}",device="${id}"}`,
    `up{job="site_snmp_if_mib",site="${siteId}",device="${id}"}`,
    `up{job="site_snmp_if_mib",device="${id}"}`,
    `up{job=~"integrations/snmp/.*",device="${id}"}`,
    `up{job=~"integrations/snmp/.*",site="${siteId}",device="${id}"}`
  ];
  if (snmpIp) {
    const ipRe = snmpIp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    selectors.push(`up{job=~"integrations/snmp/.*",instance=~".*${ipRe}.*"}`);
  }
  let sawStale = false;
  for (const sel of selectors) {
    const level = await queryPromLevel(sel);
    if (level === "up" || level === "down") return level;
    if (level === "stale") sawStale = true;
  }
  return sawStale ? "stale" : "unknown";
}

async function siteHasFreshSuccessfulPing(siteId: string): Promise<boolean> {
  try {
    const q = `max(last_over_time(probe_success{site="${siteId}",check="device_ping"}[${METRIC_FRESH_WINDOW}]))`;
    const v = parseFirstVectorValue(await promQuery(q));
    return v !== null && v >= 1;
  } catch {
    return false;
  }
}

function alertForcesOverallDown(alert: Alert, snapshotFresh: boolean): boolean {
  if (alert.status !== "firing" || isWebsiteAlert(alert)) return false;
  const name = String(alert.labels?.alertname ?? "");
  if (name === "SiteSnmpDegraded" || name === "SiteLocalDeviceDown") return false;
  if (snapshotFresh && name === "SiteCollectorDown") {
    return false;
  }
  const sev = String(alert.labels?.severity ?? "critical").toLowerCase();
  return sev !== "warning" && sev !== "info";
}

/**
 * Blackbox probe for one URL, with Hetrix multi-location failover:
 * critical only if Blackbox says down AND Hetrix does not say up.
 */
async function evaluateWebsiteTarget(
  siteId: string,
  target: { name: string; url: string }
): Promise<WebsiteTargetState> {
  const sel = `site="${escapePromLabel(siteId)}",check="website",instance="${escapePromLabel(target.url)}"`;
  let state: DomainState = "unknown";
  let notes: string | undefined;

  try {
    const successFresh = parseFirstVectorValue(
      await promQuery(`last_over_time(probe_success{${sel}}[${METRIC_FRESH_WINDOW}])`)
    );
    const httpStatus = parseFirstVectorValue(
      await promQuery(`last_over_time(probe_http_status_code{${sel}}[${METRIC_FRESH_WINDOW}])`)
    );

    if (successFresh === null) {
      const hist = parseFirstVectorValue(
        await promQuery(`last_over_time(probe_success{${sel}}[${METRIC_HISTORY_WINDOW}])`)
      );
      if (hist !== null) {
        state = "critical";
        notes = "This website has not answered recently. Check that the address is correct and the site is up.";
      } else {
        state = "unknown";
        notes = "No website check yet.";
      }
    } else if (successFresh >= 1) {
      state = "healthy";
    } else {
      state = "critical";
      if (httpStatus != null && Number.isFinite(httpStatus) && httpStatus > 0) {
        notes = `This website returned an error (HTTP ${Math.round(httpStatus)}). Check the site.`;
      } else {
        notes = "This website did not respond. Check that the address is correct and the site is up.";
      }
    }
  } catch {
    state = "unknown";
    notes = "The NOC could not read the latest website check.";
  }

  try {
    const { getHetrixStatusForUrl, hetrixEnabled } = await import("./hetrixtools");
    if (hetrixEnabled()) {
      const hx = await getHetrixStatusForUrl(target.url);
      if (hx) {
        if (hx.uptimeStatus === "up") {
          if (state === "critical" || state === "unknown") {
            notes = "An outside check says this website is up.";
          }
          state = "healthy";
        } else if (hx.uptimeStatus === "down") {
          state = "critical";
          notes = "An outside check says this website is down.";
        }
      }
    }
  } catch {
    /* overlay is best-effort — keep Blackbox result */
  }

  return { name: target.name, url: target.url, state, notes };
}

async function computeWebsitesDomain(
  siteId: string,
  targets: Array<{ name: string; url: string }>
): Promise<{ websites: DomainStatus; websiteStates: WebsiteTargetState[] }> {
  if (targets.length === 0) {
    return {
      websites: { state: "unknown", notes: "No website checks configured" },
      websiteStates: []
    };
  }

  const websiteStates: WebsiteTargetState[] = [];
  for (const t of targets) {
    websiteStates.push(await evaluateWebsiteTarget(siteId, t));
  }

  let websites = aggregateProbeStatuses(
    websiteStates.map((w) => ({ state: w.state, notes: w.notes }))
  );

  // If every target is still unknown, distinguish "configured but no results" vs silence.
  if (websites.state === "unknown" && websiteStates.every((w) => w.state === "unknown")) {
    const websiteVector = await queryProbeSuccessVector(siteId, "check", "website");
    if (websiteVector.values.length === 0) {
      websites = {
        state: "unknown",
        notes: "Website checks are configured but no results yet"
      };
    }
  }

  websites = applyRecoveryHysteresis(`websites:${siteId}`, websites);
  return { websites, websiteStates };
}

function isWebsiteAlert(alert: Alert): boolean {
  const name = String(alert.labels?.alertname ?? alert.labels?.alertName ?? "").toLowerCase();
  return name.includes("website") || name === "sitewebsitedown";
}

/**
 * Fresh successful SNMP for this site means Alloy is still scraping and remote_writing.
 * Used as a secondary collector liveness signal when the host heartbeat is missing.
 */
async function siteHasFreshSuccessfulSnmp(siteId: string): Promise<boolean> {
  try {
    const q = `max(
      last_over_time(snmp_up{site="${siteId}"}[${METRIC_FRESH_WINDOW}])
      or last_over_time(up{${SITE_SNMP_JOB_SELECTOR},site="${siteId}"}[${METRIC_FRESH_WINDOW}])
    )`;
    const v = parseFirstVectorValue(await promQuery(q));
    return v !== null && v >= 1;
  } catch {
    return false;
  }
}

async function collectorIdStatus(siteId: string, metricId: string): Promise<DomainStatus> {
  try {
    const upFresh = parseFirstVectorValue(
      await promQuery(dualHostUpFresh(siteId, metricId, METRIC_FRESH_WINDOW))
    );
    if (upFresh !== null && upFresh >= 1) {
      return { state: "healthy" };
    }

    const memFresh = parseFirstVectorValue(
      await promQuery(dualHostMemFresh(siteId, metricId, METRIC_FRESH_WINDOW))
    );
    if (memFresh !== null) {
      return { state: "healthy" };
    }

    // Host scrape missing or up=0 — fresh SNMP still proves the collector is alive.
    if (await siteHasFreshSuccessfulSnmp(siteId)) {
      return { state: "healthy" };
    }
    if (await siteHasFreshSuccessfulPing(siteId)) {
      return { state: "healthy" };
    }

    if (upFresh !== null && upFresh < 1) {
      return { state: "critical", notes: COLLECTOR_EXPLICIT_DOWN };
    }

    const upHist = parseFirstVectorValue(
      await promQuery(dualHostUpFresh(siteId, metricId, METRIC_HISTORY_WINDOW))
    );
    const memHist = parseFirstVectorValue(
      await promQuery(dualHostMemFresh(siteId, metricId, METRIC_HISTORY_WINDOW))
    );
    if (upHist !== null || memHist !== null) {
      return { state: "critical", notes: COLLECTOR_SILENCE_NOTE };
    }
    return { state: "unknown", notes: "Waiting for data" };
  } catch {
    return { state: "unknown", notes: "Could not read metrics" };
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
        notes: "Sending data — not registered yet"
      },
      devices: []
    };
  }
  if (await hasUnregisteredHostMetrics(siteId)) {
    return {
      aggregate: {
        state: "warning",
        notes: "Data found — waiting to register"
      },
      devices: []
    };
  }
  return {
    aggregate: { state: "unknown", notes: "Waiting for data" },
    devices: []
  };
}

/** Collector Console is posting live LAN checks, so the box is up even if host series are missing. */
function snapshotShowsLanUp(snapshot: DeviceSnapshot | null): boolean {
  if (!snapshot) return false;
  return snapshot.devices.some((d) => d.snmp === "up" || d.ping === "up");
}

/**
 * Host heartbeat can be absent while Alloy is still polling the LAN and posting results.
 * That report is enough to show the collector up, including on the Devices row.
 */
function markCollectorAliveFromProbes(
  devices: SiteStatus["collectorDeviceStates"]
): DomainStatus {
  for (const row of devices) {
    if (row.state === "unknown" || row.state === "critical") {
      row.state = "healthy";
      row.notes = undefined;
    }
  }
  if (devices.length > 0 && !devices.some((d) => d.live)) {
    const preferred =
      devices.find((x) => /-(nuc|collector)$/i.test(x.deviceId)) ?? devices[0];
    preferred.live = true;
  }
  return { state: "healthy" };
}

export async function computeSiteStatus(
  siteId: string,
  activeAlerts?: Alert[]
): Promise<SiteStatus> {
  if (siteId === "global") {
    const globalTargets = getGlobalWebsites();
    const { websites, websiteStates } = await computeWebsitesDomain(siteId, globalTargets);

    const alerts = activeAlerts ?? (await getActiveAlerts());
    const relevant = alerts.filter((a) => (a.labels?.site ?? "") === siteId);
    const firing = relevant.filter((a) => a.status === "firing").length;
    const resolved = relevant.filter((a) => a.status === "resolved").length;

    // Global is website-only — overall follows website domain (Hetrix failover applied).
    // Do not force critical from Blackbox-only SiteWebsiteDown AM alerts.
    let overall: DomainState = websites.state;
    const nonWebsiteFiring = relevant.filter((a) => alertForcesOverallDown(a, false)).length;
    if (nonWebsiteFiring > 0) overall = "critical";

    const na = { state: "unknown" as const, notes: "Not applicable" };
    return {
      siteId,
      wan: na,
      uplink: na,
      websites,
      websiteStates,
      lan: na,
      localDevices: na,
      localDeviceStates: [],
      collector: na,
      collectorDeviceStates: [],
      alerts: { firing, resolved },
      websiteTargetCount: globalTargets.length,
      overall
    };
  }

  const site = getSiteById(siteId);
  if (!site) {
    throw new Error(`Unknown site: ${siteId}`);
  }

  const wanDnsRaw = await queryBooleanMetricState(
    `probe_success{site="${siteId}",check="wan_dns"}`,
    {
      silenceMeansDown: true,
      downNotes: "No recent internet check from this location."
    }
  );
  const wanVpsRaw = await queryBooleanMetricState(
    `probe_success{site="${siteId}",check="wan_vps"}`,
    {
      silenceMeansDown: true,
      downNotes: "No recent internet check from this location."
    }
  );
  const wanDns2Raw = await queryBooleanMetricState(
    `probe_success{site="${siteId}",check="wan_dns2"}`,
    {
      silenceMeansDown: true,
      downNotes: "No recent check of the second DNS server."
    }
  );
  const wanDnsCombined = aggregateDns(wanDnsRaw, wanDns2Raw);
  const wanDns = {
    ...wanDnsCombined,
    notes:
      wanDnsCombined.state === "critical"
        ? wanDnsCombined.notes ?? "The DNS check failed."
        : wanDnsCombined.notes
  };
  const wanVps = {
    ...wanVpsRaw,
    notes:
      wanVpsRaw.state === "critical"
        ? "The path to the central server failed."
        : wanVpsRaw.notes
  };

  let uplink = aggregateUplinkQuorum(wanDns, wanVps);
  if (uplink.state === "healthy") {
    uplink.notes = undefined;
  }

  const { websites, websiteStates } = await computeWebsitesDomain(
    siteId,
    site.websiteTargets ?? []
  );

  const { aggregate: collectorRaw, devices: collectorDeviceStates } =
    await computeCollectorStatus(siteId);

  let collector = applyRecoveryHysteresis(`collector:${siteId}`, collectorRaw);
  uplink = applyRecoveryHysteresis(`uplink:${siteId}`, uplink);

  const snapshot = getFreshDeviceSnapshot(siteId);
  const snapshotByDevice = new Map((snapshot?.devices ?? []).map((d) => [d.deviceId, d]));
  // Host series can be missing ("Waiting for data") while the collector is still
  // polling SNMP and ping and posting that report. That report means the box is up.
  if (
    snapshotShowsLanUp(snapshot) &&
    collector.notes !== COLLECTOR_EXPLICIT_DOWN &&
    (collector.state === "unknown" || collector.state === "critical")
  ) {
    collector = markCollectorAliveFromProbes(collectorDeviceStates);
  } else if (collector.state === "critical" && snapshot && uplink.state !== "critical") {
    collector = {
      state: "warning",
      notes: "The metrics feed is delayed. Device checks are still arriving from the collector."
    };
  }
  let localDevices: DomainStatus = { state: "unknown", notes: "No devices configured" };
  const localDeviceStates: SiteStatus["localDeviceStates"] = [];
  const devices = site.devices ?? [];
  const networkOrAll = devices.filter((d) => (d.kind ?? "network") === "network");
  if (networkOrAll.length > 0) {
    const deviceStatuses: DomainStatus[] = [];
    let lanProvesCollector = snapshotShowsLanUp(snapshot);
    for (const d of networkOrAll) {
      if (!d.snmpIp) {
        const st: DomainStatus = {
          state: "unknown",
          notes: "Needs an SNMP address"
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
      const snmpProm = await querySnmpLevel(siteId, d.id, d.snmpIp);
      const pingProm = await queryPromLevel(
        `probe_success{site="${siteId}",device="${escapePromLabel(d.id)}",check="device_ping"}`
      );
      const snap = snapshotByDevice.get(d.id);
      const snmp = preferFresh(snmpProm, snap?.snmp);
      const ping = preferFresh(pingProm, snap?.ping);
      const st = combineDeviceChecks(d.name || d.id, snmp, ping);
      if (st.state === "healthy" || st.state === "warning") lanProvesCollector = true;
      deviceStatuses.push(st);
      localDeviceStates.push({
        deviceId: d.id,
        name: d.name,
        snmpIp: d.snmpIp,
        state: st.state,
        notes: st.notes
      });
    }
    if (
      lanProvesCollector &&
      collector.notes !== COLLECTOR_EXPLICIT_DOWN &&
      (collector.state === "unknown" || collector.state === "critical")
    ) {
      collector = markCollectorAliveFromProbes(collectorDeviceStates);
    }
    localDevices = aggregateLocalDevices(deviceStatuses);
  } else if (devices.length === 0 && (await hasUnregisteredHostMetrics(siteId))) {
    localDevices = {
      state: "warning",
      notes: "Add local devices when ready"
    };
  }

  const alerts = activeAlerts ?? (await getActiveAlerts());
  const relevant = alerts.filter((a) => (a.labels?.site ?? "") === siteId);
  const firing = relevant.filter((a) => a.status === "firing").length;
  const resolved = relevant.filter((a) => a.status === "resolved").length;

  // Uplink is the internet probes only. A live collector does not fill them in.
  // Unknown uplink stays unknown so the location is not shown healthy with no network data.
  // Critical uplink forces the location down. Healthy or warning uplink can still be
  // worsened by the collector, websites, or local devices.
  let overall: DomainState = uplink.state;
  if (uplink.state === "critical") {
    overall = "critical";
  } else if (uplink.state === "unknown") {
    if (
      collector.state === "critical" ||
      websites.state === "critical" ||
      localDevices.state === "critical"
    ) {
      overall = "critical";
    }
  } else {
    overall = worst(overall, collector.state);
    overall = worst(overall, websites.state);
    overall = worst(overall, localDevices.state);
  }
  // Website AM alerts are reflected via websites domain (Hetrix failover); do not
  // force overall critical from Blackbox-only SiteWebsiteDown pages.
  const nonWebsiteFiring = relevant.filter((a) =>
    alertForcesOverallDown(a, Boolean(snapshot))
  ).length;
  if (nonWebsiteFiring > 0) overall = "critical";

  return {
    siteId,
    wan: uplink,
    uplink,
    websites,
    websiteStates,
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
