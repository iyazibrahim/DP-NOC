import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { getSiteNetwork, STATUS_POLL_MS, type SiteNetworkSummary } from "../api";
import type { Site } from "../types";
import { StatusPill } from "./StatusPill";

type ChartRange = "24h" | "7d" | "30d";

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

function uplinkLabel(v: number | null): { state: string; label: string } {
  if (v == null) return { state: "unknown", label: "Unknown" };
  if (v >= 1) return { state: "healthy", label: "UP" };
  return { state: "critical", label: "DOWN" };
}

type Props = {
  token: string;
  site: Site;
  onEditSite?: () => void;
};

export function SiteNetworkPanel({ token, site, onEditSite }: Props) {
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

  const chartData = useMemo(() => {
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

  const dns = uplinkLabel(network?.uplink.dns ?? null);
  const vps = uplinkLabel(network?.uplink.vps ?? null);

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
          <span className="healthChipLabel">Download (in)</span>
          <strong className="healthChipValue">{formatBitrate(network?.traffic.inBps ?? null)}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Upload (out)</span>
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
            {onEditSite ? (
              <>
                {" · "}
                <button type="button" className="linkBtn" onClick={onEditSite}>
                  Change in Edit site
                </button>
              </>
            ) : null}
          </>
        ) : (
          <>
            No WAN interface tagged —{" "}
            {onEditSite ? (
              <button type="button" className="linkBtn" onClick={onEditSite}>
                set it in Edit site
              </button>
            ) : (
              "set it in Edit site"
            )}
            .
          </>
        )}
      </p>

      <div className="tableCard websiteChartCard" style={{ marginBottom: 14 }}>
        <div className="bentoTileHeader">
          <div className="tableTitle">Bandwidth in/out ({range})</div>
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
          {!network?.wanUplink || chartData.length < 2 ? (
            <p className="muted">No WAN traffic history yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={28} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} width={48} unit="M" />
                <Tooltip
                  contentStyle={{
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text)"
                  }}
                  labelStyle={{ color: "var(--muted)" }}
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

      <div className="siteNetworkSplit">
        <div className="tableCard">
          <div className="tableTitle">Connected clients (APs)</div>
          <table className="dataTable">
            <thead>
              <tr>
                <th>AP</th>
                <th>Vendor</th>
                <th>Clients</th>
              </tr>
            </thead>
            <tbody>
              {(network?.clients.byDevice ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No APs found. Add each AP under Overview → Devices (type{" "}
                    <code>ap</code>, vendor <code>cambium</code> or <code>omada</code>), then Force-apply
                    the collector so SNMP client metrics are scraped.
                  </td>
                </tr>
              ) : (
                (network?.clients.byDevice ?? []).map((d) => (
                  <tr key={d.deviceId}>
                    <td>{d.name}</td>
                    <td>{d.vendor}</td>
                    <td>{d.clients != null ? d.clients : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="tableCard">
          <div className="tableTitle">What happened?</div>
          <table className="dataTable">
            <thead>
              <tr>
                <th>Problem</th>
                <th>Opened</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(network?.incidents ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No recent site incidents.
                  </td>
                </tr>
              ) : (
                (network?.incidents ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div>{i.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {i.detail}
                      </div>
                    </td>
                    <td>{new Date(i.openedAt).toLocaleString()}</td>
                    <td>
                      {i.acknowledgedAt ? "Acked" : i.resolvedAt ? "Needs ack" : "Active"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tableCard" style={{ marginTop: 14 }}>
        <div className="tableTitle">ISP speedtest</div>
        <p className="muted" style={{ marginBottom: 0 }}>
          {network?.speedtest.message ?? "Coming soon."}
        </p>
      </div>
    </div>
  );
}
