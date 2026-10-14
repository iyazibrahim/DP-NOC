import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  getSiteNetwork,
  getSiteNetworkLayout,
  resetSiteNetworkLayout,
  saveSiteNetworkLayout,
  STATUS_POLL_MS,
  type SiteNetworkSummary
} from "@/api";
import type { Site, SiteNetworkLayout, SiteNetworkWidget, SiteNetworkWidgetType } from "@/types";
import { StatusPill } from "@/components/StatusPill";
import { MetricChartFrame, darkTooltipProps } from "@/components/noc/MetricChart";
import { RangeToggle } from "@/components/noc/RangeToggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Gauge, Users, Wifi } from "lucide-react";

type ChartRange = "1h" | "24h" | "7d" | "30d";

const PIE_COLORS = ["#00b5e2", "#f5c400", "#34d399", "#a78bfa", "#f87171", "#60a5fa", "#fb923c", "#2dd4bf"];

const WIDGET_CATALOG: Array<{
  type: SiteNetworkWidgetType;
  label: string;
  section: "status" | "traffic" | "wireless";
  description: string;
  w: number;
  h: number;
}> = [
  { type: "kpi_strip", label: "Status chips", section: "status", description: "Live link and speed", w: 12, h: 2 },
  { type: "wan_status", label: "Line note", section: "status", description: "Which pipe is tagged", w: 12, h: 1 },
  {
    type: "wan_util_summary",
    label: "Line use",
    section: "traffic",
    description: "Today / 7 days / 30 days",
    w: 4,
    h: 4
  },
  {
    type: "wan_bandwidth_chart",
    label: "Download / upload",
    section: "traffic",
    description: "Traffic over time",
    w: 8,
    h: 5
  },
  { type: "speedtest_chart", label: "Speed test", section: "traffic", description: "ISP speed history", w: 12, h: 5 },
  { type: "ap_clients_bar", label: "Clients by AP", section: "wireless", description: "Bar chart", w: 6, h: 5 },
  { type: "ap_clients_pie", label: "Client share", section: "wireless", description: "Pie chart", w: 6, h: 5 },
  { type: "ap_traffic_bar", label: "AP traffic", section: "wireless", description: "Bar chart", w: 6, h: 5 },
  { type: "ap_traffic_pie", label: "Traffic share", section: "wireless", description: "Pie chart", w: 6, h: 5 },
  { type: "ap_table", label: "Access points", section: "wireless", description: "Table", w: 12, h: 5 }
];

const WIDGET_GROUPS = [
  { label: "Status", section: "status" as const },
  { label: "Traffic", section: "traffic" as const },
  { label: "Wireless", section: "wireless" as const }
];

function hoursForRange(range: ChartRange): number {
  if (range === "1h") return 1;
  if (range === "30d") return 720;
  if (range === "7d") return 168;
  return 24;
}

function apLabel(a: { label?: string; nickname?: string | null; name: string }): string {
  return (a.label || a.nickname || a.name).trim() || a.name;
}

function formatBitrate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} Gbps`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbps`;
  return `${(value / 1000).toFixed(1)} Kbps`;
}

function formatMbps(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatAge(tsSec: number | null): string {
  if (tsSec == null) return "—";
  const age = Math.max(0, Math.floor(Date.now() / 1000 - tsSec));
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  return `${Math.floor(age / 3600)}h ago`;
}

function formatPct(v: number | null): string {
  return v != null && Number.isFinite(v) ? `${v}%` : "—";
}

function uplinkLabel(v: number | null): { state: string; label: string } {
  if (v == null) return { state: "unknown", label: "Unknown" };
  if (v >= 1) return { state: "healthy", label: "UP" };
  return { state: "critical", label: "DOWN" };
}

function safeInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeLayoutForSave(layout: SiteNetworkLayout): SiteNetworkLayout {
  const prepared = layout.widgets.map((w) => {
    const h = Math.max(1, Math.min(24, safeInt(w.h, 4)));
    const ww = Math.max(1, Math.min(12, safeInt(w.w, 4)));
    const x = Math.max(0, Math.min(11, safeInt(w.x, 0)));
    const yRaw = safeInt(w.y, -1);
    return { ...w, x, y: yRaw, w: ww, h };
  });

  let maxBottom = 0;
  for (const w of prepared) {
    if (w.y >= 0) maxBottom = Math.max(maxBottom, w.y + w.h);
  }

  return {
    ...layout,
    widgets: prepared.map((w, i) => ({
      ...w,
      y: w.y >= 0 ? w.y : maxBottom + i * Math.max(2, w.h)
    }))
  };
}

function widgetLabel(type: SiteNetworkWidgetType, config?: Record<string, string>) {
  const custom = config?.title?.trim();
  if (custom) return custom;
  return WIDGET_CATALOG.find((c) => c.type === type)?.label ?? type;
}

type Props = {
  token: string;
  site: Site;
};

export function SiteNetworkPanel({ token, site }: Props) {
  const [network, setNetwork] = useState<SiteNetworkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<ChartRange>("24h");
  const [layout, setLayout] = useState<SiteNetworkLayout | null>(null);
  const [editing, setEditing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [width, setWidth] = useState(900);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rowH = 36;
  const gridMargin: [number, number] = [10, 10];

  const refreshLayout = useCallback(async () => {
    const r = await getSiteNetworkLayout(token, site.id);
    setLayout(r.layout);
  }, [token, site.id]);

  useEffect(() => {
    refreshLayout().catch((e) => setError(e instanceof Error ? e.message : "Layout load failed"));
  }, [refreshLayout]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getSiteNetwork(token, site.id, hoursForRange(range));
        if (cancelled) return;
        setNetwork(res.network);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Network load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, STATUS_POLL_MS * 2);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, site.id, range, site.wanUplink?.deviceId, site.wanUplink?.ifName]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [layout]);

  const aps = network?.aps?.length
    ? network.aps
    : (network?.clients.byDevice ?? []).map((d) => ({
        deviceId: d.deviceId,
        name: d.name,
        nickname: null as string | null,
        label: d.name,
        vendor: d.vendor,
        clients: d.clients,
        inBps: null as number | null,
        outBps: null as number | null,
        snmpUp: null as number | null
      }));

  const wanChartData = useMemo(() => {
    const inMap = new Map((network?.trafficSeries.inBps ?? []).map((p) => [p.ts, p.value]));
    const outMap = new Map((network?.trafficSeries.outBps ?? []).map((p) => [p.ts, p.value]));
    const tsSet = new Set([...inMap.keys(), ...outMap.keys()]);
    const fmt =
      range === "1h" || range === "24h"
        ? { hour: "2-digit" as const, minute: "2-digit" as const }
        : { month: "short" as const, day: "numeric" as const, hour: "2-digit" as const };
    return [...tsSet]
      .sort((a, b) => a - b)
      .map((ts) => ({
        t: new Date(ts * 1000).toLocaleString([], fmt),
        inMbps: (inMap.get(ts) ?? 0) / 1_000_000,
        outMbps: (outMap.get(ts) ?? 0) / 1_000_000
      }));
  }, [network, range]);

  const speedChartData = useMemo(() => {
    const down = new Map((network?.speedtest.downloadSeries ?? []).map((p) => [p.ts, p.value]));
    const up = new Map((network?.speedtest.uploadSeries ?? []).map((p) => [p.ts, p.value]));
    const tsSet = new Set([...down.keys(), ...up.keys()]);
    const fmt =
      range === "1h" || range === "24h"
        ? { hour: "2-digit" as const, minute: "2-digit" as const }
        : { month: "short" as const, day: "numeric" as const };
    return [...tsSet]
      .sort((a, b) => a - b)
      .map((ts) => ({
        t: new Date(ts * 1000).toLocaleString([], fmt),
        downMbps: (down.get(ts) ?? 0) / 1_000_000,
        upMbps: (up.get(ts) ?? 0) / 1_000_000
      }));
  }, [network, range]);

  const clientBarData = useMemo(
    () =>
      aps
        .filter((a) => a.clients != null)
        .map((a) => ({ name: apLabel(a), clients: a.clients ?? 0 }))
        .sort((a, b) => b.clients - a.clients),
    [aps]
  );

  const clientPieData = useMemo(
    () => clientBarData.filter((d) => d.clients > 0).map((d) => ({ name: d.name, value: d.clients })),
    [clientBarData]
  );

  const trafficBarData = useMemo(
    () =>
      aps
        .map((a) => ({
          name: apLabel(a),
          totalMbps: ((a.inBps ?? 0) + (a.outBps ?? 0)) / 1_000_000,
          inMbps: (a.inBps ?? 0) / 1_000_000,
          outMbps: (a.outBps ?? 0) / 1_000_000
        }))
        .filter((d) => d.totalMbps > 0 || aps.some((a) => a.inBps != null || a.outBps != null))
        .sort((a, b) => b.totalMbps - a.totalMbps),
    [aps]
  );

  const trafficPieData = useMemo(
    () =>
      trafficBarData
        .filter((d) => d.totalMbps > 0)
        .map((d) => ({ name: d.name, value: Number(d.totalMbps.toFixed(3)) })),
    [trafficBarData]
  );

  const dns = uplinkLabel(network?.uplink.dns ?? null);
  const vps = uplinkLabel(network?.uplink.vps ?? null);
  const st = network?.speedtest;

  const gridLayout: Layout[] = useMemo(() => {
    if (!layout) return [];
    return layout.widgets.map((w) => {
      const collapsed = w.config?.collapsed === "1";
      return {
        i: w.i,
        x: w.x,
        y: w.y,
        w: w.w,
        h: collapsed ? 1 : w.h,
        minW: 2,
        minH: 1
      };
    });
  }, [layout]);

  const applyLayoutPositions = (next: Layout[]) => {
    if (!layout) return;
    const byId = new Map(next.map((l) => [l.i, l]));
    setLayout({
      ...layout,
      widgets: layout.widgets.map((w) => {
        const pos = byId.get(w.i);
        if (!pos) return w;
        const collapsed = w.config?.collapsed === "1";
        return {
          ...w,
          x: pos.x,
          y: pos.y,
          w: pos.w,
          // Keep full height in model when collapsed so expand restores size
          h: collapsed ? w.h : pos.h
        };
      })
    });
  };

  const persist = async () => {
    if (!layout) return;
    const prepared = normalizeLayoutForSave(layout);
    const r = await saveSiteNetworkLayout(token, site.id, prepared);
    setLayout(r.layout);
    setEditing(false);
    setDrawerOpen(false);
  };

  const cancelEdit = async () => {
    setEditing(false);
    setDrawerOpen(false);
    await refreshLayout();
  };

  const doReset = async () => {
    const r = await resetSiteNetworkLayout(token, site.id);
    setLayout(r.layout);
  };

  const addWidget = (type: SiteNetworkWidgetType) => {
    if (!layout) return;
    const catalog = WIDGET_CATALOG.find((c) => c.type === type);
    const id = `${type}-${Date.now().toString(36)}`;
    let maxY = 0;
    for (const w of layout.widgets) maxY = Math.max(maxY, w.y + w.h);
    const widget: SiteNetworkWidget = {
      i: id,
      type,
      x: 0,
      y: maxY,
      w: catalog?.w ?? 6,
      h: catalog?.h ?? 4,
      config: { section: catalog?.section ?? "traffic" }
    };
    setLayout({ ...layout, widgets: [...layout.widgets, widget] });
  };

  const removeWidget = (id: string) => {
    if (!layout) return;
    setLayout({ ...layout, widgets: layout.widgets.filter((w) => w.i !== id) });
  };

  const toggleCollapse = (id: string) => {
    if (!layout) return;
    setLayout({
      ...layout,
      widgets: layout.widgets.map((w) => {
        if (w.i !== id) return w;
        const collapsed = w.config?.collapsed === "1";
        return {
          ...w,
          config: { ...w.config, collapsed: collapsed ? "0" : "1" }
        };
      })
    });
  };

  const setSection = (id: string, section: string) => {
    if (!layout) return;
    setLayout({
      ...layout,
      widgets: layout.widgets.map((w) =>
        w.i === id ? { ...w, config: { ...w.config, section } } : w
      )
    });
  };

  const renderBody = (w: SiteNetworkWidget) => {
    if (w.config?.collapsed === "1") {
      return <p className="muted px-2 text-sm">Collapsed</p>;
    }

    switch (w.type) {
      case "kpi_strip":
        return (
          <div className="websiteKpiStrip">
            <div className="healthChip">
              <span className="healthChipLabel">DNS check</span>
              <StatusPill state={dns.state} notes={dns.label} />
            </div>
            <div className="healthChip">
              <span className="healthChipLabel">Internet check</span>
              <StatusPill state={vps.state} notes={vps.label} />
            </div>
            <div className="healthChip">
              <span className="healthChipLabel">Download</span>
              <strong className="healthChipValue">{formatBitrate(network?.traffic.inBps ?? null)}</strong>
            </div>
            <div className="healthChip">
              <span className="healthChipLabel">Upload</span>
              <strong className="healthChipValue">{formatBitrate(network?.traffic.outBps ?? null)}</strong>
            </div>
            <div className="healthChip">
              <span className="healthChipLabel">Line in use</span>
              <strong className="healthChipValue">
                {formatPct(network?.traffic.utilInPct ?? null)}
                {" / "}
                {formatPct(network?.traffic.utilOutPct ?? null)}
              </strong>
            </div>
            <div className="healthChip">
              <span className="healthChipLabel">Clients</span>
              <strong className="healthChipValue">
                {network?.clients.total != null ? network.clients.total : "—"}
              </strong>
            </div>
            <div className="healthChip">
              <span className="healthChipLabel">Speed test</span>
              <strong className="healthChipValue">
                {st?.available
                  ? `${formatBitrate(st.downloadBps)} / ${formatBitrate(st.uploadBps)}`
                  : "—"}
              </strong>
            </div>
            <div className="healthChip">
              <span className="healthChipLabel">Ping</span>
              <strong className="healthChipValue">
                {st?.pingMs != null ? `${st.pingMs} ms` : "—"}
              </strong>
            </div>
          </div>
        );

      case "wan_status":
        return (
          <p className="siteNetworkWanStatus muted px-1">
            {network?.wanUplink ? (
              <>
                Line:{" "}
                <strong className="healthChipValue">
                  {network.wanDeviceName ?? network.wanUplink.deviceId} · {network.wanUplink.ifName}
                </strong>
                {network.traffic.capacityBps != null
                  ? ` · ${formatBitrate(network.traffic.capacityBps)}`
                  : ""}
                {st?.lastSuccessAt != null ? ` · speed test ${formatAge(st.lastSuccessAt)}` : ""}
              </>
            ) : (
              "No internet line tagged — set it under Edit site."
            )}
          </p>
        );

      case "wan_util_summary": {
        const windows = [
          { key: "1d" as const, label: "Today" },
          { key: "7d" as const, label: "7 days" },
          { key: "30d" as const, label: "30 days" }
        ];
        return (
          <div className="wanUtilSummary">
            <div className="wanUtilSummaryHead">
              <Gauge className="size-4 text-primary" aria-hidden />
              <span className="text-sm font-medium">Line use</span>
            </div>
            <div className="wanUtilSummaryGrid">
              {windows.map(({ key, label }) => {
                const win = network?.utilWindows?.[key];
                return (
                  <div key={key} className="wanUtilCell">
                    <div className="wanUtilCellLabel">{label}</div>
                    <div className="wanUtilCellMain">
                      <Activity className="size-3.5 text-muted-foreground" aria-hidden />
                      <span>
                        {formatPct(win?.avgInPct ?? null)}
                        <span className="text-muted-foreground"> in</span>
                      </span>
                    </div>
                    <div className="wanUtilCellMain">
                      <Activity className="size-3.5 text-muted-foreground" aria-hidden />
                      <span>
                        {formatPct(win?.avgOutPct ?? null)}
                        <span className="text-muted-foreground"> out</span>
                      </span>
                    </div>
                    <div className="wanUtilCellPeak muted">
                      Peak {formatPct(win?.peakInPct ?? null)} / {formatPct(win?.peakOutPct ?? null)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      case "wan_bandwidth_chart":
        return (
          <MetricChartFrame
            title={`Download / upload (${range})`}
            className="websiteChartCard h-full border-0 bg-transparent shadow-none"
            actions={
              <RangeToggle
                value={range}
                onChange={(v) => setRange(v as ChartRange)}
                options={["1h", "24h", "7d", "30d"]}
              />
            }
          >
            <div className="websiteChartInner">
              {!network?.wanUplink || wanChartData.length < 2 ? (
                <p className="muted">No traffic history yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={wanChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={28} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} width={48} unit="M" />
                    <Tooltip
                      {...darkTooltipProps()}
                      formatter={(value) => [
                        `${formatMbps(typeof value === "number" ? value : Number(value))} Mbps`,
                        undefined
                      ]}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="inMbps"
                      name="Download"
                      stroke="var(--accent)"
                      fill="rgba(0, 181, 226, 0.2)"
                      strokeWidth={1.5}
                    />
                    <Area
                      type="monotone"
                      dataKey="outMbps"
                      name="Upload"
                      stroke="var(--accent-yellow)"
                      fill="rgba(245, 196, 0, 0.15)"
                      strokeWidth={1.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </MetricChartFrame>
        );

      case "speedtest_chart":
        return (
          <MetricChartFrame
            title="Speed test"
            className="websiteChartCard h-full border-0 bg-transparent shadow-none"
          >
            <div className="websiteChartInner">
              {!st?.available || speedChartData.length < 2 ? (
                <p className="muted">{st?.message ?? "Waiting for first speed test…"}</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={speedChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={28} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} width={48} unit="M" />
                    <Tooltip
                      {...darkTooltipProps()}
                      formatter={(value) => [
                        `${formatMbps(typeof value === "number" ? value : Number(value))} Mbps`,
                        undefined
                      ]}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="downMbps"
                      name="Download"
                      stroke="var(--accent)"
                      fill="rgba(0, 181, 226, 0.18)"
                      strokeWidth={1.5}
                    />
                    <Area
                      type="monotone"
                      dataKey="upMbps"
                      name="Upload"
                      stroke="var(--accent-yellow)"
                      fill="rgba(245, 196, 0, 0.12)"
                      strokeWidth={1.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </MetricChartFrame>
        );

      case "ap_clients_bar":
        return (
          <MetricChartFrame
            title="Clients by AP"
            className="websiteChartCard h-full border-0 bg-transparent shadow-none"
          >
            <div className="websiteChartInner">
              {clientBarData.length === 0 ? (
                <p className="muted">
                  {aps.length > 0
                    ? "APs are online but client counts are empty."
                    : "No access points yet."}
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={clientBarData} layout="vertical" margin={{ left: 8, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted)" }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={90}
                      tick={{ fontSize: 11, fill: "var(--muted)" }}
                    />
                    <Tooltip {...darkTooltipProps()} />
                    <Bar dataKey="clients" name="Clients" fill="var(--accent)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </MetricChartFrame>
        );

      case "ap_clients_pie":
        return (
          <MetricChartFrame
            title="Client share"
            className="websiteChartCard h-full border-0 bg-transparent shadow-none"
          >
            <div className="websiteChartInner">
              {clientPieData.length === 0 ? (
                <p className="muted">No client share yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={clientPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={78}
                      label={({ name, percent }) =>
                        `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                      }
                    >
                      {clientPieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip {...darkTooltipProps()} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </MetricChartFrame>
        );

      case "ap_traffic_bar":
        return (
          <MetricChartFrame
            title="AP traffic"
            className="websiteChartCard h-full border-0 bg-transparent shadow-none"
          >
            <div className="websiteChartInner">
              {trafficBarData.length === 0 ? (
                <p className="muted">No AP traffic yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trafficBarData} layout="vertical" margin={{ left: 8, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted)" }} unit="M" />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={90}
                      tick={{ fontSize: 11, fill: "var(--muted)" }}
                    />
                    <Tooltip
                      {...darkTooltipProps()}
                      formatter={(value) => [
                        `${formatMbps(typeof value === "number" ? value : Number(value))} Mbps`,
                        undefined
                      ]}
                    />
                    <Legend />
                    <Bar dataKey="inMbps" name="In" stackId="t" fill="var(--accent)" />
                    <Bar dataKey="outMbps" name="Out" stackId="t" fill="var(--accent-yellow)" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </MetricChartFrame>
        );

      case "ap_traffic_pie":
        return (
          <MetricChartFrame
            title="Traffic share"
            className="websiteChartCard h-full border-0 bg-transparent shadow-none"
          >
            <div className="websiteChartInner">
              {trafficPieData.length === 0 ? (
                <p className="muted">No traffic share yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={trafficPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={78}
                      label={({ name, percent }) =>
                        `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                      }
                    >
                      {trafficPieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      {...darkTooltipProps()}
                      formatter={(value) => [
                        `${formatMbps(typeof value === "number" ? value : Number(value))} Mbps`,
                        "Total"
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </MetricChartFrame>
        );

      case "ap_table":
        return (
          <div className="tableCard h-full overflow-auto border-0 bg-transparent shadow-none">
            <div className="tableTitle flex items-center gap-2">
              <Wifi className="size-3.5" aria-hidden />
              Access points
            </div>
            <table className="dataTable">
              <thead>
                <tr>
                  <th>AP</th>
                  <th>Vendor</th>
                  <th>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3" aria-hidden />
                      Clients
                    </span>
                  </th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {aps.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No access points yet. Add them under Overview → Devices.
                    </td>
                  </tr>
                ) : (
                  aps.map((d) => (
                    <tr key={d.deviceId}>
                      <td>
                        {apLabel(d)}
                        {d.nickname ? <div className="muted">{d.name}</div> : null}
                      </td>
                      <td>{d.vendor}</td>
                      <td>{d.clients != null ? d.clients : "—"}</td>
                      <td>{formatBitrate(d.inBps)}</td>
                      <td>{formatBitrate(d.outBps)}</td>
                      <td>
                        {d.snmpUp == null ? (
                          "—"
                        ) : (
                          <StatusPill
                            state={d.snmpUp >= 1 ? "healthy" : "critical"}
                            notes={d.snmpUp >= 1 ? "UP" : "DOWN"}
                          />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        );

      default:
        return null;
    }
  };

  if (!layout) {
    return (
      <div className="siteNetworkPanel space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const gridMinRows = Math.max(
    12,
    layout.widgets.reduce((m, w) => Math.max(m, w.y + (w.config?.collapsed === "1" ? 1 : w.h)), 0)
  );

  return (
    <div className="siteNetworkPanel">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setDrawerOpen(true)}>
              Add card
            </Button>
            <Button type="button" size="sm" onClick={() => void persist()}>
              Save layout
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void cancelEdit()}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button type="button" size="sm" onClick={() => setEditing(true)}>
              Edit layout
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void doReset()}>
              Reset
            </Button>
          </>
        )}
      </div>

      {editing ? (
        <div className="bannerHint mb-3">
          Drag cards to rearrange. Collapse to a title bar. Set Status / Traffic / Wireless in the
          card menu. Click <strong>Save layout</strong> when done.
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && !network ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Skeleton className="h-40" />
            <Skeleton className="h-40 md:col-span-2" />
          </div>
        </div>
      ) : (
        <div
          ref={hostRef}
          className={`dashboardHost siteNetworkHost${editing ? " dashboardHostEditing" : ""}`}
          style={{ minHeight: gridMinRows * rowH + 40 }}
        >
          <GridLayout
            className="layout"
            layout={gridLayout}
            cols={12}
            rowHeight={rowH}
            width={width}
            margin={gridMargin}
            containerPadding={[0, 0]}
            isDraggable={editing}
            isResizable={editing}
            onDragStop={applyLayoutPositions}
            onResizeStop={applyLayoutPositions}
            draggableHandle=".widgetDrag"
            compactType={null}
            preventCollision
            allowOverlap={false}
            useCSSTransforms
            resizeHandles={["se"]}
          >
            {layout.widgets.map((w) => {
              const section = w.config?.section ?? "traffic";
              return (
                <div key={w.i} className="dashWidget siteNetworkWidget">
                  <div className="widgetChrome">
                    {editing ? (
                      <span className="widgetDrag" title="Drag">
                        ⋮⋮
                      </span>
                    ) : null}
                    <span className="widgetTypeLabel">{widgetLabel(w.type, w.config)}</span>
                    <span className="siteNetworkSectionTag">{section}</span>
                    {editing ? (
                      <select
                        className="siteNetworkSectionSelect"
                        value={section}
                        onChange={(e) => setSection(w.i, e.target.value)}
                        title="Section"
                        aria-label="Section"
                      >
                        <option value="status">Status</option>
                        <option value="traffic">Traffic</option>
                        <option value="wireless">Wireless</option>
                      </select>
                    ) : null}
                    <button
                      type="button"
                      className="iconBtn"
                      title={w.config?.collapsed === "1" ? "Expand" : "Collapse"}
                      onClick={() => toggleCollapse(w.i)}
                    >
                      {w.config?.collapsed === "1" ? "▸" : "▾"}
                    </button>
                    {editing ? (
                      <button
                        type="button"
                        className="iconBtn"
                        title="Remove"
                        onClick={() => removeWidget(w.i)}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                  <div className="siteNetworkWidgetBody">{renderBody(w)}</div>
                </div>
              );
            })}
          </GridLayout>
        </div>
      )}

      {drawerOpen && editing ? (
        <div className="drawer">
          <div className="drawerTitle">Add card</div>
          {WIDGET_GROUPS.map((group) => (
            <div key={group.label} className="drawerGroup">
              <div className="drawerGroupLabel">{group.label}</div>
              {WIDGET_CATALOG.filter((c) => c.section === group.section).map((c) => (
                <button
                  key={c.type}
                  type="button"
                  className="drawerItem"
                  onClick={() => {
                    addWidget(c.type);
                    setDrawerOpen(false);
                  }}
                >
                  <span className="drawerItemLabel" title={c.description}>
                    {c.label}
                  </span>
                </button>
              ))}
            </div>
          ))}
          <button type="button" onClick={() => setDrawerOpen(false)}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
