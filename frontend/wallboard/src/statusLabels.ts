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

/** Three words on the wall: UP, DOWN, NO DATA. */
export function statusWord(state?: string | null): string {
  if (state === "healthy") return "UP";
  if (state === "critical" || state === "warning") return "DOWN";
  return "NO DATA";
}

export function formatDomainLine(label: string, d?: DomainStatus) {
  if (!d) return `${label}: NO DATA`;
  return `${label}: ${statusWord(d.state)}${d.notes ? ` — ${d.notes}` : ""}`;
}
