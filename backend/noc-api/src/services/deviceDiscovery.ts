import { getSiteById } from "../data/sites";
import type { DeviceKind } from "../data/sites";
import { promQuery, type PromQueryResult } from "./prometheus";
import { siteList } from "../data/sites";
import { HOST_UP_JOB_SELECTOR, resolveCollectorId } from "./promLabels";

export type DiscoveredDevice = {
  deviceId: string;
  kind: DeviceKind;
  lastSeen: string | null;
  alreadyRegistered: boolean;
  suggestedName: string;
  suggestedType: string;
};

export type DiscoveryDiagnostics = {
  prometheusReachable: boolean;
  rawUpLabels: Array<{ site: string; device: string }>;
  rawSnmpLabels: Array<{ site: string; device: string }>;
  labelMismatchHints: string[];
  plainSummary: string;
};

type VectorRow = {
  metric: Record<string, string>;
  value?: [number, string];
};

function parseVectorRows(data: PromQueryResult): VectorRow[] {
  if (data.resultType !== "vector" || !Array.isArray(data.result)) return [];
  return data.result as VectorRow[];
}

function isRegistered(
  deviceId: string,
  registeredMetricIds: Set<string>,
  registeredIds: Set<string>
): boolean {
  return registeredMetricIds.has(deviceId) || registeredIds.has(deviceId);
}

function suggestName(deviceId: string, kind: DeviceKind, role?: string): string {
  if (kind === "server") {
    if (role === "site-box" || deviceId.endsWith("-nuc") || deviceId.toLowerCase().includes("nuc")) {
      return "Collector";
    }
    return "Server";
  }
  return deviceId;
}

function suggestType(deviceId: string, kind: DeviceKind, role?: string): string {
  if (kind === "server") {
    if (role === "site-box" || deviceId.endsWith("-nuc") || deviceId.toLowerCase().includes("nuc")) {
      return "nuc";
    }
    return "server";
  }
  return "switch";
}

function upsertDiscovered(
  byId: Map<string, DiscoveredDevice>,
  row: VectorRow,
  kind: DeviceKind,
  registeredMetricIds: Set<string>,
  registeredIds: Set<string>
) {
  const deviceId = resolveCollectorId(row.metric ?? {});
  if (!deviceId) return;
  const ts = row.value?.[0];
  const lastSeen = ts != null ? new Date(ts * 1000).toISOString() : null;
  const existing = byId.get(deviceId);
  if (existing && existing.lastSeen && lastSeen && existing.lastSeen >= lastSeen) return;
  const role = (row.metric?.role ?? "").trim();
  byId.set(deviceId, {
    deviceId,
    kind,
    lastSeen,
    alreadyRegistered: isRegistered(deviceId, registeredMetricIds, registeredIds),
    suggestedName: suggestName(deviceId, kind, role),
    suggestedType: suggestType(deviceId, kind, role)
  });
}

export async function discoverDevicesForSite(siteId: string): Promise<DiscoveredDevice[]> {
  const site = getSiteById(siteId);
  if (!site) {
    throw new Error(`Unknown site: ${siteId}`);
  }

  const devices = site.devices ?? [];
  const registeredIds = new Set(devices.map((d) => d.id));
  const registeredMetricIds = new Set(
    devices.map((d) => (d.kind === "server" ? d.hostMetricId || d.id : d.id))
  );

  const byId = new Map<string, DiscoveredDevice>();

  const runHostQueries = async (queries: string[]) => {
    for (const query of queries) {
      try {
        const data = await promQuery(query);
        for (const row of parseVectorRows(data)) {
          upsertDiscovered(byId, row, "server", registeredMetricIds, registeredIds);
        }
      } catch {
        // Prometheus unavailable — continue with other queries
      }
    }
  };

  // Template job + legacy integrations/unix; also node_* when up is missing but host metrics exist.
  await runHostQueries([
    `up{${HOST_UP_JOB_SELECTOR},site="${siteId}"}`,
    `node_memory_MemAvailable_bytes{site="${siteId}"}`,
    `node_memory_MemAvailable_bytes{site="${siteId}",role="site-box"}`
  ]);

  try {
    const snmpData = await promQuery(`snmp_up{site="${siteId}"}`);
    for (const row of parseVectorRows(snmpData)) {
      const deviceId = (row.metric?.device ?? "").trim();
      if (!deviceId) continue;
      const ts = row.value?.[0];
      const lastSeen = ts != null ? new Date(ts * 1000).toISOString() : null;
      const existing = byId.get(deviceId);
      if (existing && existing.lastSeen && lastSeen && existing.lastSeen >= lastSeen) continue;
      byId.set(deviceId, {
        deviceId,
        kind: "network",
        lastSeen,
        alreadyRegistered: isRegistered(deviceId, registeredMetricIds, registeredIds),
        suggestedName: suggestName(deviceId, "network"),
        suggestedType: suggestType(deviceId, "network")
      });
    }
  } catch {
    // ignore
  }

  return [...byId.values()].sort((a, b) => {
    if (a.alreadyRegistered !== b.alreadyRegistered) {
      return a.alreadyRegistered ? 1 : -1;
    }
    return a.deviceId.localeCompare(b.deviceId);
  });
}

function dedupePairs(pairs: Array<{ site: string; device: string }>) {
  const seen = new Set<string>();
  const out: Array<{ site: string; device: string }> = [];
  for (const p of pairs) {
    const key = `${p.site}::${p.device}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function extractSiteDevicePairs(data: PromQueryResult): Array<{ site: string; device: string }> {
  if (data.resultType !== "vector" || !Array.isArray(data.result)) return [];
  const rows = data.result as Array<{ metric: Record<string, string>; value?: [number, string] }>;
  return rows
    .map((r) => ({
      site: (r.metric?.site ?? "").trim(),
      device: resolveCollectorId(r.metric ?? {})
    }))
    .filter((r) => r.site && r.device);
}

function buildLabelMismatchHints(rawUp: Array<{ site: string; device: string }>): string[] {
  const hints: string[] = [];
  const rawSiteLabels = [...new Set(rawUp.map((r) => r.site))];

  const ids = new Set(siteList.map((s) => s.id));
  const names = siteList.map((s) => ({ id: s.id, name: s.name }));

  for (const rawSite of rawSiteLabels) {
    if (ids.has(rawSite)) continue;
    const hit = names.find((n) => n.name === rawSite);
    if (hit) {
      hints.push(
        `Collector data is labeled site="${rawSite}", but this app expects the site id "${hit.id}". ` +
          `On the collector, set SITE_NAME=${hit.id} (not the display name).`
      );
    }
  }

  return hints;
}

function buildPlainSummary(diag: {
  prometheusReachable: boolean;
  rawUpLabels: Array<{ site: string; device: string }>;
  labelMismatchHints: string[];
}): string {
  if (!diag.prometheusReachable) {
    return "Cannot reach metrics storage. Check that the central app can talk to Prometheus.";
  }
  if (diag.labelMismatchHints.length > 0) {
    return diag.labelMismatchHints[0];
  }
  if (diag.rawUpLabels.length === 0) {
    return "No collector host data found yet. Wait a minute after starting Alloy, or confirm the collector is pushing metrics.";
  }
  const bySite = diag.rawUpLabels
    .map((r) => `${r.site} → ${r.device}`)
    .slice(0, 5)
    .join("; ");
  return `Collector data found: ${bySite}${diag.rawUpLabels.length > 5 ? "…" : ""}`;
}

export async function getDiscoveryDiagnostics(): Promise<DiscoveryDiagnostics> {
  try {
    const [upData, memData, snmpData] = await Promise.all([
      promQuery(`up{${HOST_UP_JOB_SELECTOR}}`),
      promQuery(`node_memory_MemAvailable_bytes`),
      promQuery(`snmp_up`)
    ]);

    const rawUpLabels = dedupePairs([
      ...extractSiteDevicePairs(upData),
      ...extractSiteDevicePairs(memData)
    ]);
    const rawSnmpLabels = dedupePairs(extractSiteDevicePairs(snmpData));
    const labelMismatchHints = buildLabelMismatchHints(rawUpLabels);
    const base = {
      prometheusReachable: true,
      rawUpLabels,
      rawSnmpLabels,
      labelMismatchHints
    };

    return {
      ...base,
      plainSummary: buildPlainSummary(base)
    };
  } catch (e) {
    const labelMismatchHints = e instanceof Error ? [e.message] : ["Prometheus unreachable"];
    return {
      prometheusReachable: false,
      rawUpLabels: [],
      rawSnmpLabels: [],
      labelMismatchHints,
      plainSummary: "Cannot reach metrics storage. Check that the central app can talk to Prometheus."
    };
  }
}

export async function hasUnregisteredHostMetrics(siteId: string): Promise<boolean> {
  const site = getSiteById(siteId);
  if (!site || (site.devices ?? []).length > 0) return false;

  try {
    const discovered = await discoverDevicesForSite(siteId);
    return discovered.some((d) => d.kind === "server" && !d.alreadyRegistered);
  } catch {
    return false;
  }
}

/** True when any host metrics exist for the site (registered or not). */
export async function siteHasCollectorMetrics(siteId: string): Promise<boolean> {
  try {
    const data = await promQuery(
      `node_memory_MemAvailable_bytes{site="${siteId}"} or up{${HOST_UP_JOB_SELECTOR},site="${siteId}"}`
    );
    return parseVectorRows(data).length > 0;
  } catch {
    return false;
  }
}
