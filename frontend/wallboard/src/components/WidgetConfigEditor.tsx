import type { DashboardWidget, MetricPreset, Site, SiteDevice } from "../types";
import { WIDGET_COLORS } from "../widgetColors";

const TYPE_LABEL: Record<string, string> = {
  ap: "Access point",
  accesspoint: "Access point",
  wifi: "Access point",
  wireless: "Access point",
  firewall: "Firewall",
  switch: "Switch",
  nas: "NAS",
  storage: "NAS",
  router: "Router",
  server: "Collector"
};

function deviceTypeKey(type: string | undefined): string {
  const t = (type ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (t === "ap" || t === "accesspoint" || t === "wifi" || t === "wireless") return "ap";
  if (t === "nas" || t === "storage") return "nas";
  return t;
}

function deviceOptionLabel(d: SiteDevice): string {
  const kind =
    d.kind === "server" ? "Collector" : TYPE_LABEL[deviceTypeKey(d.type)] || d.type || "Device";
  return `${d.name} · ${kind}`;
}

const METRIC_GROUPS: Array<{ id: NonNullable<MetricPreset["group"]>; label: string }> = [
  { id: "health", label: "Health" },
  { id: "traffic", label: "Traffic" },
  { id: "ports", label: "Ports" },
  { id: "storage", label: "Storage" },
  { id: "signal", label: "Signal" }
];

function MetricCatalog({
  presets,
  selected,
  onPick
}: {
  presets: MetricPreset[];
  selected: string[];
  onPick: (id: string) => void;
}) {
  if (presets.length === 0) return <p className="muted">No metrics for this device.</p>;
  return (
    <div className="metricCatalog">
      {METRIC_GROUPS.map((group) => {
        const items = presets.filter((p) => (p.group ?? "health") === group.id);
        if (items.length === 0) return null;
        return (
          <div key={group.id} className="metricGroup">
            <div className="metricGroupLabel">{group.label}</div>
            {items.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={on ? "metricChoice on" : "metricChoice"}
                  onClick={() => onPick(p.id)}
                >
                  <span className="metricChoiceLabel">{p.label}</span>
                  {p.unit ? <span className="metricChoiceUnit">{p.unit}</span> : null}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ColorField({
  config,
  onChange
}: {
  config: Record<string, string>;
  onChange: (config: Record<string, string>) => void;
}) {
  const current = config.color || "teal";
  return (
    <>
      <label className="label">Color</label>
      <div className="colorSwatches">
        {WIDGET_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.label}
            className={current === c.id ? "colorSwatch on" : "colorSwatch"}
            style={{ background: c.hex }}
            onClick={() => onChange({ ...config, color: c.id })}
          />
        ))}
      </div>
    </>
  );
}

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

function CompactField({
  config,
  onChange
}: {
  config: Record<string, string>;
  onChange: (config: Record<string, string>) => void;
}) {
  return (
    <label className="checkRow">
      <input
        type="checkbox"
        checked={config.compact === "1"}
        onChange={(e) =>
          onChange({
            ...config,
            compact: e.target.checked ? "1" : "0"
          })
        }
      />
      Compact this widget
    </label>
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
    widget.type === "device_health" ||
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
        {widget.type !== "site_card" ? <CompactField config={config} onChange={onChange} /> : null}
      </div>
    );
  }

  if (widget.type === "local_devices_board") {
    const view = config.view || "list";
    const selected = new Set(
      (config.deviceIds ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    const networkDevices = devices.filter((d) => (d.kind ?? "network") !== "server");
    const aps = devices.filter((d) => deviceTypeKey(d.type) === "ap" && d.kind !== "server");
    const pool = view === "cluster" ? aps : networkDevices;
    function toggleDevice(id: string) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange({ ...config, siteId, deviceIds: [...next].join(",") });
    }
    return (
      <div className="widgetConfig">
        <TitleField config={config} onChange={onChange} placeholder="e.g. Office gear" />
        <label className="label">Show as</label>
        <div className="metricCatalog">
          {(
            [
              ["list", "List"],
              ["stack", "Stack"],
              ["card", "Card"],
              ["cluster", "AP cluster"]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={view === id ? "metricChoice on" : "metricChoice"}
              onClick={() => onChange({ ...config, view: id })}
            >
              <span className="metricChoiceLabel">{label}</span>
            </button>
          ))}
        </div>
        <label className="label">Site</label>
        <select
          value={view === "list" ? (config.siteId ?? "") : siteId}
          onChange={(e) => {
            const nextSite = sites.find((s) => s.id === e.target.value);
            const firstNet =
              nextSite?.devices?.find((d) => (d.kind ?? "network") !== "server")?.id ?? "";
            onChange({ ...config, siteId: e.target.value, deviceId: firstNet, deviceIds: "" });
          }}
        >
          {view === "list" ? <option value="">All sites</option> : null}
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {view === "card" ? (
          <>
            <label className="label">Device</label>
            <select
              value={config.deviceId ?? networkDevices[0]?.id ?? ""}
              onChange={(e) => onChange({ ...config, siteId, deviceId: e.target.value })}
            >
              {networkDevices.length === 0 ? (
                <option value="">No SNMP devices on this site</option>
              ) : (
                networkDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {deviceOptionLabel(d)}
                  </option>
                ))
              )}
            </select>
          </>
        ) : null}
        {view === "stack" || view === "cluster" ? (
          <>
            <label className="label">{view === "cluster" ? "Access points" : "Devices"}</label>
            <p className="muted fieldHint">
              {view === "cluster"
                ? "Leave empty to include every access point on this site."
                : "Leave empty to include every SNMP device in the site filter."}
            </p>
            <div className="deviceStackPicker">
              {pool.length === 0 ? (
                <p className="muted">Nothing to pick on this site.</p>
              ) : (
                pool.map((d) => (
                  <label key={d.id} className="deviceStackPickerRow">
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleDevice(d.id)} />
                    <span>{deviceOptionLabel(d)}</span>
                  </label>
                ))
              )}
            </div>
          </>
        ) : null}
        {view === "cluster" ? <ColorField config={config} onChange={onChange} /> : null}
        <CompactField config={config} onChange={onChange} />
      </div>
    );
  }

  if (widget.type === "site_signal_board") {
    return (
      <div className="widgetConfig">
        <CompactField config={config} onChange={onChange} />
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
        <CompactField config={config} onChange={onChange} />
      </div>
    );
  }

  if (widget.type === "device_stack") {
    const selected = new Set(
      (config.deviceIds ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    const pool = (siteId ? sites.filter((s) => s.id === siteId) : sites).flatMap((s) =>
      (s.devices ?? [])
        .filter((d) => (d.kind ?? "network") !== "server")
        .map((d) => ({ ...d, siteName: s.name, siteId: s.id }))
    );
    function toggleDevice(id: string) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange({ ...config, siteId, deviceIds: [...next].join(",") });
    }
    return (
      <div className="widgetConfig">
        <TitleField config={config} onChange={onChange} placeholder="e.g. Library APs" />
        <label className="label">Site filter (optional)</label>
        <select
          value={siteId}
          onChange={(e) => onChange({ ...config, siteId: e.target.value, deviceIds: "" })}
        >
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="label">Devices in stack</label>
        <div className="deviceStackPicker">
          {pool.length === 0 ? (
            <p className="muted">No SNMP devices to pick.</p>
          ) : (
            pool.map((d) => (
              <label key={`${d.siteId}-${d.id}`} className="deviceStackPickerRow">
                <input
                  type="checkbox"
                  checked={selected.has(d.id)}
                  onChange={() => toggleDevice(d.id)}
                />
                <span>
                  {d.name}
                  {d.type ? ` · ${d.type}` : ""}
                  {!siteId ? ` · ${d.siteName}` : ""}
                  {d.snmpIp ? ` (${d.snmpIp})` : ""}
                </span>
              </label>
            ))
          )}
        </div>
        <CompactField config={config} onChange={onChange} />
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

  if (
    widget.type === "net_line_use" ||
    widget.type === "net_bandwidth" ||
    widget.type === "net_speedtest" ||
    widget.type === "net_ap_traffic"
  ) {
    return (
      <div className="widgetConfig">
        <TitleField config={config} onChange={onChange} />
        <label className="label">Site</label>
        <select value={siteId} onChange={(e) => onChange({ ...config, siteId: e.target.value })}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (widget.type === "ap_cluster") {
    const selected = new Set(
      (config.deviceIds ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    const aps = devices.filter((d) => deviceTypeKey(d.type) === "ap" && d.kind !== "server");
    function toggleAp(id: string) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange({ ...config, siteId, deviceIds: [...next].join(",") });
    }
    return (
      <div className="widgetConfig">
        <TitleField config={config} onChange={onChange} placeholder="e.g. DP office Wi-Fi" />
        <label className="label">Site</label>
        <select
          value={siteId}
          onChange={(e) => onChange({ ...config, siteId: e.target.value, deviceIds: "" })}
        >
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="label">Access points</label>
        <p className="muted fieldHint">Leave empty to include every access point on this site.</p>
        <div className="deviceStackPicker">
          {aps.length === 0 ? (
            <p className="muted">No access points on this site.</p>
          ) : (
            aps.map((d) => (
              <label key={d.id} className="deviceStackPickerRow">
                <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleAp(d.id)} />
                <span>{d.name}</span>
              </label>
            ))
          )}
        </div>
        <ColorField config={config} onChange={onChange} />
      </div>
    );
  }

  if (!needsDevicePicker) return null;

  const selectedDevice = devices.find((d) => d.id === deviceId);

  function normalizeVendor(v: string | undefined) {
    return (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function presetMatchesDevice(p: MetricPreset) {
    if (p.kind === "any") return false;
    if (!selectedDevice) return false;
    const deviceKind = selectedDevice.kind ?? "network";
    if (p.kind !== deviceKind) return false;
    if (deviceKind === "server") return true;
    if (p.deviceTypes?.length) {
      const dtype = deviceTypeKey(selectedDevice.type);
      if (!p.deviceTypes.some((t) => deviceTypeKey(t) === dtype)) return false;
    }
    if (p.vendors?.length) {
      const v = normalizeVendor(selectedDevice.vendor);
      // Firewall Fortinet pack: also allow empty/generic vendor on firewall type
      const allowEmptyFw =
        p.deviceTypes?.includes("firewall") &&
        (v === "" || v === "generic") &&
        p.vendors.some((x) => ["fortinet", "fortigate"].includes(normalizeVendor(x)));
      const allowEmptyNas =
        p.deviceTypes?.includes("nas") &&
        (v === "" || v === "generic") &&
        p.vendors.some((x) => ["synology", "syno"].includes(normalizeVendor(x)));
      if (
        !allowEmptyFw &&
        !allowEmptyNas &&
        !p.vendors.some((x) => normalizeVendor(x) === v || v.includes(normalizeVendor(x)))
      ) {
        return false;
      }
    }
    return true;
  }

  const filteredPresets = presets.filter(presetMatchesDevice);
  const showMetric = widget.type !== "device_detail" && widget.type !== "device_health";
  const selectedStats = (config.stats ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

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
              : widget.type === "device_health"
                ? "e.g. DP Firewall"
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
      <label className="label">Device</label>
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
              if (as !== bs) return as - bs;
              return a.name.localeCompare(b.name);
            })
            .map((d) => (
              <option key={d.id} value={d.id}>
                {deviceOptionLabel(d)}
              </option>
            ))
        )}
      </select>
      {showMetric ? (
        <>
          <label className="label">Metric</label>
          <MetricCatalog
            presets={filteredPresets}
            selected={[metric]}
            onPick={(id) => onChange({ ...config, siteId, deviceId, metric: id })}
          />
        </>
      ) : null}
      {widget.type === "device_health" ? (
        <>
          <label className="label">Stats</label>
          <p className="muted fieldHint">Leave none selected to keep this device’s default three stats.</p>
          <MetricCatalog
            presets={filteredPresets}
            selected={selectedStats}
            onPick={(id) => {
              const next = new Set(selectedStats);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              onChange({ ...config, siteId, deviceId, stats: [...next].join(",") });
            }}
          />
        </>
      ) : null}
      {widget.type === "device_metric_chart" ||
      widget.type === "device_metric_bar" ||
      widget.type === "device_stat_gauge" ||
      widget.type === "device_health" ? (
        <ColorField config={config} onChange={onChange} />
      ) : null}
    </div>
  );
}
