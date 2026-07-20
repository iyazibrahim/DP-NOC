import type {
  ActiveAlert,
  DashboardLayout,
  DeviceRow,
  Site,
  SiteStatus
} from "./types";

const apiBase = (import.meta.env.VITE_API_BASE_URL?.toString() ?? "").replace(/\/$/, "");

function url(path: string) {
  return `${apiBase}${path}`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Request failed: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

export async function login(username: string, password: string) {
  return fetchJson<{ token: string }>("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
}

export async function getSettings() {
  return fetchJson<{ grafanaPublicUrl: string }>("/api/settings");
}

export async function getSites(token: string) {
  return fetchJson<{ sites: Site[] }>("/api/sites", {
    headers: authHeaders(token)
  });
}

export async function getSite(token: string, id: string) {
  return fetchJson<{ site: Site }>(`/api/sites/${id}`, {
    headers: authHeaders(token)
  });
}

export async function addSiteDevice(
  token: string,
  siteId: string,
  device: {
    id: string;
    name: string;
    type: string;
    snmpIp: string;
    vendor: string;
  }
) {
  return fetchJson<{ site: Site }>(`/api/sites/${siteId}/devices`, {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(device)
  });
}

export async function updateSiteDevice(
  token: string,
  siteId: string,
  deviceId: string,
  patch: Partial<{ name: string; type: string; snmpIp: string; vendor: string }>
) {
  return fetchJson<{ site: Site }>(`/api/sites/${siteId}/devices/${deviceId}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(patch)
  });
}

export async function deleteSiteDevice(token: string, siteId: string, deviceId: string) {
  return fetchJson<{ site: Site }>(`/api/sites/${siteId}/devices/${deviceId}`, {
    method: "DELETE",
    headers: authHeaders(token)
  });
}

export async function getAllSiteStatuses(token: string) {
  return fetchJson<{ statuses: SiteStatus[] }>("/api/sites/status/all", {
    headers: authHeaders(token)
  });
}

export async function getRecentAlerts(token: string, limit = 50) {
  return fetchJson<{ alerts: ActiveAlert[] }>(`/api/alerts/recent?limit=${limit}`, {
    headers: authHeaders(token)
  });
}

export async function getDevices(token: string) {
  return fetchJson<{ devices: DeviceRow[] }>("/api/devices", {
    headers: authHeaders(token)
  });
}

export async function getTopDevices(token: string) {
  return fetchJson<{ devices: DeviceRow[]; sites: DeviceRow[] }>(
    "/api/devices/top-by-alerts",
    { headers: authHeaders(token) }
  );
}

export async function getWebsites(token: string) {
  return fetchJson<{
    websites: Array<{
      siteId: string;
      siteName: string;
      name: string;
      url: string;
      state: string;
      notes?: string;
    }>;
  }>("/api/websites", { headers: authHeaders(token) });
}

export async function getDashboardLayout(token: string) {
  return fetchJson<{ layout: DashboardLayout }>("/api/dashboards/me", {
    headers: authHeaders(token)
  });
}

export async function saveDashboardLayout(token: string, layout: DashboardLayout) {
  return fetchJson<{ layout: DashboardLayout }>("/api/dashboards/me", {
    method: "PUT",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(layout)
  });
}

export async function resetDashboardLayout(token: string) {
  return fetchJson<{ layout: DashboardLayout }>("/api/dashboards/me/reset", {
    method: "POST",
    headers: authHeaders(token)
  });
}
