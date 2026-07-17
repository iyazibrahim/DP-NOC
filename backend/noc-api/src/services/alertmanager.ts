import { env } from "../env";

export type Alert = {
  status: "firing" | "resolved";
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
};

export async function getActiveAlerts() {
  const url = new URL("/api/v2/alerts", env.ALERTMANAGER_BASE_URL);
  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alertmanager request failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { alerts: Alert[] };

  // Alertmanager returns {data: [...]?} depending on version. Be permissive.
  if (Array.isArray((data as any).alerts)) return (data as any).alerts as Alert[];
  if (Array.isArray((data as any))) return (data as any) as Alert[];

  return [];
}

