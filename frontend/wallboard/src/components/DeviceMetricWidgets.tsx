import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useAuth } from "../auth/AuthContext";
import { getMetricInstant, getMetricRange, getMetricPresets } from "../api";
import type { MetricPreset, PromQueryResult, Site } from "../types";

const TIME_RANGES = [
  { hours: 1, label: "1h" },
  { hours: 6, label: "6h" },
  { hours: 24, label: "24h" },
  { hours: 168, label: "7d" }
] as const;

function parseMatrix(data: PromQueryResult, hours: number) {
  if (data.resultType !== "matrix" || !Array.isArray(data.result)) return [];
  const row = data.result[0] as { values?: [number, string][] } | undefined;
  if (!row?.values) return [];
  const fmt =
    hours >= 24
      ? { month: "short" as const, day: "numeric" as const, hour: "2-digit" as const }
      : { hour: "2-digit" as const, minute: "2-digit" as const };
  return row.values.map(([ts, val]) => ({
    ts,
    t: new Date(ts * 1000).toLocaleString([], fmt),
    v: Number(val)
  }));
}

function parseInstant(data: PromQueryResult): number | null {
  if (data.resultType !== "vector" || !Array.isArray(data.result)) return null;
  const row = data.result[0] as { value?: [number, string] } | undefined;
  const v = row?.value?.[1];
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function formatBitrate(value: number): { text: string; unitLabel: string } {
  if (!Number.isFinite(value)) return { text: "—", unitLabel: "" };
  if (Math.abs(value) >= 1_000_000) {
    return { text: (value / 1_000_000).toFixed(2), unitLabel: " Mbps" };
  }
  return { text: (value / 1000).toFixed(1), unitLabel: " Kbps" };
}

function formatMetricValue(value: number, unit?: string): string {
  if (!Number.isFinite(value)) return "—";
  if (unit === "bps") {
    const { text, unitLabel } = formatBitrate(value);
    return `${text}${unitLabel}`;
  }
  if (unit === "%") return `${value.toFixed(1)}%`;
  return `${value.toFixed(2)}${unit ?? ""}`;
}

function formatYAxis(value: number, unit?: string) {
  if (unit === "%") return `${Math.round(value)}%`;
  if (unit === "bps") {
    const { text, unitLabel } = formatBitrate(value);
    return `${text}${unitLabel.trim() ? unitLabel : ""}`;
  }
  return String(value);
}

function ChartTooltip({
  active,
  payload,
  unit
}: {
  active?: boolean;
  payload?: Array<{ payload?: { t: string; v: number } }>;
  unit?: string;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const { t, v } = payload[0].payload;
  return (
    <div className="chartTooltip">
      <div className="chartTooltipTime">{t}</div>
      <div className="chartTooltipValue">{formatMetricValue(v, unit)}</div>
    </div>
  );
}

function NoDeviceHint() {
  return (
    <div className="muted">
      No collector yet — open <Link to="/devices">Devices</Link> or a site page. Collectors are added
      automatically when they send data.
    </div>
  );
}

export function DeviceMetricChart({
  siteId,
  deviceId,
  metric,
  presets,
  title
}: {
  siteId: string;
  deviceId: string;
  metric: string;
  presets: MetricPreset[];
  title?: string;
}) {
  const { token } = useAuth();
  const [points, setPoints] = useState<Array<{ t: string; v: number; ts: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState<number>(1);
  const preset = presets.find((p) => p.id === metric);
  const customTitle = title?.trim();
  const label = customTitle || preset?.label || metric;
  const unit = preset?.unit ?? "";
  // Chrome already shows config.title — avoid stacking the same label again.
  const showInnerTitle = !customTitle;

  useEffect(() => {
    if (!token || !siteId || !deviceId || !metric) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await getMetricRange(token, { preset: metric, siteId, deviceId, hours });
        if (cancelled) return;
        setPoints(parseMatrix(res.data, hours));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Query failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, siteId, deviceId, metric, hours]);

  if (!siteId || !deviceId || !metric) {
    return <div className="muted">Configure site, device, and metric in edit mode.</div>;
  }
  if (!deviceId) return <NoDeviceHint />;
  if (error) {
    return (
      <div className="muted">
        {error}. Check Prometheus and device registration in <Link to="/sites">Sites</Link>.
      </div>
    );
  }

  return (
    <div className="metricChartWidget">
      <div className="metricChartHeader">
        {showInnerTitle ? <div className="widgetTitle">{label}</div> : <div />}
        <div className="timeRangePicker">
          {TIME_RANGES.map((r) => (
            <button
              key={r.hours}
              type="button"
              className={hours === r.hours ? "timeRangeBtn active" : "timeRangeBtn"}
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {loading && points.length === 0 ? (
        <div className="chartSkeleton" aria-hidden />
      ) : points.length === 0 ? (
        <div className="muted">No data yet for {label}</div>
      ) : (
        <div className="chartFlexFill">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points}>
              <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                width={40}
                tickFormatter={(v) => formatYAxis(v, unit)}
              />
              <Tooltip content={<ChartTooltip unit={unit} />} />
              <Area type="monotone" dataKey="v" stroke="#2dd4bf" fill="#2dd4bf33" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function DeviceMetricBar({
  siteId,
  deviceId,
  metric,
  presets,
  title
}: {
  siteId: string;
  deviceId: string;
  metric: string;
  presets: MetricPreset[];
  title?: string;
}) {
  const { token } = useAuth();
  const [points, setPoints] = useState<Array<{ t: string; v: number; ts: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState<number>(1);
  const preset = presets.find((p) => p.id === metric);
  const customTitle = title?.trim();
  const label = customTitle || preset?.label || metric;
  const unit = preset?.unit ?? "";
  const showInnerTitle = !customTitle;

  useEffect(() => {
    if (!token || !siteId || !deviceId || !metric) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await getMetricRange(token, { preset: metric, siteId, deviceId, hours });
        if (cancelled) return;
        setPoints(parseMatrix(res.data, hours));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Query failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, siteId, deviceId, metric, hours]);

  if (!siteId || !deviceId || !metric) {
    return <div className="muted">Configure site, device, and metric in settings (⚙).</div>;
  }
  if (!deviceId) return <NoDeviceHint />;
  if (error) {
    return (
      <div className="muted">
        {error}. Check device registration in <Link to="/sites">Sites</Link>.
      </div>
    );
  }

  return (
    <div className="metricChartWidget">
      <div className="metricChartHeader">
        {showInnerTitle ? <div className="widgetTitle">{label}</div> : <div />}
        <div className="timeRangePicker">
          {TIME_RANGES.map((r) => (
            <button
              key={r.hours}
              type="button"
              className={hours === r.hours ? "timeRangeBtn active" : "timeRangeBtn"}
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {loading && points.length === 0 ? (
        <div className="chartSkeleton" aria-hidden />
      ) : points.length === 0 ? (
        <div className="muted">No data yet for {label}</div>
      ) : (
        <div className="chartFlexFill">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points}>
              <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                width={40}
                tickFormatter={(v) => formatYAxis(v, unit)}
              />
              <Tooltip content={<ChartTooltip unit={unit} />} />
              <Bar dataKey="v" fill="#2dd4bf" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

const BOOLEAN_METRICS = new Set(["host_up", "snmp_up", "wan_dns", "wan_vps"]);

export function DeviceStatGauge({
  siteId,
  deviceId,
  metric,
  presets,
  siteName,
  title
}: {
  siteId: string;
  deviceId: string;
  metric: string;
  presets: MetricPreset[];
  siteName?: string;
  title?: string;
}) {
  const { token } = useAuth();
  const [value, setValue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const preset = presets.find((p) => p.id === metric);
  const unit = preset?.unit ?? "";
  const isBool = BOOLEAN_METRICS.has(metric);
  const customTitle = title?.trim();
  const displayTitle = customTitle || preset?.label || metric;
  // Chrome already shows config.title — show device/site name once, then UP/DOWN or %.
  const showInnerTitle = !customTitle;

  useEffect(() => {
    if (!token || !siteId || !metric) return;
    if (!isBool && !deviceId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await getMetricInstant(token, {
          preset: metric,
          siteId,
          deviceId: deviceId || "_"
        });
        if (cancelled) return;
        setValue(parseInstant(res.data));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Query failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, siteId, deviceId, metric, isBool]);

  if (!siteId || !metric) {
    return <div className="muted">Configure in settings (⚙).</div>;
  }
  if (!isBool && !deviceId) return <NoDeviceHint />;
  if (error) return <div className="muted">{error}</div>;

  if (isBool) {
    // Empty instant (silence) = DOWN — same 45s freshness as status API.
    const up = value != null && value >= 1;
    const tone = up ? "ok" : "bad";
    const label = up ? "UP" : "DOWN";
    const siteLabel = siteName ?? siteId;
    return (
      <div
        className={`signalCard signalCard--${tone} signalCardCompact`}
        title={up ? "Reachable" : value != null ? "Not reachable" : "No recent samples"}
      >
        {showInnerTitle ? <div className="signalCardEyebrow">{displayTitle}</div> : null}
        <div className="signalCardName">{siteLabel}</div>
        <div className="signalCardState">{label}</div>
      </div>
    );
  }

  const pct = value != null && unit === "%" ? Math.max(0, Math.min(100, value)) : null;
  const pieData =
    pct != null
      ? [
          { name: "used", value: Math.max(0, 100 - pct) },
          { name: "free", value: pct }
        ]
      : null;

  return (
    <div className="gaugeWidget">
      {showInnerTitle ? <div className="widgetTitle">{displayTitle}</div> : null}
      {loading && value == null ? (
        <div className="chartSkeleton gaugeSkeleton" aria-hidden />
      ) : (
        <>
          <div className="gaugeValue">
            {value != null ? formatMetricValue(value, unit) : "—"}
          </div>
          {pieData ? (
            <div className="pieWrap">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius="55%"
                    outerRadius="80%"
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                  >
                    <Cell fill="rgba(45, 212, 191, 0.85)" />
                    <Cell fill="rgba(148, 163, 184, 0.25)" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : pct != null ? (
            <div className="gaugeBar">
              <div className="gaugeFill" style={{ width: `${pct}%` }} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function DeviceDetailPanel({ site, deviceId }: { site: Site | undefined; deviceId: string }) {
  const device = useMemo(
    () => site?.devices?.find((d) => d.id === deviceId),
    [site, deviceId]
  );
  if (!site) {
    return <div className="muted">Pick a site in edit mode.</div>;
  }
  if (!deviceId || !device) {
    return <NoDeviceHint />;
  }
  return (
    <div className="kvList">
      <div>
        <strong>{device.name}</strong>
      </div>
      <div className="muted">{device.id}</div>
      <div>Kind: {device.kind}</div>
      <div>Type: {device.type}</div>
      {device.kind === "server" ? (
        <div>Host metric ID: {device.hostMetricId ?? device.id}</div>
      ) : (
        <div>SNMP IP: {device.snmpIp ?? "—"}</div>
      )}
      <div>Vendor: {device.vendor}</div>
      <div>Site: {site.name}</div>
    </div>
  );
}

export function useMetricPresets() {
  const { token } = useAuth();
  const [presets, setPresets] = useState<MetricPreset[]>([]);
  useEffect(() => {
    if (!token) return;
    getMetricPresets(token).then((r) => setPresets(r.presets));
  }, [token]);
  return presets;
}
