import { siteList } from "../data/sites";
import { promQuery, parseFirstVectorValue } from "./prometheus";
import { getActiveAlerts, type Alert } from "./alertmanager";

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

function stateFromBooleanSeries(values: number[]): DomainState {
  if (values.length === 0) return "unknown";
  const anyFalse = values.some((v) => v === 0);
  const anyNaN = values.some((v) => !Number.isFinite(v));
  if (anyNaN) return "warning";
  if (anyFalse) return "critical";
  return "healthy";
}

function booleanValueToDomain(v: number | null): DomainState {
  if (v === null) return "unknown";
  if (v === 0) return "critical";
  if (v === 1) return "healthy";
  return "warning";
}

function worst(a: DomainState, b: DomainState): DomainState {
  const score: Record<DomainState, number> = {
    critical: 3,
    warning: 2,
    healthy: 1,
    unknown: 0
  };
  return score[a] >= score[b] ? a : b;
}

function domainFromProbeVector(vectorValues: number[]): DomainStatus {
  const state = stateFromBooleanSeries(vectorValues);
  return { state };
}

function parseVectorToNumericValues(data: any): number[] {
  if (!data || data.resultType !== "vector") return [];
  if (!Array.isArray(data.result)) return [];
  return data.result
    .map((r: any) => r?.value?.[1])
    .map((v: any) => (typeof v === "string" ? Number(v) : Number(v)))
    .filter((x: number) => Number.isFinite(x) || x === 0);
}

async function queryProbeSuccessVector(
  siteId: string,
  labelKey: string,
  labelValue: string
) {
  const query = `probe_success{site="${siteId}",${labelKey}="${labelValue}"}`;
  const data = await promQuery(query);
  const values = parseVectorToNumericValues(data);
  return { data, values };
}

async function querySnmpUpVector(siteId: string) {
  const query = `snmp_up{site="${siteId}"}`;
  const data = await promQuery(query);
  const values = parseVectorToNumericValues(data);
  return { data, values };
}

export async function computeSiteStatus(
  siteId: string,
  activeAlerts?: Alert[]
): Promise<SiteStatus> {
  const site = siteList.find((s) => s.id === siteId);
  if (!site) {
    throw new Error(`Unknown site: ${siteId}`);
  }

  // WAN: require both probes (dns + vps) to be successful.
  const wanDnsData = await promQuery(
    `probe_success{site="${siteId}",check="wan_dns"}`
  );
  const wanVpsData = await promQuery(
    `probe_success{site="${siteId}",check="wan_vps"}`
  );
  const wanDns = parseFirstVectorValue(wanDnsData as any);
  const wanVps = parseFirstVectorValue(wanVpsData as any);

  const wanStates = [booleanValueToDomain(wanDns), booleanValueToDomain(wanVps)];
  let wan: DomainStatus = { state: "unknown" };
  const wanWorst = wanStates.reduce((acc, cur) => worst(acc, cur), "unknown");
  if (wanWorst === "unknown") {
    wan = { state: "unknown", notes: "WAN probes missing from Prometheus" };
  } else {
    wan = { state: wanWorst };
  }

  // Websites: worst of all website probes.
  const websiteVector = await queryProbeSuccessVector(siteId, "check", "website");
  const websites = domainFromProbeVector(websiteVector.values);
  if (websites.state !== "unknown" && websiteVector.values.length === 0) {
    websites.notes = "No website probe series found";
  }

  // LAN/SNMP: optional. If no snmp_up metrics exist yet, we treat as unknown.
  let lan: DomainStatus = { state: "unknown", notes: "SNMP not configured yet" };
  try {
    const snmp = await querySnmpUpVector(siteId);
    lan = domainFromProbeVector(snmp.values);
    if (lan.state === "unknown") {
      lan = { state: "unknown", notes: "No SNMP metrics found" };
    }
  } catch {
    // Prometheus may not have the metric yet.
  }

  // Alerts: if any firing alert for the site, overall becomes critical.
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

export async function computeAllSitesStatus(): Promise<SiteStatus[]> {
  const activeAlerts = await getActiveAlerts();
  const results: SiteStatus[] = [];
  for (const s of siteList) {
    results.push(await computeSiteStatus(s.id, activeAlerts));
  }
  return results;
}

