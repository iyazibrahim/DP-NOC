import fs from "fs";
import path from "path";

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

const DEFAULT_LAYOUT: DashboardLayout = {
  version: 1,
  widgets: [
    { i: "signals", type: "site_signal_board", x: 0, y: 0, w: 5, h: 8 },
    { i: "local", type: "local_devices_board", x: 5, y: 0, w: 4, h: 8, config: { siteId: "site-1" } },
    { i: "uplink", type: "uplink_status", x: 9, y: 0, w: 3, h: 4, config: { siteId: "site-1" } },
    { i: "collector", type: "collector_status", x: 9, y: 4, w: 3, h: 4, config: { siteId: "site-1" } },
    { i: "cpu", type: "device_metric_chart", x: 0, y: 8, w: 6, h: 5, config: { siteId: "site-1", metric: "cpu_pct" } },
    { i: "snmp_traffic", type: "device_metric_chart", x: 6, y: 8, w: 6, h: 5, config: { siteId: "site-1", metric: "if_in_bps" } },
    { i: "mem", type: "device_stat_gauge", x: 0, y: 13, w: 3, h: 4, config: { siteId: "site-1", metric: "mem_pct" } },
    { i: "disk", type: "device_stat_gauge", x: 3, y: 13, w: 3, h: 4, config: { siteId: "site-1", metric: "disk_pct" } },
    { i: "map", type: "mini_map", x: 6, y: 13, w: 6, h: 6 },
    { i: "alerts", type: "alerts_table", x: 0, y: 17, w: 6, h: 4 }
  ]
};

function layoutsDir() {
  const candidates = [
    path.join(process.cwd(), "data/layouts"),
    path.join(__dirname, "../../data/layouts")
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // try next
    }
  }
  const fallback = path.join(process.cwd(), "data/layouts");
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function layoutPath(userId: string) {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(layoutsDir(), `${safe}.json`);
}

export function getDefaultLayout(): DashboardLayout {
  return structuredClone(DEFAULT_LAYOUT);
}

export function loadLayout(userId: string): DashboardLayout {
  const file = layoutPath(userId);
  if (!fs.existsSync(file)) {
    return getDefaultLayout();
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as DashboardLayout;
    if (!parsed?.widgets || !Array.isArray(parsed.widgets)) {
      return getDefaultLayout();
    }
    return parsed;
  } catch {
    return getDefaultLayout();
  }
}

export function saveLayout(userId: string, layout: DashboardLayout) {
  const file = layoutPath(userId);
  fs.writeFileSync(file, JSON.stringify(layout, null, 2), "utf8");
}

export function resetLayout(userId: string) {
  const layout = getDefaultLayout();
  saveLayout(userId, layout);
  return layout;
}

/** Site Network tab widgets (per-user, per-site). */
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

export type SiteNetworkSection = "status" | "traffic" | "wireless";

export type SiteNetworkWidget = {
  i: string;
  type: SiteNetworkWidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, string>;
};

export type SiteNetworkLayout = {
  version: 1;
  widgets: SiteNetworkWidget[];
};

const DEFAULT_SITE_NETWORK_LAYOUT: SiteNetworkLayout = {
  version: 1,
  widgets: [
    { i: "kpi", type: "kpi_strip", x: 0, y: 0, w: 12, h: 2, config: { section: "status" } },
    { i: "wan_note", type: "wan_status", x: 0, y: 2, w: 12, h: 1, config: { section: "status" } },
    {
      i: "util",
      type: "wan_util_summary",
      x: 0,
      y: 3,
      w: 4,
      h: 4,
      config: { section: "traffic" }
    },
    {
      i: "wan_chart",
      type: "wan_bandwidth_chart",
      x: 4,
      y: 3,
      w: 8,
      h: 5,
      config: { section: "traffic" }
    },
    {
      i: "speed",
      type: "speedtest_chart",
      x: 0,
      y: 8,
      w: 12,
      h: 5,
      config: { section: "traffic" }
    },
    {
      i: "ap_bar",
      type: "ap_clients_bar",
      x: 0,
      y: 13,
      w: 6,
      h: 5,
      config: { section: "wireless" }
    },
    {
      i: "ap_pie",
      type: "ap_clients_pie",
      x: 6,
      y: 13,
      w: 6,
      h: 5,
      config: { section: "wireless" }
    },
    {
      i: "ap_tbar",
      type: "ap_traffic_bar",
      x: 0,
      y: 18,
      w: 6,
      h: 5,
      config: { section: "wireless" }
    },
    {
      i: "ap_tpie",
      type: "ap_traffic_pie",
      x: 6,
      y: 18,
      w: 6,
      h: 5,
      config: { section: "wireless" }
    },
    { i: "ap_table", type: "ap_table", x: 0, y: 23, w: 12, h: 5, config: { section: "wireless" } }
  ]
};

function siteNetworkLayoutPath(userId: string, siteId: string) {
  const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeSite = siteId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(layoutsDir(), `${safeUser}__siteNetwork__${safeSite}.json`);
}

export function getDefaultSiteNetworkLayout(): SiteNetworkLayout {
  return structuredClone(DEFAULT_SITE_NETWORK_LAYOUT);
}

export function loadSiteNetworkLayout(userId: string, siteId: string): SiteNetworkLayout {
  const file = siteNetworkLayoutPath(userId, siteId);
  if (!fs.existsSync(file)) {
    return getDefaultSiteNetworkLayout();
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as SiteNetworkLayout;
    if (!parsed?.widgets || !Array.isArray(parsed.widgets)) {
      return getDefaultSiteNetworkLayout();
    }
    return parsed;
  } catch {
    return getDefaultSiteNetworkLayout();
  }
}

export function saveSiteNetworkLayout(
  userId: string,
  siteId: string,
  layout: SiteNetworkLayout
) {
  const file = siteNetworkLayoutPath(userId, siteId);
  fs.writeFileSync(file, JSON.stringify(layout, null, 2), "utf8");
}

export function resetSiteNetworkLayout(userId: string, siteId: string) {
  const layout = getDefaultSiteNetworkLayout();
  saveSiteNetworkLayout(userId, siteId, layout);
  return layout;
}
