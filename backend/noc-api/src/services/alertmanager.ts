import { env } from "../env";

export type Alert = {
  status: "firing" | "resolved";
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
};

function normalizeAlerts(data: unknown): Alert[] {
  if (Array.isArray(data)) return data as Alert[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.alerts)) return obj.alerts as Alert[];
    if (Array.isArray(obj.data)) return obj.data as Alert[];
  }
  return [];
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
