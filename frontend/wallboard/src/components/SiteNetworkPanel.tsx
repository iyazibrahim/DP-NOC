import { useEffect, useMemo, useState } from "react";
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
import { getSiteNetwork, STATUS_POLL_MS, type SiteNetworkSummary } from "../api";
import type { Site } from "../types";
import { StatusPill } from "./StatusPill";

type ChartRange = "24h" | "7d" | "30d";

const PIE_COLORS = ["#00b5e2", "#f5c400", "#34d399", "#a78bfa", "#f87171", "#60a5fa", "#fb923c", "#2dd4bf"];

function hoursForRange(range: ChartRange): number {
  if (range === "30d") return 720;
  if (range === "7d") return 168;
  return 24;
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

function uplinkLabel(v: number | null): { state: string; label: string } {
  if (v == null) return { state: "unknown", label: "Unknown" };
  if (v >= 1) return { state: "healthy", label: "UP" };
  return { state: "critical", label: "DOWN" };
}

function darkTooltipProps() {
  return {
    contentStyle: {
      background: "var(--panel-2)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      color: "var(--text)"
    },
    labelStyle: { color: "var(--muted)" },
    itemStyle: { color: "var(--text)" }
  };
}

type Props = {
  token: string;
  site: Site;
};

export function SiteNetworkPanel({ token, site }: Props) {
  const [network, setNetwork] = useState<SiteNetworkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<ChartRange>("24h");

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
      }
    };
    load();
    const t = setInterval(load, STATUS_POLL_MS * 2);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, site.id, range, site.wanUplink?.deviceId, site.wanUplink?.ifName]);

  const aps = network?.aps?.length
    ? network.aps
    : (network?.clients.byDevice ?? []).map((d) => ({
        deviceId: d.deviceId,
        name: d.name,
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
      range === "24h"
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
      range === "24h"
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
        .map((a) => ({ name: a.name, clients: a.clients ?? 0 }))
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
          name: a.name,
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

  return (
    <div className="siteNetworkPanel">
      {error ? <div className="bannerError">{error}</div> : null}

      <div className="websiteKpiStrip">
        <div className="healthChip">
          <span className="healthChipLabel">Uplink DNS</span>
          <StatusPill state={dns.state} notes={dns.label} />
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Uplink central</span>
          <StatusPill state={vps.state} notes={vps.label} />
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">WAN download</span>
          <strong className="healthChipValue">{formatBitrate(network?.traffic.inBps ?? null)}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">WAN upload</span>
          <strong className="healthChipValue">{formatBitrate(network?.traffic.outBps ?? null)}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Util in / out</span>
          <strong className="healthChipValue">
            {network?.traffic.utilInPct != null ? `${network.traffic.utilInPct}%` : "—"}
            {" / "}
            {network?.traffic.utilOutPct != null ? `${network.traffic.utilOutPct}%` : "—"}
          </strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Clients</span>
          <strong className="healthChipValue">
            {network?.clients.total != null ? network.clients.total : "—"}
          </strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Speedtest ↓ / ↑</span>
          <strong className="healthChipValue">
            {st?.available
              ? `${formatBitrate(st.downloadBps)} / ${formatBitrate(st.uploadBps)}`
              : "—"}
          </strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Speedtest ping</span>
          <strong className="healthChipValue">
            {st?.pingMs != null ? `${st.pingMs} ms` : "—"}
          </strong>
        </div>
      </div>

      <p className="siteNetworkWanStatus muted">
        {network?.wanUplink ? (
          <>
            WAN pipe:{" "}
            <strong className="healthChipValue">
              {network.wanDeviceName ?? network.wanUplink.deviceId} · {network.wanUplink.ifName}
            </strong>
            {network.traffic.capacityBps != null
              ? ` · ${formatBitrate(network.traffic.capacityBps)}`
              : ""}
            {st?.lastSuccessAt != null ? ` · speedtest ${formatAge(st.lastSuccessAt)}` : ""}
          </>
        ) : (
          "No WAN interface tagged — set it under Edit site."
        )}
      </p>

      <div className="tableCard websiteChartCard" style={{ marginBottom: 14 }}>
        <div className="bentoTileHeader">
          <div className="tableTitle">WAN bandwidth ({range})</div>
          <div className="formActions">
            {(["24h", "7d", "30d"] as ChartRange[]).map((r) => (
              <button
                key={r}
                type="button"
                className={range === r ? "primary" : undefined}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="websiteChartInner">
          {!network?.wanUplink || wanChartData.length < 2 ? (
            <p className="muted">No WAN traffic history yet.</p>
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
                  name="In"
                  stroke="var(--accent)"
                  fill="rgba(0, 181, 226, 0.2)"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="outMbps"
                  name="Out"
                  stroke="var(--accent-yellow)"
                  fill="rgba(245, 196, 0, 0.15)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="tableCard websiteChartCard" style={{ marginBottom: 14 }}>
        <div className="tableTitle">ISP speedtest (15m cadence)</div>
        <div className="websiteChartInner">
          {!st?.available || speedChartData.length < 2 ? (
            <p className="muted">{st?.message ?? "Waiting for first collector speedtest…"}</p>
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
      </div>

      <div className="siteNetworkVisualGrid">
        <div className="tableCard websiteChartCard">
          <div className="tableTitle">AP clients (bar)</div>
          <div className="websiteChartInner">
            {clientBarData.length === 0 ? (
              <p className="muted">
                No AP client metrics. Add devices type <code>ap</code>, vendor{" "}
                <code>cambium</code> or <code>omada</code>, then Force-apply the collector.
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
        </div>

        <div className="tableCard websiteChartCard">
          <div className="tableTitle">AP clients (share)</div>
          <div className="websiteChartInner">
            {clientPieData.length === 0 ? (
              <p className="muted">No client share data yet.</p>
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
        </div>

        <div className="tableCard websiteChartCard">
          <div className="tableTitle">AP traffic (bar)</div>
          <div className="websiteChartInner">
            {trafficBarData.length === 0 ? (
              <p className="muted">No AP IF-MIB traffic yet (device must be SNMP-scraped).</p>
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
        </div>

        <div className="tableCard websiteChartCard">
          <div className="tableTitle">AP traffic (share)</div>
          <div className="websiteChartInner">
            {trafficPieData.length === 0 ? (
              <p className="muted">No traffic share data yet.</p>
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
        </div>
      </div>

      <div className="tableCard" style={{ marginTop: 14 }}>
        <div className="tableTitle">Access points</div>
        <table className="dataTable">
          <thead>
            <tr>
              <th>AP</th>
              <th>Vendor</th>
              <th>Clients</th>
              <th>In</th>
              <th>Out</th>
              <th>SNMP</th>
            </tr>
          </thead>
          <tbody>
            {aps.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No APs found. Add each AP under Overview → Devices (type <code>ap</code>, vendor{" "}
                  <code>cambium</code> or <code>omada</code>), then Force-apply the collector.
                </td>
              </tr>
            ) : (
              aps.map((d) => (
                <tr key={d.deviceId}>
                  <td>{d.name}</td>
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
    </div>
  );
}
