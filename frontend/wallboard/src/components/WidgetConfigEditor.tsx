import type { DashboardWidget, MetricPreset, Site } from "../types";

function TitleField({
  config,
  onChange,
  placeholder
}: {
  config: Record<string, string>;
  onChange: (config: Record<string, string>) => void;
  placeholder?: string;
}) {
  return (
    <>
      <label className="label">Widget name</label>
      <input
        value={config.title ?? ""}
        onChange={(e) => onChange({ ...config, title: e.target.value })}
        placeholder={placeholder ?? "e.g. DP Nuc Disk Free"}
      />
      <p className="muted fieldHint">Shown on the widget chrome. Leave blank for the default name.</p>
    </>
  );
}

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
    widget.type === "device_metric_bar" ||
    widget.type === "device_stat_gauge" ||
    widget.type === "device_detail";

  if (
    widget.type === "site_card" ||
    widget.type === "uplink_status" ||
    widget.type === "collector_status"
  ) {
    return (
      <div className="widgetConfig">
        <TitleField
          config={config}
          onChange={onChange}
          placeholder={
            widget.type === "uplink_status" ? "e.g. DP Office Uplink" : "e.g. DP Office Collector"
          }
        />
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

  if (widget.type === "local_devices_board") {
    return (
      <div className="widgetConfig">
        <TitleField
          config={config}
          onChange={onChange}
          placeholder="e.g. All LAN gear"
        />
        <label className="label">Site filter</label>
        <select
          value={config.siteId ?? ""}
          onChange={(e) => onChange({ ...config, siteId: e.target.value })}
        >
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="muted fieldHint">Leave as All sites to show every network device.</p>
      </div>
    );
  }

  if (widget.type === "snmp_device_status") {
    const networkDevices = devices.filter((d) => (d.kind ?? "network") !== "server");
    return (
      <div className="widgetConfig">
        <TitleField config={config} onChange={onChange} placeholder="e.g. DP Firewall" />
        <label className="label">Site</label>
        <select
          value={siteId}
          onChange={(e) => {
            const nextSite = sites.find((s) => s.id === e.target.value);
            const firstNet =
              nextSite?.devices?.find((d) => (d.kind ?? "network") !== "server")?.id ?? "";
            onChange({ ...config, siteId: e.target.value, deviceId: firstNet });
          }}
        >
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="label">SNMP device</label>
        <select
          value={deviceId}
          onChange={(e) => onChange({ ...config, siteId, deviceId: e.target.value })}
        >
          {networkDevices.length === 0 ? (
            <option value="">No SNMP devices on this site</option>
          ) : (
            networkDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.snmpIp ? ` (${d.snmpIp})` : ""}
              </option>
            ))
          )}
        </select>
      </div>
    );
  }

  if (widget.type === "grafana_panel") {
    const base = grafanaUrl.replace(/\/$/, "");
    return (
      <div className="widgetConfig">
        <TitleField config={config} onChange={onChange} placeholder="e.g. Grafana CPU panel" />
        <p className="muted widgetConfigHint">
          Optional. Prefer native Collector charts unless you need a specific Grafana panel.
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
      !deviceId ||
      p.id === "wan_dns" ||
      p.id === "wan_vps"
  );

  return (
    <div className="widgetConfig">
      <TitleField
        config={config}
        onChange={onChange}
        placeholder={
          widget.type === "device_metric_chart"
            ? "e.g. DP Nuc CPU Usage"
            : widget.type === "device_stat_gauge"
              ? "e.g. DP Nuc Disk Free"
              : "e.g. Custom widget name"
        }
      />
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
      <label className="label">Collector / SNMP device</label>
      <select
        value={deviceId}
        onChange={(e) => onChange({ ...config, siteId, deviceId: e.target.value })}
      >
        {devices.length === 0 ? (
          <option value="">No devices yet</option>
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
                {d.kind === "server" ? " (collector)" : " (SNMP)"}
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
          <p className="muted fieldHint">
            For SNMP gear pick “Local device online”, “Interface traffic in/out”. For collectors use
            CPU / memory / disk.
          </p>
        </>
      ) : null}
    </div>
  );
}
