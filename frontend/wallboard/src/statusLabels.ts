/** Helpers for plain-language status fields (API sends both old and new keys). */
import type { DomainStatus, SiteStatus } from "./types";

export function uplinkOf(st?: SiteStatus | null): DomainStatus {
  return st?.uplink ?? st?.wan ?? { state: "unknown" };
}

export function localDevicesOf(st?: SiteStatus | null): DomainStatus {
  return st?.localDevices ?? st?.lan ?? { state: "unknown" };
}

export function collectorOf(st?: SiteStatus | null): DomainStatus {
  return st?.collector ?? { state: "unknown", notes: "Waiting for collector data" };
}

export function formatDomainLine(label: string, d?: DomainStatus) {
  if (!d) return `${label}: unknown`;
  return `${label}: ${d.state}${d.notes ? ` — ${d.notes}` : ""}`;
}
