import type {
  ActiveAlert,
  DashboardLayout,
  DeviceRow,
  ExportRecord,
  MetricPreset,
  PromQueryResult,
  RetentionConfig,
  Site,
  SiteDevice,
  SiteStatus,
  StatusMeta,
  NotificationsConfig,
  StatusTimingInfo,
  DeviceKind,
  DeviceTypeDef,
  DiscoveredDevice
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

export async function createSite(
  token: string,
  input: {
    name: string;
    lat: number;
    lng: number;
    address?: string;
    notes?: string;
    wan?: Site["wan"];
  }
) {
  return fetchJson<{ site: Site }>("/api/sites", {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function updateSite(
  token: string,
  id: string,
  patch: Partial<Pick<Site, "name" | "lat" | "lng" | "address" | "notes" | "wan" | "websiteTargets">>
) {
  return fetchJson<{ site: Site }>(`/api/sites/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(patch)
  });
}

export async function deleteSite(token: string, id: string) {
  return fetchJson<{ ok: boolean }>(`/api/sites/${id}`, {
    method: "DELETE",
    headers: authHeaders(token)
  });
}

export async function resetSitesFromSeed(token: string) {
  return fetchJson<{ sites: Site[] }>("/api/sites/reset-from-seed", {
    method: "POST",
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
    kind: SiteDevice["kind"];
    snmpIp?: string;
    hostMetricId?: string;
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
  patch: Partial<Omit<SiteDevice, "id">>
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

export async function getDiscoveredDevices(token: string, siteId: string) {
  return fetchJson<{ devices: DiscoveredDevice[] }>(
    `/api/sites/${siteId}/discovered-devices`,
    { headers: authHeaders(token) }
  );
}

export async function downloadSiteDevicesJson(token: string, siteId: string) {
  const res = await fetch(url(`/api/sites/${siteId}/export/devices.json`), {
    headers: authHeaders(token)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Download failed: ${res.status} ${body}`);
  }
  return res.blob();
}

export async function getDeviceTypes(token: string) {
  return fetchJson<{ types: DeviceTypeDef[] }>("/api/device-types", {
    headers: authHeaders(token)
  });
}

export async function addDeviceType(
  token: string,
  input: { label: string; kind: DeviceKind; id?: string }
) {
  return fetchJson<{ type: DeviceTypeDef; types: DeviceTypeDef[] }>("/api/device-types", {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function addSiteWebsite(
  token: string,
  siteId: string,
  website: { name: string; url: string }
) {
  return fetchJson<{ site: Site }>(`/api/sites/${siteId}/websites`, {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(website)
  });
}

export async function updateSiteWebsite(
  token: string,
  siteId: string,
  payload: { url: string; name?: string; newUrl?: string }
) {
  return fetchJson<{ site: Site }>(`/api/sites/${siteId}/websites`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function deleteSiteWebsite(token: string, siteId: string, url: string) {
  return fetchJson<{ site: Site }>(`/api/sites/${siteId}/websites`, {
    method: "DELETE",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ url })
  });
}

export async function applyWebsiteProbes(token: string, siteId: string) {
  return fetchJson<{ ok: boolean; message: string }>(
    `/api/sites/${siteId}/websites/apply-probes`,
    { method: "POST", headers: authHeaders(token) }
  );
}

export async function getAllSiteStatuses(token: string) {
  return fetchJson<{ statuses: SiteStatus[]; meta: StatusMeta }>("/api/sites/status/all", {
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

export async function getRetentionSettings(token: string) {
  return fetchJson<{
    config: RetentionConfig;
    tsdb: unknown;
    storageBytes: number | null;
    flagsFile: string;
  }>("/api/settings/retention", { headers: authHeaders(token) });
}

export async function saveRetentionSettings(token: string, config: Partial<RetentionConfig>) {
  return fetchJson<{
    config: RetentionConfig;
    tsdb: unknown;
    storageBytes: number | null;
    flagsFile: string;
  }>("/api/settings/retention", {
    method: "PATCH",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(config)
  });
}

export async function applyRetentionSettings(token: string) {
  return fetchJson<{ ok: boolean; message: string }>("/api/settings/retention/apply", {
    method: "POST",
    headers: authHeaders(token)
  });
}

export async function getMetricPresets(token: string) {
  return fetchJson<{ presets: MetricPreset[] }>("/api/metrics/presets", {
    headers: authHeaders(token)
  });
}

export async function getMetricInstant(
  token: string,
  params: { preset: string; siteId: string; deviceId: string }
) {
  const q = new URLSearchParams(params);
  return fetchJson<{ data: PromQueryResult; query: string }>(`/api/metrics/instant?${q}`, {
    headers: authHeaders(token)
  });
}

export async function getMetricRange(
  token: string,
  params: { preset: string; siteId: string; deviceId: string; hours?: number }
) {
  const q = new URLSearchParams({
    preset: params.preset,
    siteId: params.siteId,
    deviceId: params.deviceId,
    hours: String(params.hours ?? 1)
  });
  return fetchJson<{ data: PromQueryResult; query: string }>(`/api/metrics/query_range?${q}`, {
    headers: authHeaders(token)
  });
}

export async function listExports(token: string) {
  return fetchJson<{ exports: ExportRecord[] }>("/api/exports", {
    headers: authHeaders(token)
  });
}

export async function runExport(token: string, period: "weekly" | "monthly") {
  return fetchJson<{ export: ExportRecord }>("/api/exports/run", {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ period })
  });
}

export async function downloadExportFile(token: string, exportId: string, filename: string) {
  const res = await fetch(url(`/api/exports/${exportId}/download/${filename}`), {
    headers: authHeaders(token)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Download failed: ${res.status} ${body}`);
  }
  return res.blob();
}

export async function getNotificationsSettings(token: string) {
  return fetchJson<{ config: NotificationsConfig }>("/api/settings/notifications", {
    headers: authHeaders(token)
  });
}

export async function saveNotificationsSettings(
  token: string,
  config: Partial<NotificationsConfig>
) {
  return fetchJson<{ config: NotificationsConfig }>("/api/settings/notifications", {
    method: "PATCH",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(config)
  });
}

export async function applyNotificationsSettings(token: string) {
  return fetchJson<{ ok: boolean; message: string }>("/api/settings/notifications/apply", {
    method: "POST",
    headers: authHeaders(token)
  });
}

export async function getStatusTiming(token: string) {
  return fetchJson<StatusTimingInfo>("/api/settings/status-timing", {
    headers: authHeaders(token)
  });
}

/** Dashboard status poll interval (ms) — keep in sync with backend STATUS_DASHBOARD_REFRESH_SEC */
export const STATUS_POLL_MS = 10_000;
