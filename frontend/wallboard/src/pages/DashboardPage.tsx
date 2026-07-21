import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useAuth } from "../auth/AuthContext";
import {
  getAllSiteStatuses,
  getDashboardLayout,
  getRecentAlerts,
  getSettings,
  getSites,
  getTopDevices,
  resetDashboardLayout,
  saveDashboardLayout,
  STATUS_POLL_MS
} from "../api";
import type { ActiveAlert, DashboardLayout, DashboardWidget, DeviceRow, Site, SiteStatus } from "../types";
import { WidgetBody, WIDGET_GROUPS } from "../components/WidgetBody";
import { WidgetConfigEditor } from "../components/WidgetConfigEditor";
import { useMetricPresets } from "../components/DeviceMetricWidgets";

function normalizeLayoutForSave(layout: DashboardLayout): DashboardLayout {
  let maxBottom = 0;
  for (const w of layout.widgets) {
    const y = Number.isFinite(w.y) && w.y >= 0 ? w.y : 0;
    maxBottom = Math.max(maxBottom, y + w.h);
  }
  return {
    ...layout,
    widgets: layout.widgets.map((w, i) => {
      const y =
        !Number.isFinite(w.y) || w.y === Infinity || w.y < 0
          ? maxBottom + i * 2
          : Math.floor(w.y);
      return { ...w, y, x: Math.floor(w.x), w: Math.floor(w.w), h: Math.floor(w.h) };
    })
  };
}

function widgetLabel(type: DashboardWidget["type"]) {
  return WIDGET_GROUPS.flatMap((g) => g.widgets).find((c) => c.type === type)?.label ?? type;
}

function widgetHasConfig(type: DashboardWidget["type"]) {
  return (
    type === "site_card" ||
    type === "grafana_panel" ||
    type === "device_metric_chart" ||
    type === "device_stat_gauge" ||
    type === "device_detail"
  );
}

export function DashboardPage() {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [statuses, setStatuses] = useState<SiteStatus[]>([]);
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [grafanaUrl, setGrafanaUrl] = useState("http://localhost:3001");
  const [width, setWidth] = useState(1200);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Which widget shows the settings panel (edit mode). */
  const [configOpenId, setConfigOpenId] = useState<string | null>(null);
  const presets = useMetricPresets();

  useEffect(() => {
    const el = document.getElementById("dashboard-grid-host");
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 1200));
    ro.observe(el);
    setWidth(el.clientWidth || 1200);
    return () => ro.disconnect();
  }, []);

  const refreshLayout = useCallback(async () => {
    if (!token) return;
    const layoutRes = await getDashboardLayout(token);
    setLayout(layoutRes.layout);
  }, [token]);

  const refreshData = useCallback(
    async (includeLayout: boolean) => {
      if (!token) return;
      try {
        if (includeLayout) {
          const [layoutRes, sitesRes, stRes, alertsRes, topRes, settings] = await Promise.all([
            getDashboardLayout(token),
            getSites(token),
            getAllSiteStatuses(token),
            getRecentAlerts(token, 30),
            getTopDevices(token),
            getSettings()
          ]);
          setLayout(layoutRes.layout);
          setSites(sitesRes.sites);
          setStatuses(stRes.statuses);
          setAlerts(alertsRes.alerts);
          setDevices(topRes.devices);
          setGrafanaUrl(settings.grafanaPublicUrl);
        } else {
          const [sitesRes, stRes, alertsRes, topRes, settings] = await Promise.all([
            getSites(token),
            getAllSiteStatuses(token),
            getRecentAlerts(token, 30),
            getTopDevices(token),
            getSettings()
          ]);
          if (!editingRef.current) {
            const layoutRes = await getDashboardLayout(token);
            setLayout(layoutRes.layout);
          }
          setSites(sitesRes.sites);
          setStatuses(stRes.statuses);
          setAlerts(alertsRes.alerts);
          setDevices(topRes.devices);
          setGrafanaUrl(settings.grafanaPublicUrl);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [token]
  );

  useEffect(() => {
    refreshData(true);
    const t = setInterval(() => refreshData(false), STATUS_POLL_MS);
    return () => clearInterval(t);
  }, [refreshData]);

  const gridLayout: Layout[] = useMemo(
    () =>
      (layout?.widgets ?? []).map((w) => ({
        i: w.i,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        minW: 2,
        minH: w.type === "mini_map" ? 3 : 2
      })),
    [layout]
  );

  /** Extra empty rows so you can drag into the lower part of a large monitor. */
  const gridMinRows = useMemo(() => {
    const bottom = (layout?.widgets ?? []).reduce((m, w) => Math.max(m, w.y + w.h), 0);
    return Math.max(bottom + 8, 22);
  }, [layout]);

  const onLayoutChange = (next: Layout[]) => {
    if (!layout || !editing) return;
    const widgets = layout.widgets.map((w) => {
      const n = next.find((x) => x.i === w.i);
      if (!n) return w;
      return { ...w, x: n.x, y: n.y, w: n.w, h: n.h };
    });
    setLayout({ ...layout, widgets });
  };

  const persist = async () => {
    if (!token || !layout) return;
    const normalized = normalizeLayoutForSave(layout);
    setLayout(normalized);
    await saveDashboardLayout(token, normalized);
    setEditing(false);
    setDrawerOpen(false);
    setConfigOpenId(null);
  };

  const addWidget = (type: DashboardWidget["type"]) => {
    if (!layout) return;
    const meta = WIDGET_GROUPS.flatMap((g) => g.widgets).find((c) => c.type === type)!;
    const id = `${type}-${Date.now()}`;
    const firstSite = sites[0];
    const collectors = (firstSite?.devices ?? []).filter((d) => (d.kind ?? "network") === "server");
    const firstDevice = collectors[0] ?? firstSite?.devices?.[0];
    let config: Record<string, string> | undefined;
    if (type === "grafana_panel") {
      config = { embedUrl: `${grafanaUrl.replace(/\/$/, "")}/` };
    } else if (type === "site_card") {
      config = { siteId: firstSite?.id ?? "" };
    } else if (
      type === "device_metric_chart" ||
      type === "device_stat_gauge" ||
      type === "device_detail"
    ) {
      config = {
        siteId: firstSite?.id ?? "",
        deviceId: firstDevice?.id ?? "",
        metric: firstDevice?.kind === "network" ? "snmp_up" : "cpu_pct"
      };
    }
    const widget: DashboardWidget = {
      i: id,
      type,
      x: 0,
      y: Infinity,
      w: meta.defaultW,
      h: meta.defaultH,
      config
    };
    setLayout({ ...layout, widgets: [...layout.widgets, widget] });
    setEditing(true);
    if (widgetHasConfig(type)) setConfigOpenId(id);
  };

  const updateWidgetConfig = (widgetId: string, config: Record<string, string>) => {
    if (!layout) return;
    setLayout({
      ...layout,
      widgets: layout.widgets.map((w) => (w.i === widgetId ? { ...w, config } : w))
    });
  };

  const removeWidget = (id: string) => {
    if (!layout) return;
    setLayout({ ...layout, widgets: layout.widgets.filter((w) => w.i !== id) });
    if (configOpenId === id) setConfigOpenId(null);
  };

  const doReset = async () => {
    if (!token) return;
    const r = await resetDashboardLayout(token);
    setLayout(r.layout);
    setConfigOpenId(null);
  };

  const cancelEdit = async () => {
    setEditing(false);
    setDrawerOpen(false);
    setConfigOpenId(null);
    await refreshLayout();
  };

  if (!layout) {
    return <div className="page">{error ? `Error: ${error}` : "Loading dashboard…"}</div>;
  }

  return (
    <div className="page dashboardPage">
      <div className="pageHeader">
        <div>
          <h1>Dashboard</h1>
          <p className="pageSub">
            Collector health, uplink, and charts — same metrics Grafana uses. In edit mode, drag
            anywhere on the grid (including empty space below).
          </p>
        </div>
        <div className="pageActions">
          {editing ? (
            <>
              <button type="button" onClick={() => setDrawerOpen(true)}>
                Add widget
              </button>
              <button type="button" className="primary" onClick={persist}>
                Save layout
              </button>
              <button type="button" onClick={cancelEdit}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" className="primary" onClick={() => setEditing(true)}>
                Edit layout
              </button>
              <button type="button" onClick={doReset}>
                Reset
              </button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="bannerHint">
          Unsaved changes — drag into empty space, resize from the bottom-right corner, use{" "}
          <strong>Settings</strong> on a widget for options. Click <strong>Save layout</strong> when
          done.
        </div>
      ) : null}

      {error && <div className="bannerError">{error}</div>}

      <div
        id="dashboard-grid-host"
        className={`dashboardHost${editing ? " dashboardHostEditing" : ""}`}
        style={{ minHeight: gridMinRows * 36 + 80 }}
      >
        <GridLayout
          className="layout"
          layout={gridLayout}
          cols={12}
          rowHeight={36}
          width={width}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          isDraggable={editing}
          isResizable={editing}
          onLayoutChange={onLayoutChange}
          draggableHandle=".widgetDrag"
          compactType={null}
          preventCollision={false}
          useCSSTransforms
          resizeHandles={["se"]}
        >
          {layout.widgets.map((w) => {
            const showConfig = editing && configOpenId === w.i && widgetHasConfig(w.type);
            return (
              <div key={w.i} className={`dashWidget${showConfig ? " dashWidgetConfigOpen" : ""}`}>
                <div className="widgetChrome">
                  {editing && (
                    <span className="widgetDrag" title="Drag">
                      ⋮⋮
                    </span>
                  )}
                  <span className="widgetTypeLabel">{widgetLabel(w.type)}</span>
                  {editing && widgetHasConfig(w.type) ? (
                    <button
                      type="button"
                      className={`iconBtn${showConfig ? " iconBtnActive" : ""}`}
                      title="Settings"
                      onClick={() => setConfigOpenId(showConfig ? null : w.i)}
                    >
                      ⚙
                    </button>
                  ) : null}
                  {editing && (
                    <button
                      type="button"
                      className="iconBtn"
                      title="Remove"
                      onClick={() => removeWidget(w.i)}
                    >
                      ×
                    </button>
                  )}
                </div>
                {showConfig ? (
                  <div className="widgetConfigPanel">
                    <WidgetConfigEditor
                      widget={w}
                      sites={sites}
                      presets={presets}
                      grafanaUrl={grafanaUrl}
                      onChange={(config) => updateWidgetConfig(w.i, config)}
                    />
                    <button
                      type="button"
                      className="widgetConfigDone"
                      onClick={() => setConfigOpenId(null)}
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <WidgetBody
                    type={w.type}
                    config={w.config}
                    sites={sites}
                    statuses={statuses}
                    alerts={alerts}
                    devices={devices}
                    grafanaUrl={grafanaUrl}
                  />
                )}
              </div>
            );
          })}
        </GridLayout>
      </div>

      {drawerOpen && (
        <div className="drawer">
          <div className="drawerTitle">Add widget</div>
          {WIDGET_GROUPS.map((group) => (
            <div key={group.label} className="drawerGroup">
              <div className="drawerGroupLabel">{group.label}</div>
              {group.widgets.map((c) => (
                <button
                  key={c.type}
                  type="button"
                  className="drawerItem"
                  onClick={() => {
                    addWidget(c.type);
                    setDrawerOpen(false);
                  }}
                >
                  <span className="drawerItemLabel">{c.label}</span>
                  {c.description ? (
                    <span className="drawerItemDesc">{c.description}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
          <button type="button" onClick={() => setDrawerOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
