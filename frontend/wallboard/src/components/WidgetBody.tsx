import type { ActiveAlert, DeviceRow, Site, SiteStatus, WidgetType } from "../types";
import { StatusPill } from "./StatusPill";
import { SitesLeafletMap } from "./SitesLeafletMap";
import { TopDevicesTable } from "./TopDevicesTable";
import {
  DeviceDetailPanel,
  DeviceMetricChart,
  DeviceStatGauge,
  useMetricPresets
} from "./DeviceMetricWidgets";
import { collectorOf, localDevicesOf, uplinkOf } from "../statusLabels";

export type WidgetCatalogEntry = {
  type: WidgetType;
  label: string;
  description?: string;
  defaultW: number;
  defaultH: number;
};

export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  { type: "site_status_grid", label: "Site health overview", defaultW: 6, defaultH: 6 },
  { type: "alerts_table", label: "Active alerts", defaultW: 6, defaultH: 4 },
  { type: "top_devices", label: "Top devices", defaultW: 6, defaultH: 4 },
  { type: "mini_map", label: "Map", defaultW: 6, defaultH: 6 },
  { type: "website_summary", label: "Website checks summary", defaultW: 6, defaultH: 4 },
  { type: "site_card", label: "Single site card", defaultW: 4, defaultH: 4 },
  {
    type: "device_metric_chart",
    label: "Collector chart",
    description: "CPU, memory, disk over time — pick a collector",
    defaultW: 6,
    defaultH: 5
  },
  {
    type: "device_stat_gauge",
    label: "Collector gauge",
    description: "One metric as a gauge / pie",
    defaultW: 3,
    defaultH: 4
  },
  {
    type: "grafana_panel",
    label: "Grafana panel",
    description: "Optional deep-dive chart (same metrics as this dashboard)",
    defaultW: 6,
    defaultH: 6
  },
  {
    type: "device_detail",
    label: "Device info",
    description: "Name and IDs only",
    defaultW: 4,
    defaultH: 4
  }
];

export const WIDGET_GROUPS: Array<{ label: string; widgets: WidgetCatalogEntry[] }> = [
  {
    label: "Overview",
    widgets: WIDGET_CATALOG.filter((w) =>
      ["site_status_grid", "alerts_table", "top_devices", "mini_map", "website_summary", "site_card"].includes(
        w.type
      )
    )
  },
  {
    label: "Charts",
    widgets: WIDGET_CATALOG.filter((w) =>
      ["device_metric_chart", "device_stat_gauge", "grafana_panel"].includes(w.type)
    )
  },
  {
    label: "Info",
    widgets: WIDGET_CATALOG.filter((w) => w.type === "device_detail")
  }
];

export function WidgetBody({
  type,
  config,
  sites,
  statuses,
  alerts,
  devices,
  grafanaUrl: _grafanaUrl
}: {
  type: WidgetType;
  config?: Record<string, string>;
  sites: Site[];
  statuses: SiteStatus[];
  alerts: ActiveAlert[];
  devices: DeviceRow[];
  grafanaUrl: string;
}) {
  const presets = useMetricPresets();
  const siteId = config?.siteId ?? sites[0]?.id ?? "";
  const site = sites.find((s) => s.id === siteId);
  const collectors = (site?.devices ?? []).filter((d) => (d.kind ?? "network") === "server");
  const deviceId = config?.deviceId || collectors[0]?.id || site?.devices?.[0]?.id || "";
  const metric = config?.metric ?? "cpu_pct";

  if (type === "site_status_grid") {
    return (
      <div className="widgetInner">
        <div className="widgetTitle">Sites</div>
        <div className="statusGrid">
          {sites.map((s) => {
            const st = statuses.find((x) => x.siteId === s.id);
            const col = collectorOf(st);
            const up = uplinkOf(st);
            return (
              <div key={s.id} className="statusTile">
                <div className="statusTileName">{s.name}</div>
                <StatusPill state={st?.overall ?? "unknown"} notes={col.notes ?? up.notes} />
                <div className="statusTileMeta">
                  <span>Collector: {col.state}</span>
                  <span>Uplink: {up.state}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (type === "alerts_table") {
    const firing = alerts.filter((a) => a.status === "firing").slice(0, 8);
    return (
      <div className="widgetInner">
        <div className="widgetTitle">Active alerts</div>
        {firing.length === 0 ? (
          <div className="muted">No firing alerts</div>
        ) : (
          <ul className="alertUl">
            {firing.map((a, i) => (
              <li key={i}>
                <strong>{a.labels.alertname ?? "alert"}</strong> · {a.labels.site ?? "—"}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (type === "top_devices") {
    return (
      <div className="widgetInner flush">
        <TopDevicesTable devices={devices} />
      </div>
    );
  }

  if (type === "mini_map") {
    return (
      <div className="widgetInner flush">
        <SitesLeafletMap sites={sites} statuses={statuses} height="100%" />
      </div>
    );
  }

  if (type === "website_summary") {
    const counts = { healthy: 0, warning: 0, critical: 0, unknown: 0 };
    for (const st of statuses) {
      const n = st.websiteTargetCount ?? 0;
      if (n <= 0) continue;
      counts[st.websites.state] += n;
    }
    return (
      <div className="widgetInner">
        <div className="widgetTitle">Website checks</div>
        <div className="kvList">
          <div>Healthy: {counts.healthy}</div>
          <div>Warning: {counts.warning}</div>
          <div>Critical: {counts.critical}</div>
          <div>Unknown: {counts.unknown}</div>
        </div>
      </div>
    );
  }

  if (type === "site_card") {
    const cardSiteId = config?.siteId ?? sites[0]?.id;
    const cardSite = sites.find((s) => s.id === cardSiteId);
    const st = statuses.find((x) => x.siteId === cardSiteId);
    const col = collectorOf(st);
    const up = uplinkOf(st);
    const loc = localDevicesOf(st);
    return (
      <div className="widgetInner">
        <div className="widgetTitle">{cardSite?.name ?? cardSiteId ?? "Site"}</div>
        <div className="kvList">
          <div>Collector: {col.state}</div>
          <div>Uplink: {up.state}</div>
          <div>Local devices: {loc.state}</div>
          <div>Website checks: {st?.websites.state ?? "unknown"}</div>
        </div>
        <StatusPill state={st?.overall ?? "unknown"} notes={col.notes ?? up.notes} />
      </div>
    );
  }

  if (type === "device_metric_chart") {
    return (
      <div className="widgetInner">
        <DeviceMetricChart
          siteId={siteId}
          deviceId={deviceId}
          metric={metric}
          presets={presets}
        />
      </div>
    );
  }

  if (type === "device_stat_gauge") {
    return (
      <div className="widgetInner">
        <DeviceStatGauge siteId={siteId} deviceId={deviceId} metric={metric} presets={presets} />
      </div>
    );
  }

  if (type === "device_detail") {
    return (
      <div className="widgetInner">
        <div className="widgetTitle">Device info</div>
        <DeviceDetailPanel site={site} deviceId={deviceId} />
      </div>
    );
  }

  if (type === "grafana_panel") {
    const url = config?.embedUrl || config?.url || "";
    if (!url) {
      return (
        <div className="widgetInner">
          <div className="muted">
            Prefer a Collector chart here — same metrics as Grafana. Or paste a Grafana embed URL in
            edit mode.
          </div>
        </div>
      );
    }
    return (
      <div className="widgetInner flush">
        <iframe title="Grafana" src={url} className="grafanaFrame" />
      </div>
    );
  }

  return <div className="muted">Unknown widget</div>;
}
