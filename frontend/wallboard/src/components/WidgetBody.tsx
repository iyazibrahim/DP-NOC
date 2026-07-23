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
import { localDevicesOf } from "../statusLabels";
import {
  CollectorStatusCard,
  LocalDevicesSignalBoard,
  SiteSignalBoard,
  SnmpDeviceStatusCard,
  UplinkStatusCard
} from "./StatusVisualWidgets";
import { WebsiteSummaryWidget } from "./WebsiteSummaryWidget";
import { AlertsIncidentsWidget } from "./AlertsIncidentsWidget";

export type WidgetCatalogEntry = {
  type: WidgetType;
  label: string;
  description?: string;
  defaultW: number;
  defaultH: number;
};

export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  { type: "site_status_grid", label: "Site health", defaultW: 4, defaultH: 6 },
  {
    type: "site_signal_board",
    label: "Sites signal board",
    description: "Collector + uplink LEDs",
    defaultW: 6,
    defaultH: 5
  },
  {
    type: "local_devices_board",
    label: "Local devices (SNMP)",
    description: "Firewall/switch LEDs",
    defaultW: 6,
    defaultH: 5
  },
  {
    type: "snmp_device_status",
    label: "SNMP device",
    description: "One device UP/DOWN",
    defaultW: 3,
    defaultH: 3
  },
  {
    type: "uplink_status",
    label: "Uplink",
    description: "Site internet UP/DOWN",
    defaultW: 3,
    defaultH: 3
  },
  {
    type: "collector_status",
    label: "Collector",
    description: "Collector UP/DOWN",
    defaultW: 3,
    defaultH: 3
  },
  { type: "alerts_table", label: "Alerts", defaultW: 6, defaultH: 4 },
  { type: "top_devices", label: "Top devices", defaultW: 6, defaultH: 4 },
  { type: "mini_map", label: "Map", defaultW: 6, defaultH: 6 },
  { type: "website_summary", label: "Website checks", defaultW: 4, defaultH: 3 },
  { type: "site_card", label: "Site card", defaultW: 4, defaultH: 3 },
  {
    type: "device_metric_chart",
    label: "Line chart",
    description: "CPU / SNMP traffic",
    defaultW: 6,
    defaultH: 4
  },
  {
    type: "device_metric_bar",
    label: "Bar chart",
    description: "Same metrics as bars",
    defaultW: 6,
    defaultH: 4
  },
  {
    type: "device_stat_gauge",
    label: "Gauge / online",
    description: "% or UP-DOWN",
    defaultW: 3,
    defaultH: 3
  },
  {
    type: "grafana_panel",
    label: "Grafana panel",
    description: "Embed a panel",
    defaultW: 6,
    defaultH: 5
  },
  {
    type: "device_detail",
    label: "Device info",
    description: "Name and IDs",
    defaultW: 4,
    defaultH: 3
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
  alerts: _alerts,
  devices,
  grafanaUrl: _grafanaUrl,
  compact = false
}: {
  type: WidgetType;
  config?: Record<string, string>;
  sites: Site[];
  statuses: SiteStatus[];
  alerts: ActiveAlert[];
  devices: DeviceRow[];
  grafanaUrl: string;
  compact?: boolean;
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
            return (
              <div key={s.id} className="statusTile">
                <div className="statusTileName">{s.name}</div>
                <StatusPill state={row?.overall ?? "unknown"} />
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
        <SiteSignalBoard sites={sites} statuses={statuses} compact={compact} />
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
          compact={compact}
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
          compact={compact}
        />
      </div>
    );
  }

  if (type === "uplink_status") {
    return (
      <div className="widgetInner flush">
        <UplinkStatusCard site={site} status={st} title={config?.title} compact={compact} />
      </div>
    );
  }

  if (type === "collector_status") {
    return (
      <div className="widgetInner flush">
        <CollectorStatusCard site={site} status={st} title={config?.title} compact={compact} />
      </div>
    );
  }

  if (type === "alerts_table") {
    return <AlertsIncidentsWidget compact={compact} />;
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
    return <WebsiteSummaryWidget compact={compact} />;
  }

  if (type === "site_card") {
    const loc = localDevicesOf(st);
    return (
      <div className="widgetInner">
        <div className="widgetTitle">{site?.name ?? siteId ?? "Site"}</div>
        <StatusPill state={st?.overall ?? "unknown"} />
        <div className="kvList">
          <div className={`dotLine dotLine--${loc.state}`}>Local devices: {loc.state}</div>
          <div>Website checks: {st?.websites.state ?? "unknown"}</div>
        </div>
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
