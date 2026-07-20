import fs from "fs";
import path from "path";

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

const DEFAULT_LAYOUT: DashboardLayout = {
  version: 1,
  widgets: [
    { i: "sites", type: "site_status_grid", x: 0, y: 0, w: 6, h: 6 },
    { i: "alerts", type: "alerts_table", x: 6, y: 0, w: 6, h: 4 },
    { i: "topdev", type: "top_devices", x: 6, y: 4, w: 6, h: 4 },
    { i: "map", type: "mini_map", x: 0, y: 6, w: 6, h: 6 },
    { i: "websites", type: "website_summary", x: 6, y: 8, w: 6, h: 4 }
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
