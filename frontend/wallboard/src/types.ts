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
  /** Per-URL website check status (after Hetrix failover) */
  websiteStates?: Array<{
    name: string;
    url: string;
    state: DomainState;
    notes?: string;
  }>;
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
  /** Optional friendly label for Network charts / AP table */
  nickname?: string;
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
  websiteTargets: Array<{ name: string; url: string; hetrixMonitorId?: string }>;
  wan: { dnsTarget: string; vpsTarget: string };
  wanUplink?: { deviceId: string; ifName: string };
  devices: SiteDevice[];
  /** Present when a collector sync token has been generated */
  hasCollectorToken?: boolean;
  collectorDevicesSyncedAt?: string | null;
  /** When true, this location opens no incidents and pages nothing. */
  alertsMuted?: boolean;
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
  | "device_stack"
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
  | "device_health"
  | "ap_cluster"
  | "net_line_use"
  | "net_bandwidth"
  | "net_speedtest"
  | "net_ap_traffic"
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

export type DashboardBoard = {
  id: string;
  title: string;
  /** Null is the all-locations overview. */
  siteId: string | null;
  widgets: DashboardWidget[];
};

export type DashboardLayout = {
  version: 2;
  boards: DashboardBoard[];
};

export type SiteNetworkWidgetType =
  | "kpi_strip"
  | "wan_status"
  | "wan_util_summary"
  | "wan_bandwidth_chart"
  | "speedtest_chart"
  | "ap_clients_bar"
  | "ap_clients_pie"
  | "ap_traffic_bar"
  | "ap_traffic_pie"
  | "ap_table";

export type SiteNetworkWidget = {
  i: string;
  type: SiteNetworkWidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional: section (status|traffic|wireless), title, collapsed ("0"|"1") */
  config?: Record<string, string>;
};

export type SiteNetworkLayout = {
  version: 1;
  widgets: SiteNetworkWidget[];
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
  group?: "health" | "traffic" | "ports" | "signal" | "storage";
};

export type DeviceSummaryStat = {
  id: string;
  label: string;
  value: number | null;
  unit?: string;
};

export type DeviceSummary = {
  deviceId: string;
  siteId: string;
  online: DeviceSummaryStat | null;
  stats: DeviceSummaryStat[];
};

export type WirelessClusterSummary = {
  selected: number;
  reporting: number;
  clients: number | null;
  radioInBps: number | null;
  radioOutBps: number | null;
  snrAvg: number | null;
  snrMin: number | null;
  byAp: Array<{
    deviceId: string;
    label: string;
    clients: number | null;
    radioInBps?: number | null;
    radioOutBps?: number | null;
    snrAvg?: number | null;
    snrMin?: number | null;
  }>;
  stations?: Array<{
    deviceId: string;
    apLabel: string;
    mac: string | null;
    hostname: string | null;
    ip: string | null;
    ssid: string | null;
    snr: number | null;
    txRate: string | null;
    inBps: number | null;
    outBps: number | null;
  }>;
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
  reports?: Array<{ file: string; title: string; scope: string }>;
};

export type MonthlyReportPayload = {
  id: string;
  period: "weekly" | "monthly";
  scope: string;
  scopeName: string;
  generatedAt: string;
  rangeLabel: string;
  locations: Array<{
    siteId: string;
    name: string;
    address: string;
    probeUptimePct: number | null;
    internetUptimePct: number | null;
    lineInBytes: number | null;
    lineOutBytes: number | null;
    lineDays: Array<{ date: string; inBytes: number | null; outBytes: number | null }>;
    accessPoints: Array<{ name: string; inBytes: number | null; outBytes: number | null; note?: string }>;
    bandwidth?: Array<{
      name: string;
      avgInPct: number | null;
      peakInPct: number | null;
      avgOutPct: number | null;
      peakOutPct: number | null;
    }>;
  }>;
  skipped: Array<{ siteId: string; name: string }>;
  incidents: {
    opened: number;
    recovered: number;
    stillFailing: number;
    acknowledged: number;
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
  alertTypes: {
    uplink: boolean;
    collector: boolean;
    website: boolean;
    device: boolean;
    snmp: boolean;
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
