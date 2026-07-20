import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useAuth } from "../auth/AuthContext";
import { getMetricInstant, getMetricRange, getMetricPresets } from "../api";
import type { MetricPreset, PromQueryResult, Site } from "../types";

function parseMatrix(data: PromQueryResult) {
  if (data.resultType !== "matrix" || !Array.isArray(data.result)) return [];
  const row = data.result[0] as { values?: [number, string][] } | undefined;
  if (!row?.values) return [];
  return row.values.map(([ts, val]) => ({
    t: new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
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

export function DeviceMetricChart({
  siteId,
  deviceId,
  metric,
  presets
}: {
  siteId: string;
  deviceId: string;
  metric: string;
  presets: MetricPreset[];
}) {
  const { token } = useAuth();
  const [points, setPoints] = useState<Array<{ t: string; v: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const label = presets.find((p) => p.id === metric)?.label ?? metric;

  useEffect(() => {
    if (!token || !siteId || !deviceId || !metric) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getMetricRange(token, { preset: metric, siteId, deviceId, hours: 1 });
        if (cancelled) return;
        setPoints(parseMatrix(res.data));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Query failed");
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, siteId, deviceId, metric]);

  if (!siteId || !deviceId || !metric) {
    return <div className="muted">Configure site, device, and metric in edit mode.</div>;
  }
  if (error) return <div className="muted">{error}</div>;
  if (points.length === 0) return <div className="muted">No data yet for {label}</div>;

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 140 }}>
      <div className="widgetTitle">{label}</div>
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={points}>
          <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} width={36} />
          <Tooltip contentStyle={{ background: "#111827", border: "1px solid #334155" }} />
          <Area type="monotone" dataKey="v" stroke="#f59e0b" fill="#f59e0b33" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DeviceStatGauge({
  siteId,
  deviceId,
  metric,
  presets
}: {
  siteId: string;
  deviceId: string;
  metric: string;
  presets: MetricPreset[];
}) {
  const { token } = useAuth();
  const [value, setValue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preset = presets.find((p) => p.id === metric);
  const unit = preset?.unit ?? "";

  useEffect(() => {
    if (!token || !siteId || !deviceId || !metric) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getMetricInstant(token, { preset: metric, siteId, deviceId });
        if (cancelled) return;
        setValue(parseInstant(res.data));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Query failed");
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, siteId, deviceId, metric]);

  if (!siteId || !deviceId || !metric) {
    return <div className="muted">Configure site, device, and metric in edit mode.</div>;
  }
  if (error) return <div className="muted">{error}</div>;

  const pct = value != null && unit === "%" ? Math.max(0, Math.min(100, value)) : null;

  return (
    <div className="gaugeWidget">
      <div className="widgetTitle">{preset?.label ?? metric}</div>
      <div className="gaugeValue">
        {value != null ? `${value.toFixed(1)}${unit}` : "—"}
      </div>
      {pct != null ? (
        <div className="gaugeBar">
          <div className="gaugeFill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function DeviceDetailPanel({ site, deviceId }: { site: Site | undefined; deviceId: string }) {
  const device = useMemo(
    () => site?.devices?.find((d) => d.id === deviceId),
    [site, deviceId]
  );
  if (!site || !device) {
    return <div className="muted">Pick a site and device in edit mode.</div>;
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
