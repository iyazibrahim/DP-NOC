import { useCallback, useEffect, useMemo, useState } from "react";
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
import { WidgetBody, WIDGET_CATALOG } from "../components/WidgetBody";
import { WidgetConfigEditor } from "../components/WidgetConfigEditor";
import { useMetricPresets } from "../components/DeviceMetricWidgets";

export function DashboardPage() {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [statuses, setStatuses] = useState<SiteStatus[]>([]);
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [grafanaUrl, setGrafanaUrl] = useState("http://localhost:3001");
  const [width, setWidth] = useState(1200);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const presets = useMetricPresets();

  useEffect(() => {
    const el = document.getElementById("dashboard-grid-host");
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 1200));
    ro.observe(el);
    setWidth(el.clientWidth || 1200);
    return () => ro.disconnect();
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
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
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [token]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, STATUS_POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const gridLayout: Layout[] = useMemo(
    () =>
      (layout?.widgets ?? []).map((w) => ({
        i: w.i,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        minW: 2,
        minH: 2
      })),
    [layout]
  );

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
    await saveDashboardLayout(token, layout);
    setEditing(false);
    setDrawerOpen(false);
  };

  const addWidget = (type: DashboardWidget["type"]) => {
    if (!layout) return;
    const meta = WIDGET_CATALOG.find((c) => c.type === type)!;
    const id = `${type}-${Date.now()}`;
    const firstSite = sites[0];
    const firstDevice = firstSite?.devices?.[0];
    let config: Record<string, string> | undefined;
    if (type === "grafana_panel") {
      config = { embedUrl: `${grafanaUrl}/` };
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
  };

  const doReset = async () => {
    if (!token) return;
    const r = await resetDashboardLayout(token);
    setLayout(r.layout);
  };

  if (!layout) {
    return <div className="page">{error ? `Error: ${error}` : "Loading dashboard…"}</div>;
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Dashboard</h1>
          <p className="pageSub">Drag widgets like Grafana — save your own layout.</p>
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
              <button type="button" onClick={() => { setEditing(false); refresh(); }}>
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

      {error && <div className="bannerError">{error}</div>}

      <div id="dashboard-grid-host" className="dashboardHost">
        <GridLayout
          className="layout"
          layout={gridLayout}
          cols={12}
          rowHeight={36}
          width={width}
          isDraggable={editing}
          isResizable={editing}
          onLayoutChange={onLayoutChange}
          draggableHandle=".widgetDrag"
          compactType="vertical"
        >
          {layout.widgets.map((w) => (
            <div key={w.i} className="dashWidget">
              <div className="widgetChrome">
                {editing && <span className="widgetDrag">⋮⋮</span>}
                <span className="widgetTypeLabel">{w.type}</span>
                {editing && (
                  <button type="button" className="iconBtn" onClick={() => removeWidget(w.i)}>
                    ×
                  </button>
                )}
              </div>
              {editing ? (
                <WidgetConfigEditor
                  widget={w}
                  sites={sites}
                  presets={presets}
                  onChange={(config) => updateWidgetConfig(w.i, config)}
                />
              ) : null}
              <WidgetBody
                type={w.type}
                config={w.config}
                sites={sites}
                statuses={statuses}
                alerts={alerts}
                devices={devices}
                grafanaUrl={grafanaUrl}
              />
            </div>
          ))}
        </GridLayout>
      </div>

      {drawerOpen && (
        <div className="drawer">
          <div className="drawerTitle">Add widget</div>
          {WIDGET_CATALOG.map((c) => (
            <button
              key={c.type}
              type="button"
              className="drawerItem"
              onClick={() => {
                addWidget(c.type);
                setDrawerOpen(false);
              }}
            >
              {c.label}
            </button>
          ))}
          <button type="button" onClick={() => setDrawerOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
