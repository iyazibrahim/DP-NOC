import { env } from "../env";

export type Alert = {
  status: "firing" | "resolved";
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
};

/**
 * Alertmanager /api/v2/alerts returns status as an object:
 * `{ state, silencedBy?, inhibitedBy?, mutedBy? }` (or inhibited/muted/silenced).
 * Webhook payloads use a plain string `"firing"|"resolved"`.
 */
function normalizeAlertStatus(raw: unknown): "firing" | "resolved" {
  if (raw === "firing" || raw === "resolved") return raw;
  if (typeof raw === "string") {
    const s = raw.toLowerCase();
    if (s === "resolved" || s === "inactive") return "resolved";
    if (s === "firing" || s === "active" || s === "suppressed" || s === "unprocessed") {
      return "firing";
    }
  }
  if (raw && typeof raw === "object") {
    const state = String((raw as { state?: unknown }).state ?? "").toLowerCase();
    if (state === "resolved" || state === "inactive") return "resolved";
    // active / suppressed / unprocessed → treat as firing for NOC tables
    if (state) return "firing";
  }
  return "firing";
}

function normalizeOneAlert(item: unknown): Alert | null {
  if (!item || typeof item !== "object") return null;
  const a = item as Record<string, unknown>;
  const labels =
    a.labels && typeof a.labels === "object"
      ? (a.labels as Record<string, string>)
      : {};
  const annotations =
    a.annotations && typeof a.annotations === "object"
      ? (a.annotations as Record<string, string>)
      : undefined;
  return {
    status: normalizeAlertStatus(a.status),
    labels,
    annotations,
    startsAt: typeof a.startsAt === "string" ? a.startsAt : undefined,
    endsAt: typeof a.endsAt === "string" ? a.endsAt : undefined
  };
}

function normalizeAlerts(data: unknown): Alert[] {
  let list: unknown[] = [];
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.alerts)) list = obj.alerts;
    else if (Array.isArray(obj.data)) list = obj.data;
  }
  return list.map(normalizeOneAlert).filter((a): a is Alert => a != null);
}

/** Never throws — empty list if Alertmanager is down or unreachable. */
export async function getActiveAlerts(): Promise<Alert[]> {
  try {
    const url = new URL("/api/v2/alerts", env.ALERTMANAGER_BASE_URL);
    const res = await fetch(url.toString(), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      console.warn(`Alertmanager ${res.status}`);
      return [];
    }
    return normalizeAlerts(await res.json());
  } catch (e) {
    console.warn("Alertmanager unreachable", e);
    return [];
  }
}
