import type { DashboardBoard, DashboardLayout, DashboardWidget, Site } from "@/types";

export const OVERVIEW_BOARD_ID = "overview";
export const BOARD_SESSION_KEY = "noc-dashboard-board";

/** Keep in sync with backend siteStarterWidgets in noc-api layouts.ts */
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

export function siteStarterBoard(site: { id: string; name: string }): DashboardBoard {
  return {
    id: site.id,
    title: site.name,
    siteId: site.id,
    widgets: siteStarterWidgets(site.id)
  };
}

/** Add a starter for each physical location that has no board. Never drops a board. */
export function withMissingSiteBoards(
  layout: DashboardLayout,
  sites: Site[]
): { layout: DashboardLayout; changed: boolean } {
  const physical = sites.filter((s) => s.id !== "global");
  const overview = layout.boards.find((b) => b.siteId == null);
  const extras = layout.boards.filter(
    (b) => b.siteId && !physical.some((s) => s.id === b.siteId)
  );

  const siteBoards: DashboardBoard[] = physical.map((site) => {
    const existing = layout.boards.find((b) => b.siteId === site.id);
    if (!existing) return siteStarterBoard(site);
    if (existing.title !== site.name) return { ...existing, title: site.name };
    return existing;
  });

  const boards = [...(overview ? [overview] : []), ...siteBoards, ...extras];
  const same =
    boards.length === layout.boards.length && boards.every((b, i) => b === layout.boards[i]);
  if (same) return { layout, changed: false };
  return { layout: { version: 2, boards }, changed: true };
}

/** Overview first, then locations in API order. The synthetic global site is not a slide. */
export function visibleBoards(layout: DashboardLayout, sites: Site[], sitesReady: boolean): DashboardBoard[] {
  if (!sitesReady) return layout.boards;
  const physical = sites.filter((s) => s.id !== "global");
  const overview = layout.boards.filter((b) => b.siteId == null);
  const siteBoards = physical
    .map((s) => layout.boards.find((b) => b.siteId === s.id))
    .filter((b): b is DashboardBoard => Boolean(b));
  return [...overview, ...siteBoards];
}

export function occupiedRows(widgets: DashboardWidget[]): number {
  return (
    widgets.reduce((max, w) => {
      const y = Number.isFinite(w.y) && w.y >= 0 ? w.y : 0;
      const h = Number.isFinite(w.h) && w.h > 0 ? w.h : 1;
      return Math.max(max, y + h);
    }, 0) || 1
  );
}
