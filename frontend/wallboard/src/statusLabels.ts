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

/** Combined probe + internet state. A missing check is not shown as up. */
export function connectivityState(collector?: string | null, uplink?: string | null): string {
  const rank: Record<string, number> = { critical: 3, warning: 2, unknown: 1, healthy: 0 };
  const a = collector || "unknown";
  const b = uplink || "unknown";
  return (rank[a] ?? 1) >= (rank[b] ?? 1) ? a : b;
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
