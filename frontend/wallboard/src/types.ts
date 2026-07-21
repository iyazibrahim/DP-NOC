export type DomainState = "healthy" | "warning" | "critical" | "unknown";

export type DomainStatus = {
  state: DomainState;
  notes?: string;
};

export type SiteStatus = {
  siteId: string;
  lat?: number;
  lng?: number;
  /** @deprecated prefer uplink */
  wan: DomainStatus;
  uplink?: DomainStatus;
  websites: DomainStatus;
  /** @deprecated prefer localDevices */
  lan: DomainStatus;
  localDevices?: DomainStatus;
  collector?: DomainStatus;
  websiteTargetCount?: number;
  alerts: { firing: number; resolved: number };
  overall: DomainState;
};

export type DeviceKind = "server" | "network";

export type DeviceTypeDef = {
  id: string;
  label: string;
  kind: DeviceKind;
  icon?: string;
};

export type SiteDevice = {
  id: string;
  name: string;
  type: string;
  kind: DeviceKind;
  snmpIp?: string;
  hostMetricId?: string;
  vendor: string;
};

export type Site = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  notes?: string;
  createdAt?: string;
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
  | "site_signal_board"
  | "uplink_status"
  | "collector_status"
  | "alerts_table"
  | "top_devices"
  | "mini_map"
  | "website_summary"
  | "site_card"
  | "grafana_panel"
  | "device_metric_chart"
  | "device_metric_bar"
  | "device_stat_gauge"
  | "device_detail";

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

export type MetricPreset = {
  id: string;
  label: string;
  kind: "server" | "network" | "any";
  query: string;
  unit?: string;
};

export type RetentionConfig = {
  retentionTime: string;
  retentionSizeGB: number;
  hostScrapeIntervalSec: number;
  icmpScrapeIntervalSec: number;
  snmpScrapeIntervalSec: number;
  scheduledExportsEnabled: boolean;
};

export type ExportRecord = {
  id: string;
  period: "weekly" | "monthly";
  createdAt: string;
  dir: string;
  files: string[];
};

export type StatusMeta = {
  checkedAt: string;
  dashboardRefreshSec: number;
  metricFreshWindowSec: number;
  typicalDetectionSec: number;
  scrapeIntervalSec: number;
};

export type NotificationsConfig = {
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
    hasToken?: boolean;
  };
  email: {
    enabled: boolean;
    to: string;
    from: string;
    smarthost: string;
    authUsername: string;
    authPassword: string;
    hasPassword?: boolean;
  };
  webhook: {
    enabled: boolean;
    url: string;
  };
  route: {
    groupWait: string;
    groupInterval: string;
    repeatInterval: string;
  };
};

export type StatusTimingInfo = {
  dashboardRefreshSec: number;
  metricFreshWindowSec: number;
  typicalDetectionSec: number;
  scrapeIntervalSec: number;
  notes: string[];
};

export type PromQueryResult = {
  resultType: string;
  result: unknown;
};

export type DiscoveredDevice = {
  siteId?: string;
  deviceId: string;
  kind: DeviceKind;
  lastSeen: string | null;
  alreadyRegistered: boolean;
  suggestedName: string;
  suggestedType: string;
};

export type DiscoveryDiagnostics = {
  prometheusReachable: boolean;
  labelMismatchHints: string[];
  plainSummary?: string;
};
