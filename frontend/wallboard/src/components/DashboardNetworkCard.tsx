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
import { LineUseCards } from "@/components/LineUseCards";
import { Modal } from "@/components/Modal";
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

  useEffect(() => {
    if (!token || !siteId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getSiteNetwork(token, siteId, 24);
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
  }, [token, siteId]);

  if (!siteId) return <div className="muted">Pick a site in settings.</div>;
  if (error) return <div className="muted">{error}</div>;
  if (!network) return <div className="chartSkeleton" aria-hidden />;

  if (view === "line") return <LineUseCards network={network} />;
  if (view === "bandwidth") return <Bandwidth network={network} siteId={siteId} />;
  if (view === "speed") return <SpeedTest network={network} siteId={siteId} />;
  return <ApTraffic network={network} />;
}

function Bandwidth({ network, siteId }: { network: SiteNetworkSummary; siteId: string }) {
  const [open, setOpen] = useState(false);
  const data = useMemo(() => trafficPoints(network, "24h"), [network]);

  return (
    <>
      <div
        className="siteNetworkChartBody metricChartClick"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen(true);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <TrafficChart network={network} data={data} />
      </div>
      <Modal open={open} title="Download / upload" onClose={() => setOpen(false)} wide className="sm:max-w-4xl">
        <NetworkRangeChart siteId={siteId} view="bandwidth" />
      </Modal>
    </>
  );
}

function SpeedTest({ network, siteId }: { network: SiteNetworkSummary; siteId: string }) {
  const [open, setOpen] = useState(false);
  const data = useMemo(() => speedPoints(network, "24h"), [network]);

  return (
    <>
      <div
        className="siteNetworkChartBody metricChartClick"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen(true);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <SpeedChart network={network} data={data} />
      </div>
      <Modal open={open} title="Speed test" onClose={() => setOpen(false)} wide className="sm:max-w-4xl">
        <NetworkRangeChart siteId={siteId} view="speed" />
      </Modal>
    </>
  );
}

function NetworkRangeChart({ siteId, view }: { siteId: string; view: "bandwidth" | "speed" }) {
  const { token } = useAuth();
  const [range, setRange] = useState<ChartRange>("24h");
  const [network, setNetwork] = useState<SiteNetworkSummary | null>(null);

  useEffect(() => {
    if (!token || !siteId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getSiteNetwork(token, siteId, hoursForRange(range));
        if (!cancelled) setNetwork(res.network);
      } catch {
        if (!cancelled) setNetwork(null);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token, siteId, range]);

  const traffic = useMemo(() => (network ? trafficPoints(network, range) : []), [network, range]);
  const speed = useMemo(() => (network ? speedPoints(network, range) : []), [network, range]);

  return (
    <div className="metricDetail">
      <div className="siteNetworkChartToolbar">
        <RangeToggle value={range} onChange={(v) => setRange(v as ChartRange)} options={["1h", "24h", "7d", "30d"]} />
      </div>
      <div className="metricDetailChart">
        {!network ? (
          <div className="chartSkeleton" aria-hidden />
        ) : view === "bandwidth" ? (
          <TrafficChart network={network} data={traffic} />
        ) : (
          <SpeedChart network={network} data={speed} />
        )}
      </div>
    </div>
  );
}

function trafficPoints(network: SiteNetworkSummary, range: ChartRange) {
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
}

function TrafficChart({
  network,
  data
}: {
  network: SiteNetworkSummary;
  data: ReturnType<typeof trafficPoints>;
}) {
  return (
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
  );
}

function speedPoints(network: SiteNetworkSummary, range: ChartRange) {
  const st = network.speedtest;
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
}

function SpeedChart({
  network,
  data
}: {
  network: SiteNetworkSummary;
  data: ReturnType<typeof speedPoints>;
}) {
  const st = network.speedtest;
  return (
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
