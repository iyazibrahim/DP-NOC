import { getSiteById } from "../data/sites";
import type { DeviceKind } from "../data/sites";
import { promQuery, type PromQueryResult } from "./prometheus";

export type DiscoveredDevice = {
  deviceId: string;
  kind: DeviceKind;
  lastSeen: string | null;
  alreadyRegistered: boolean;
  suggestedName: string;
  suggestedType: string;
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

function suggestName(deviceId: string, kind: DeviceKind): string {
  if (kind === "server") {
    return deviceId.endsWith("-nuc") ? "NUC / Site box" : "Server";
  }
  return deviceId;
}

function suggestType(deviceId: string, kind: DeviceKind): string {
  if (kind === "server") {
    return deviceId.endsWith("-nuc") ? "nuc" : "server";
  }
  return "switch";
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

  const addFromQuery = async (query: string, kind: DeviceKind) => {
    try {
      const data = await promQuery(query);
      for (const row of parseVectorRows(data)) {
        const deviceId = row.metric?.device?.trim() ?? "";
        if (!deviceId) continue;
        const ts = row.value?.[0];
        const lastSeen = ts != null ? new Date(ts * 1000).toISOString() : null;
        const existing = byId.get(deviceId);
        if (existing && existing.lastSeen && lastSeen && existing.lastSeen >= lastSeen) continue;
        byId.set(deviceId, {
          deviceId,
          kind,
          lastSeen,
          alreadyRegistered: isRegistered(deviceId, registeredMetricIds, registeredIds),
          suggestedName: suggestName(deviceId, kind),
          suggestedType: suggestType(deviceId, kind)
        });
      }
    } catch {
      // Prometheus unavailable — return partial/empty discovery list
    }
  };

  await addFromQuery(`up{job="site_host",site="${siteId}"}`, "server");
  await addFromQuery(`snmp_up{site="${siteId}"}`, "network");

  return [...byId.values()].sort((a, b) => {
    if (a.alreadyRegistered !== b.alreadyRegistered) {
      return a.alreadyRegistered ? 1 : -1;
    }
    return a.deviceId.localeCompare(b.deviceId);
  });
}

export async function hasUnregisteredHostMetrics(siteId: string): Promise<boolean> {
  const site = getSiteById(siteId);
  if (!site || (site.devices ?? []).length > 0) return false;

  try {
    const data = await promQuery(`up{job="site_host",site="${siteId}"}`);
    return parseVectorRows(data).length > 0;
  } catch {
    return false;
  }
}
