import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { getSiteNetwork, STATUS_POLL_MS, type SiteNetworkSummary } from "@/api";
import { useAuth } from "@/auth/AuthContext";
import { darkTooltipProps } from "@/components/noc/MetricChart";
import { RangeToggle } from "@/components/noc/RangeToggle";

export type NetworkGlance = "line" | "bandwidth" | "speed" | "ap";

type ChartRange = "1h" | "24h" | "7d" | "30d";

function hoursForRange(range: ChartRange): number {
  if (range === "1h") return 1;
  if (range === "30d") return 720;
  if (range === "7d") return 168;
  return 24;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  const tb = 1_000_000_000_000;
  const gb = 1_000_000_000;
  const mb = 1_000_000;
  if (bytes >= tb) return `${(bytes / tb).toFixed(2)} TB`;
  if (bytes >= gb) return `${(bytes / gb).toFixed(bytes >= 10 * gb ? 1 : 2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${Math.round(bytes)} B`;
}

function formatMbps(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return (value / 1000).toFixed(2);
  return value.toFixed(value >= 10 ? 1 : 2);
}

export function DashboardNetworkCard({
  siteId,
  view
}: {
  siteId: string;
  view: NetworkGlance;
}) {
  const { token } = useAuth();
  const [network, setNetwork] = useState<SiteNetworkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<ChartRange>("24h");

  useEffect(() => {
    if (!token || !siteId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getSiteNetwork(token, siteId, hoursForRange(range));
        if (!cancelled) {
          setNetwork(res.network);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Network load failed");
      }
    };
    load();
    const t = setInterval(load, STATUS_POLL_MS * 2);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, siteId, range]);

  if (!siteId) return <div className="muted">Pick a site in settings.</div>;
  if (error) return <div className="muted">{error}</div>;
  if (!network) return <div className="chartSkeleton" aria-hidden />;

  if (view === "line") return <LineUse network={network} />;
  if (view === "bandwidth") return <Bandwidth network={network} range={range} setRange={setRange} />;
  if (view === "speed") return <SpeedTest network={network} range={range} setRange={setRange} />;
  return <ApTraffic network={network} />;
}

function LineUse({ network }: { network: SiteNetworkSummary }) {
  const windows = [
    { key: "1d" as const, label: "Today" },
    { key: "7d" as const, label: "7 days" },
    { key: "30d" as const, label: "30 days" }
  ];
  return (
    <div className="wanUtilSummary">
      <div className="wanUtilSummaryGrid">
        {windows.map(({ key, label }) => {
          const win = network.utilWindows?.[key];
          const inB = win?.inBytes ?? null;
          const outB = win?.outBytes ?? null;
          const total = inB != null || outB != null ? (inB ?? 0) + (outB ?? 0) : null;
          return (
            <div key={key} className="wanUtilCell">
              <div className="wanUtilCellLabel">{label}</div>
              <div className="wanUtilCellTotal">{formatBytes(total)}</div>
              <div className="wanUtilCellSplit">
                <span>↓ {formatBytes(inB)}</span>
                <span>↑ {formatBytes(outB)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Bandwidth({
  network,
  range,
  setRange
}: {
  network: SiteNetworkSummary;
  range: ChartRange;
  setRange: (range: ChartRange) => void;
}) {
  const data = useMemo(() => {
    const inMap = new Map(network.trafficSeries.inBps.map((p) => [p.ts, p.value]));
    const outMap = new Map(network.trafficSeries.outBps.map((p) => [p.ts, p.value]));
    const ts = [...new Set([...inMap.keys(), ...outMap.keys()])].sort((a, b) => a - b);
    const fmt =
      range === "1h" || range === "24h"
        ? { hour: "2-digit" as const, minute: "2-digit" as const }
        : { month: "short" as const, day: "numeric" as const, hour: "2-digit" as const };
    return ts.map((t) => ({
      t: new Date(t * 1000).toLocaleString([], fmt),
      inMbps: (inMap.get(t) ?? 0) / 1_000_000,
      outMbps: (outMap.get(t) ?? 0) / 1_000_000
    }));
  }, [network, range]);

  return (
    <div className="siteNetworkChartBody">
      <div className="siteNetworkChartToolbar">
        <RangeToggle value={range} onChange={(v) => setRange(v as ChartRange)} options={["1h", "24h", "7d", "30d"]} />
      </div>
      <div className="chartFlexFill">
        {!network.wanUplink || data.length < 2 ? (
          <p className="muted">No traffic history yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={28} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} width={48} unit="M" />
              <Tooltip
                {...darkTooltipProps()}
                formatter={(value) => [`${formatMbps(typeof value === "number" ? value : Number(value))} Mbps`, undefined]}
              />
              <Legend />
              <Area type="monotone" dataKey="inMbps" name="Download" stroke="var(--accent)" fill="rgba(0, 181, 226, 0.2)" strokeWidth={1.5} />
              <Area type="monotone" dataKey="outMbps" name="Upload" stroke="var(--accent-yellow)" fill="rgba(245, 196, 0, 0.15)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function SpeedTest({
  network,
  range,
  setRange
}: {
  network: SiteNetworkSummary;
  range: ChartRange;
  setRange: (range: ChartRange) => void;
}) {
  const st = network.speedtest;
  const data = useMemo(() => {
    const down = new Map(st.downloadSeries.map((p) => [p.ts, p.value]));
    const up = new Map(st.uploadSeries.map((p) => [p.ts, p.value]));
    const ts = [...new Set([...down.keys(), ...up.keys()])].sort((a, b) => a - b);
    const fmt =
      range === "1h" || range === "24h"
        ? { hour: "2-digit" as const, minute: "2-digit" as const }
        : { month: "short" as const, day: "numeric" as const };
    return ts.map((t) => ({
      t: new Date(t * 1000).toLocaleString([], fmt),
      downMbps: (down.get(t) ?? 0) / 1_000_000,
      upMbps: (up.get(t) ?? 0) / 1_000_000
    }));
  }, [st, range]);

  return (
    <div className="siteNetworkChartBody">
      <div className="siteNetworkChartToolbar">
        <RangeToggle value={range} onChange={(v) => setRange(v as ChartRange)} options={["1h", "24h", "7d", "30d"]} />
      </div>
      <div className="chartFlexFill">
        {!st.available || data.length < 2 ? (
          <p className="muted">{st.message ?? "Waiting for the first speed test."}</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={28} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} width={48} unit="M" />
              <Tooltip
                {...darkTooltipProps()}
                formatter={(value) => [`${formatMbps(typeof value === "number" ? value : Number(value))} Mbps`, undefined]}
              />
              <Legend />
              <Area type="monotone" dataKey="downMbps" name="Download" stroke="var(--accent)" fill="rgba(0, 181, 226, 0.18)" strokeWidth={1.5} />
              <Area type="monotone" dataKey="upMbps" name="Upload" stroke="var(--accent-yellow)" fill="rgba(245, 196, 0, 0.12)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function ApTraffic({ network }: { network: SiteNetworkSummary }) {
  const data = network.aps
    .map((a) => ({
      name: (a.label || a.nickname || a.name).trim() || a.name,
      inMbps: (a.inBps ?? 0) / 1_000_000,
      outMbps: (a.outBps ?? 0) / 1_000_000,
      total: ((a.inBps ?? 0) + (a.outBps ?? 0)) / 1_000_000
    }))
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total);

  return (
    <div className="siteNetworkChartBody">
      <div className="chartFlexFill">
        {data.length === 0 ? (
          <p className="muted">No AP traffic yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted)" }} unit="M" />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <Tooltip
                {...darkTooltipProps()}
                formatter={(value) => [`${formatMbps(typeof value === "number" ? value : Number(value))} Mbps`, undefined]}
              />
              <Legend />
              <Bar dataKey="inMbps" name="In" stackId="t" fill="var(--accent)" />
              <Bar dataKey="outMbps" name="Out" stackId="t" fill="var(--accent-yellow)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
