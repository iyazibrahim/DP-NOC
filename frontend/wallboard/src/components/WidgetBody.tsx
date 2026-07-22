import type { ActiveAlert, DeviceRow, Site, SiteStatus, WidgetType } from "../types";
import { StatusPill } from "./StatusPill";
import { SitesLeafletMap } from "./SitesLeafletMap";
import { TopDevicesTable } from "./TopDevicesTable";
import {
  DeviceDetailPanel,
  DeviceMetricBar,
  DeviceMetricChart,
  DeviceStatGauge,
  useMetricPresets
} from "./DeviceMetricWidgets";
import { collectorOf, localDevicesOf, uplinkOf } from "../statusLabels";
import {
  CollectorStatusCard,
  LocalDevicesSignalBoard,
  SiteSignalBoard,
  SnmpDeviceStatusCard,
  UplinkStatusCard
} from "./StatusVisualWidgets";

export type WidgetCatalogEntry = {
  type: WidgetType;
  label: string;
  description?: string;
  defaultW: number;
  defaultH: number;
};

export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  { type: "site_status_grid", label: "Site health overview", defaultW: 4, defaultH: 8 },
  { type: "site_signal_board", label: "Sites signal board", description: "Green/red LEDs for collector + uplink", defaultW: 6, defaultH: 7 },
  {
    type: "local_devices_board",
    label: "Local devices board (SNMP)",
    description: "LED board — every firewall/switch SNMP up/down",
    defaultW: 6,
    defaultH: 7
  },
  {
    type: "snmp_device_status",
    label: "SNMP device status",
    description: "Big UP/DOWN for one firewall or switch",
    defaultW: 3,
    defaultH: 4
  },
  { type: "uplink_status", label: "Uplink status", description: "Big UP/DOWN for one site’s internet", defaultW: 3, defaultH: 4 },
  { type: "collector_status", label: "Collector status", description: "Big UP/DOWN for one site’s collector", defaultW: 3, defaultH: 4 },
  { type: "alerts_table", label: "Active alerts", defaultW: 6, defaultH: 4 },
  { type: "top_devices", label: "Top devices", defaultW: 6, defaultH: 4 },
  { type: "mini_map", label: "Map", defaultW: 6, defaultH: 6 },
  { type: "website_summary", label: "Website checks summary", defaultW: 4, defaultH: 4 },
  { type: "site_card", label: "Single site card", defaultW: 4, defaultH: 4 },
  {
    type: "device_metric_chart",
    label: "Device line chart",
    description: "CPU/mem/disk (collector) or SNMP traffic / online",
    defaultW: 6,
    defaultH: 5
  },
  {
    type: "device_metric_bar",
    label: "Device bar chart",
    description: "Same metrics as bars — works for SNMP traffic too",
    defaultW: 6,
    defaultH: 5
  },
  {
    type: "device_stat_gauge",
    label: "Device gauge / online",
    description: "Percent gauge or SNMP/collector UP-DOWN",
    defaultW: 3,
    defaultH: 4
  },
  {
    type: "grafana_panel",
    label: "Grafana panel",
    description: "Optional deep-dive chart",
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
    label: "Status",
    widgets: WIDGET_CATALOG.filter((w) =>
      [
        "site_status_grid",
        "site_signal_board",
        "uplink_status",
        "collector_status",
        "site_card",
        "alerts_table",
        "website_summary"
      ].includes(w.type)
    )
  },
  {
    label: "SNMP / local devices",
    widgets: WIDGET_CATALOG.filter((w) =>
      ["local_devices_board", "snmp_device_status"].includes(w.type)
    )
  },
  {
    label: "Charts",
    widgets: WIDGET_CATALOG.filter((w) =>
      ["device_metric_chart", "device_metric_bar", "device_stat_gauge", "grafana_panel"].includes(w.type)
    )
  },
  {
    label: "Places & inventory",
    widgets: WIDGET_CATALOG.filter((w) =>
      ["mini_map", "top_devices", "device_detail"].includes(w.type)
    )
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
  const st = statuses.find((x) => x.siteId === siteId);

  if (type === "site_status_grid") {
    return (
      <div className="widgetInner widgetInnerScroll">
        <div className="widgetTitle">Sites</div>
        <div className="statusGrid statusGridList">
          {sites.map((s) => {
            const row = statuses.find((x) => x.siteId === s.id);
            const col = collectorOf(row);
            const up = uplinkOf(row);
            return (
              <div key={s.id} className="statusTile">
                <div className="statusTileName">{s.name}</div>
                <StatusPill state={row?.overall ?? "unknown"} notes={col.notes ?? up.notes} />
                <div className="statusTileMeta">
                  <span className={`dotLine dotLine--${col.state}`}>Collector: {col.state}</span>
                  <span className={`dotLine dotLine--${up.state}`}>Uplink: {up.state}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (type === "site_signal_board") {
    return (
      <div className="widgetInner widgetInnerScroll">
        <SiteSignalBoard sites={sites} statuses={statuses} />
      </div>
    );
  }

  if (type === "local_devices_board") {
    return (
      <div className="widgetInner widgetInnerScroll">
        <LocalDevicesSignalBoard
          sites={sites}
          statuses={statuses}
          siteId={config?.siteId || undefined}
          title={config?.title}
        />
      </div>
    );
  }

  if (type === "snmp_device_status") {
    return (
      <div className="widgetInner flush">
        <SnmpDeviceStatusCard
          site={site}
          status={st}
          deviceId={config?.deviceId}
          title={config?.title}
        />
      </div>
    );
  }

  if (type === "uplink_status") {
    return (
      <div className="widgetInner flush">
        <UplinkStatusCard site={site} status={st} title={config?.title} />
      </div>
    );
  }

  if (type === "collector_status") {
    return (
      <div className="widgetInner flush">
        <CollectorStatusCard site={site} status={st} title={config?.title} />
      </div>
    );
  }

  if (type === "alerts_table") {
    const firing = alerts.filter((a) => a.status === "firing").slice(0, 20);
    return (
      <div className="widgetInner widgetInnerScroll">
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
      <div className="widgetInner flush widgetInnerScroll">
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
    for (const row of statuses) {
      const n = row.websiteTargetCount ?? 0;
      if (n <= 0) continue;
      counts[row.websites.state] += n;
    }
    return (
      <div className="widgetInner">
        <div className="widgetTitle">Website checks</div>
        <div className="kvList">
          <div className="dotLine dotLine--healthy">Healthy: {counts.healthy}</div>
          <div className="dotLine dotLine--warning">Warning: {counts.warning}</div>
          <div className="dotLine dotLine--critical">Critical: {counts.critical}</div>
          <div className="dotLine dotLine--unknown">Unknown: {counts.unknown}</div>
        </div>
      </div>
    );
  }

  if (type === "site_card") {
    const col = collectorOf(st);
    const up = uplinkOf(st);
    const loc = localDevicesOf(st);
    return (
      <div className="widgetInner">
        <div className="widgetTitle">{site?.name ?? siteId ?? "Site"}</div>
        <div className="kvList">
          <div className={`dotLine dotLine--${col.state}`}>Collector: {col.state}</div>
          <div className={`dotLine dotLine--${up.state}`}>Uplink: {up.state}</div>
          <div className={`dotLine dotLine--${loc.state}`}>Local devices: {loc.state}</div>
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
          title={config?.title}
        />
      </div>
    );
  }

  if (type === "device_metric_bar") {
    return (
      <div className="widgetInner">
        <DeviceMetricBar
          siteId={siteId}
          deviceId={deviceId}
          metric={metric}
          presets={presets}
          title={config?.title}
        />
      </div>
    );
  }

  if (type === "device_stat_gauge") {
    return (
      <div className="widgetInner">
        <DeviceStatGauge
          siteId={siteId}
          deviceId={deviceId}
          metric={metric}
          presets={presets}
          siteName={site?.name}
          title={config?.title}
        />
      </div>
    );
  }

  if (type === "device_detail") {
    return (
      <div className="widgetInner widgetInnerScroll">
        <div className="widgetTitle">{config?.title?.trim() || "Device info"}</div>
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
            settings (⚙).
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
