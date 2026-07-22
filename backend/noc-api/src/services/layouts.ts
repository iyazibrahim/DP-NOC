import fs from "fs";
import path from "path";

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
