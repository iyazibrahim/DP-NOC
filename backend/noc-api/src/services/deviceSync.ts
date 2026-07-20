import { env } from "../env";
import { siteList, addDevice } from "../data/sites";
import type { DeviceKind, SiteDevice } from "../data/sites";
import { discoverDevicesForSite } from "./deviceDiscovery";

export type AutoSyncDetail = {
  siteId: string;
  deviceId: string;
  kind: DeviceKind;
  action: "registered" | "skipped" | "error";
  reason?: string;
};

export type AutoSyncResult = {
  enabled: boolean;
  startedAt: string;
  finishedAt: string;
  details: AutoSyncDetail[];
};

function normalizeSuggestedDevice(
  siteId: string,
  deviceId: string,
  kind: DeviceKind,
  suggestedName: string,
  suggestedType: string
): SiteDevice {
  // Server devices are keyed by the host's `device` label.
  if (kind === "server") {
    return {
      id: deviceId,
      name: suggestedName,
      type: suggestedType,
      kind,
      hostMetricId: deviceId,
      vendor: "generic"
    };
  }

  // Network devices are keyed by SNMP `device` labels.
  // We may not know `snmpIp` automatically, so inventory is created without it.
  return {
    id: deviceId,
    name: suggestedName,
    type: suggestedType,
    kind,
    snmpIp: undefined,
    vendor: "generic"
  };
}

export async function syncDevicesFromPrometheus(): Promise<AutoSyncResult> {
  const startedAt = new Date().toISOString();
  if (!env.AUTO_SYNC_DEVICES) {
    return {
      enabled: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      details: []
    };
  }

  const details: AutoSyncDetail[] = [];

  // One sync pass across all known sites.
  for (const site of siteList) {
    let discovered;
    try {
      discovered = await discoverDevicesForSite(site.id);
    } catch (e) {
      details.push({
        siteId: site.id,
        deviceId: "(unknown)",
        kind: "server",
        action: "error",
        reason: e instanceof Error ? e.message : "Discovery failed"
      });
      continue;
    }

    for (const d of discovered) {
      if (d.alreadyRegistered) continue;
      if (d.kind === "network" && !env.AUTO_SYNC_NETWORK_DEVICES) {
        details.push({
          siteId: site.id,
          deviceId: d.deviceId,
          kind: d.kind,
          action: "skipped",
          reason: "Auto-sync network devices disabled"
        });
        continue;
      }

      const payload = normalizeSuggestedDevice(
        site.id,
        d.deviceId,
        d.kind,
        d.suggestedName,
        d.suggestedType
      );

      try {
        addDevice(site.id, payload);
        details.push({
          siteId: site.id,
          deviceId: d.deviceId,
          kind: d.kind,
          action: "registered"
        });
      } catch (e) {
        details.push({
          siteId: site.id,
          deviceId: d.deviceId,
          kind: d.kind,
          action: "error",
          reason: e instanceof Error ? e.message : "Add failed"
        });
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[auto-sync] registered=${details.filter((x) => x.action === "registered").length} skipped=${details.filter((x) => x.action === "skipped").length} errors=${details.filter((x) => x.action === "error").length}`
  );

  return {
    enabled: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    details
  };
}

