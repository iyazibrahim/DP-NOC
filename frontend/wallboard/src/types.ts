export type DomainState = "healthy" | "warning" | "critical" | "unknown";

export type DomainStatus = {
  state: DomainState;
  notes?: string;
};

export type SiteStatus = {
  siteId: string;
  lat?: number;
  lng?: number;
  wan: DomainStatus;
  websites: DomainStatus;
  lan: DomainStatus;
  alerts: { firing: number; resolved: number };
  overall: DomainState;
};

export type SiteDevice = {
  id: string;
  name: string;
  type: string;
  snmpIp: string;
  vendor: string;
};

export type Site = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  websiteTargets: Array<{ name: string; url: string }>;
  wan: { dnsTarget: string; vpsTarget: string };
  devices: SiteDevice[];
};

export type ActiveAlert = {
  status: "firing" | "resolved";
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
};

export type WidgetType =
  | "site_status_grid"
  | "alerts_table"
  | "top_devices"
  | "mini_map"
  | "website_summary"
  | "site_card"
  | "grafana_panel";

export type DashboardWidget = {
  i: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, string>;
};

export type DashboardLayout = {
  version: 1;
  widgets: DashboardWidget[];
};

export type DeviceRow = SiteDevice & {
  siteId: string;
  siteName: string;
  alertCount?: number;
};
