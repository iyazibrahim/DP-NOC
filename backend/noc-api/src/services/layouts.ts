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

const WIDGET_TYPES = new Set<WidgetType>([
  "site_status_grid",
  "site_signal_board",
  "local_devices_board",
  "snmp_device_status",
  "device_stack",
  "uplink_status",
  "collector_status",
  "alerts_table",
  "top_devices",
  "mini_map",
  "website_summary",
  "site_card",
  "grafana_panel",
  "device_metric_chart",
  "device_metric_bar",
  "device_stat_gauge",
  "device_detail"
]);

const OVERVIEW_WIDGETS: DashboardWidget[] = [
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
];

/** Keep in sync with frontend/wallboard/src/dashboardBoards.ts */
export function siteStarterWidgets(siteId: string): DashboardWidget[] {
  return [
    { i: `uplink-${siteId}`, type: "uplink_status", x: 0, y: 0, w: 3, h: 5, config: { siteId } },
    { i: `collector-${siteId}`, type: "collector_status", x: 3, y: 0, w: 3, h: 5, config: { siteId } },
    { i: `websites-${siteId}`, type: "website_summary", x: 6, y: 0, w: 6, h: 5 },
    { i: `local-${siteId}`, type: "local_devices_board", x: 0, y: 5, w: 6, h: 7, config: { siteId } },
    {
      i: `traffic-${siteId}`,
      type: "device_metric_chart",
      x: 6,
      y: 5,
      w: 6,
      h: 7,
      config: { siteId, metric: "if_in_bps" }
    }
  ];
}

export function overviewBoard(widgets?: DashboardWidget[]): DashboardBoard {
  return {
    id: "overview",
    title: "All locations",
    siteId: null,
    widgets: structuredClone(widgets ?? OVERVIEW_WIDGETS)
  };
}

export function siteStarterBoard(siteId: string, title: string): DashboardBoard {
  return {
    id: siteId,
    title,
    siteId,
    widgets: siteStarterWidgets(siteId)
  };
}

function isWidget(value: unknown): value is DashboardWidget {
  if (!value || typeof value !== "object") return false;
  const w = value as Partial<DashboardWidget>;
  return (
    typeof w.i === "string" &&
    w.i.length > 0 &&
    typeof w.type === "string" &&
    WIDGET_TYPES.has(w.type) &&
    Number.isFinite(Number(w.x)) &&
    Number.isFinite(Number(w.y)) &&
    Number.isFinite(Number(w.w)) &&
    Number.isFinite(Number(w.h))
  );
}

function normalizeBoard(value: unknown): DashboardBoard | null {
  if (!value || typeof value !== "object") return null;
  const b = value as Partial<DashboardBoard>;
  if (typeof b.id !== "string" || !b.id || !Array.isArray(b.widgets)) return null;
  const siteId = typeof b.siteId === "string" && b.siteId.trim() ? b.siteId : null;
  const title =
    typeof b.title === "string" && b.title.trim()
      ? b.title.trim()
      : siteId
        ? siteId
        : "All locations";
  return {
    id: b.id,
    title,
    siteId,
    widgets: b.widgets.filter(isWidget)
  };
}

function migrateLayout(parsed: unknown): DashboardLayout {
  if (!parsed || typeof parsed !== "object") return getDefaultLayout();
  const obj = parsed as { version?: number; widgets?: unknown; boards?: unknown };
  if (obj.version === 2 && Array.isArray(obj.boards)) {
    const boards = obj.boards.map(normalizeBoard).filter((b): b is DashboardBoard => b != null);
    if (boards.length === 0) return getDefaultLayout();
    return { version: 2, boards };
  }
  if (Array.isArray(obj.widgets)) {
    const widgets = obj.widgets.filter(isWidget);
    return { version: 2, boards: [overviewBoard(widgets.length > 0 ? widgets : undefined)] };
  }
  return getDefaultLayout();
}

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
  return { version: 2, boards: [overviewBoard()] };
}

export function loadLayout(userId: string): DashboardLayout {
  const file = layoutPath(userId);
  if (!fs.existsSync(file)) {
    return getDefaultLayout();
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    return migrateLayout(JSON.parse(raw));
  } catch {
    return getDefaultLayout();
  }
}

export function saveLayout(userId: string, layout: DashboardLayout) {
  const file = layoutPath(userId);
  fs.writeFileSync(file, JSON.stringify(layout, null, 2), "utf8");
}

/** Full reset restores the overview board. A boardId resets only that slide. */
export function resetLayout(userId: string, boardId?: string) {
  if (!boardId) {
    const layout = getDefaultLayout();
    saveLayout(userId, layout);
    return layout;
  }
  const current = loadLayout(userId);
  const boards = current.boards.map((b) => {
    if (b.id !== boardId) return b;
    if (!b.siteId) return overviewBoard();
    return siteStarterBoard(b.siteId, b.title);
  });
  const layout: DashboardLayout = { version: 2, boards };
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
