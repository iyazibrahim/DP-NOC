import type { DashboardWidget, MetricPreset, Site } from "../types";

export function WidgetConfigEditor({
  widget,
  sites,
  presets,
  grafanaUrl,
  onChange
}: {
  widget: DashboardWidget;
  sites: Site[];
  presets: MetricPreset[];
  grafanaUrl: string;
  onChange: (config: Record<string, string>) => void;
}) {
  const config = widget.config ?? {};
  const siteId = config.siteId ?? sites[0]?.id ?? "";
  const site = sites.find((s) => s.id === siteId);
  const devices = site?.devices ?? [];
  const deviceId = config.deviceId ?? devices[0]?.id ?? "";
  const metric = config.metric ?? presets[0]?.id ?? "cpu_pct";

  const needsDevicePicker =
    widget.type === "device_metric_chart" ||
    widget.type === "device_stat_gauge" ||
    widget.type === "device_detail";

  if (widget.type === "site_card") {
    return (
      <div className="widgetConfig">
        <label className="label">Site</label>
        <select
          value={config.siteId ?? siteId}
          onChange={(e) => onChange({ ...config, siteId: e.target.value })}
        >
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (widget.type === "grafana_panel") {
    const base = grafanaUrl.replace(/\/$/, "");
    return (
      <div className="widgetConfig">
        <p className="muted widgetConfigHint">
          Optional. This app and Grafana both read the same metrics. Prefer a Collector chart unless
          you need a specific Grafana panel.
        </p>
        <label className="label">Embed URL</label>
        <input
          value={config.embedUrl ?? `${base}/`}
          onChange={(e) => onChange({ ...config, embedUrl: e.target.value })}
          placeholder={`${base}/d/uid/dashboard?orgId=1&viewPanel=1`}
        />
      </div>
    );
  }

  if (!needsDevicePicker) return null;

  const filteredPresets = presets.filter(
    (p) =>
      p.kind === "any" ||
      devices.find((d) => d.id === deviceId)?.kind === p.kind ||
      !deviceId
  );

  return (
    <div className="widgetConfig">
      <label className="label">Site</label>
      <select
        value={siteId}
        onChange={(e) =>
          onChange({
            ...config,
            siteId: e.target.value,
            deviceId: sites.find((s) => s.id === e.target.value)?.devices?.[0]?.id ?? ""
          })
        }
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <label className="label">Collector / device</label>
      <select
        value={deviceId}
        onChange={(e) => onChange({ ...config, siteId, deviceId: e.target.value })}
      >
        {devices.length === 0 ? (
          <option value="">No collectors yet — wait for auto-add or open Devices</option>
        ) : (
          [...devices]
            .sort((a, b) => {
              const as = (a.kind ?? "") === "server" ? 0 : 1;
              const bs = (b.kind ?? "") === "server" ? 0 : 1;
              return as - bs;
            })
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.kind === "server" ? " (collector)" : " (local)"}
              </option>
            ))
        )}
      </select>
      {widget.type !== "device_detail" ? (
        <>
          <label className="label">Metric</label>
          <select
            value={metric}
            onChange={(e) => onChange({ ...config, siteId, deviceId, metric: e.target.value })}
          >
            {filteredPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}
