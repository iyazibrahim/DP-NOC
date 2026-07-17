import type { ActiveAlert, SiteStatus } from "./types";

export type ApiSiteListItem = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Request failed: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

export async function login(
  apiBaseUrl: string,
  username: string,
  password: string
) {
  const url = new URL("/api/auth/login", apiBaseUrl);
  return fetchJson<{ token: string }>(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
}

export async function getAllSites(
  apiBaseUrl: string,
  token: string
) {
  const url = new URL("/api/sites", apiBaseUrl);
  return fetchJson<{ sites: Array<any> }>(url.toString(), {
    headers: { authorization: `Bearer ${token}` }
  });
}

export async function getAllSiteStatuses(
  apiBaseUrl: string,
  token: string
) {
  const url = new URL("/api/sites/status/all", apiBaseUrl);
  return fetchJson<{ statuses: SiteStatus[] }>(url.toString(), {
    headers: { authorization: `Bearer ${token}` }
  });
}

export async function getRecentAlerts(
  apiBaseUrl: string,
  token: string,
  limit: number
) {
  const url = new URL("/api/alerts/recent", apiBaseUrl);
  url.searchParams.set("limit", String(limit));
  return fetchJson<{ alerts: ActiveAlert[] }>(url.toString(), {
    headers: { authorization: `Bearer ${token}` }
  });
}

