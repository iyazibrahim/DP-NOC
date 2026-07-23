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
  /** Per-network-device SNMP status */
  localDeviceStates?: Array<{
    deviceId: string;
    name: string;
    snmpIp?: string;
    state: DomainState;
    notes?: string;
  }>;
  collector?: DomainStatus;
  collectorDeviceStates?: Array<{
    deviceId: string;
    name: string;
    metricId: string;
    state: DomainState;
    notes?: string;
    live: boolean;
  }>;
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
  /** Optional per-device SNMPv2c community; collector uses site default if omitted */
  snmpCommunity?: string;
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
  /** Present when a collector sync token has been generated */
  hasCollectorToken?: boolean;
  collectorDevicesSyncedAt?: string | null;
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
  | "local_devices_board"
  | "snmp_device_status"
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
  /** Optional keys: siteId, deviceId, metric, embedUrl, title (custom display name) */
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
  /** When set, only offer for matching device.type (e.g. firewall, switch, ap). */
  deviceTypes?: string[];
  /** When set, only offer when device.vendor matches (normalized). */
  vendors?: string[];
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

export type MonthlyReportPayload = {
  id: string;
  period: "weekly" | "monthly";
  generatedAt: string;
  rangeDays: number;
  sites: Array<{
    siteId: string;
    name: string;
    address: string;
    overall: string;
    wan: string;
    lan: string;
    wanUptimePct: string | null;
    deviceCount: number;
  }>;
  devices: Array<{
    siteId: string;
    siteName: string;
    deviceId: string;
    name: string;
    kind?: string;
    uptimePct: number | null;
    avgUtilInPct?: number | null;
    avgUtilOutPct?: number | null;
    peakUtilInPct?: number | null;
    peakUtilOutPct?: number | null;
  }>;
  alerts: {
    firing: number;
    resolved: number;
    topAlertnames: Array<{ alertname: string; count: number }>;
  };
  incidents: {
    summary: {
      openedInRange: number;
      resolvedInRange: number;
      stillOpen: number;
      acknowledgedInRange: number;
    };
    timeline: Array<{
      id: string;
      title: string;
      siteId: string;
      siteName: string;
      kind: string;
      detail: string;
      openedAt: string;
      resolvedAt?: string;
      acknowledgedAt?: string;
      acknowledgedBy?: string;
    }>;
  };
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
