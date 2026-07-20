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

export const WIDGET_CATALOG: Array<{ type: WidgetType; label: string; defaultW: number; defaultH: number }> = [
  { type: "site_status_grid", label: "Site status grid", defaultW: 6, defaultH: 6 },
  { type: "alerts_table", label: "Active alerts", defaultW: 6, defaultH: 4 },
  { type: "top_devices", label: "Top devices", defaultW: 6, defaultH: 4 },
  { type: "mini_map", label: "Mini map", defaultW: 6, defaultH: 6 },
  { type: "website_summary", label: "Website summary", defaultW: 6, defaultH: 4 },
  { type: "site_card", label: "Single site card", defaultW: 4, defaultH: 4 },
  { type: "device_metric_chart", label: "Device metric chart", defaultW: 6, defaultH: 5 },
  { type: "device_stat_gauge", label: "Device stat gauge", defaultW: 3, defaultH: 4 },
  { type: "device_detail", label: "Device detail", defaultW: 4, defaultH: 4 },
  { type: "grafana_panel", label: "Grafana panel", defaultW: 6, defaultH: 6 }
];

export function WidgetBody({
  type,
  config,
  sites,
  statuses,
  alerts,
  devices,
  grafanaUrl
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
  const deviceId = config?.deviceId ?? site?.devices?.[0]?.id ?? "";
  const metric = config?.metric ?? "cpu_pct";

  if (type === "site_status_grid") {
    return (
      <div className="widgetInner">
        <div className="widgetTitle">Sites</div>
        <div className="statusGrid">
          {sites.map((s) => {
            const st = statuses.find((x) => x.siteId === s.id);
            return (
              <div key={s.id} className="statusTile">
                <div className="statusTileName">{s.name}</div>
                <StatusPill state={st?.overall ?? "unknown"} notes={st?.wan.notes} />
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
    for (const s of statuses) counts[s.websites.state] += 1;
    return (
      <div className="widgetInner">
        <div className="widgetTitle">Websites</div>
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
    return (
      <div className="widgetInner">
        <div className="widgetTitle">{cardSite?.name ?? cardSiteId ?? "Site"}</div>
        <div className="kvList">
          <div>WAN: {st?.wan.state ?? "unknown"}</div>
          <div>LAN: {st?.lan.state ?? "unknown"}</div>
          <div>Web: {st?.websites.state ?? "unknown"}</div>
        </div>
        <StatusPill state={st?.overall ?? "unknown"} notes={st?.wan.notes} />
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
        <div className="widgetTitle">Device</div>
        <DeviceDetailPanel site={site} deviceId={deviceId} />
      </div>
    );
  }

  if (type === "grafana_panel") {
    const src = config?.embedUrl || `${grafanaUrl}/`;
    return (
      <div className="widgetInner flush">
        <iframe title="grafana" src={src} className="grafanaFrame" />
      </div>
    );
  }

  return <div className="widgetInner muted">Unknown widget</div>;
}
