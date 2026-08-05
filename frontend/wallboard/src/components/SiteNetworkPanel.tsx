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
import {
  getDeviceInterfaces,
  getSiteNetwork,
  updateSite,
  STATUS_POLL_MS,
  type SiteNetworkSummary
} from "../api";
import type { Site } from "../types";
import { StatusPill } from "./StatusPill";

function formatBitrate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} Gbps`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbps`;
  return `${(value / 1000).toFixed(1)} Kbps`;
}

function uplinkLabel(v: number | null): { state: string; label: string } {
  if (v == null) return { state: "unknown", label: "Unknown" };
  if (v >= 1) return { state: "healthy", label: "UP" };
  return { state: "critical", label: "DOWN" };
}

type Props = {
  token: string;
  site: Site;
  onSiteUpdated: (site: Site) => void;
};

export function SiteNetworkPanel({ token, site, onSiteUpdated }: Props) {
  const [network, setNetwork] = useState<SiteNetworkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wanDeviceId, setWanDeviceId] = useState(site.wanUplink?.deviceId ?? "");
  const [wanIfName, setWanIfName] = useState(site.wanUplink?.ifName ?? "");
  const [interfaces, setInterfaces] = useState<
    Array<{ ifName: string; ifDescr?: string; ifIndex?: string }>
  >([]);
  const [msg, setMsg] = useState<string | null>(null);

  const networkDevices = useMemo(
    () => site.devices.filter((d) => d.kind === "network"),
    [site.devices]
  );

  async function reloadNetwork() {
    const res = await getSiteNetwork(token, site.id, 24);
    setNetwork(res.network);
  }

  useEffect(() => {
    setWanDeviceId(site.wanUplink?.deviceId ?? "");
    setWanIfName(site.wanUplink?.ifName ?? "");
  }, [site.wanUplink?.deviceId, site.wanUplink?.ifName]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await reloadNetwork();
        if (!cancelled) setError(null);
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
  }, [token, site.id]);

  useEffect(() => {
    if (!token || !wanDeviceId) {
      setInterfaces([]);
      return;
    }
    let cancelled = false;
    getDeviceInterfaces(token, site.id, wanDeviceId)
      .then((res) => {
        if (!cancelled) setInterfaces(res.interfaces);
      })
      .catch(() => {
        if (!cancelled) setInterfaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, site.id, wanDeviceId]);

  const chartData = useMemo(() => {
    const inMap = new Map((network?.trafficSeries.inBps ?? []).map((p) => [p.ts, p.value]));
    const outMap = new Map((network?.trafficSeries.outBps ?? []).map((p) => [p.ts, p.value]));
    const tsSet = new Set([...inMap.keys(), ...outMap.keys()]);
    return [...tsSet]
      .sort((a, b) => a - b)
      .map((ts) => ({
        t: new Date(ts * 1000).toLocaleString([], {
          hour: "2-digit",
          minute: "2-digit"
        }),
        inMbps: ((inMap.get(ts) ?? 0) / 1_000_000),
        outMbps: ((outMap.get(ts) ?? 0) / 1_000_000)
      }));
  }, [network]);

  async function saveWan() {
    setBusy(true);
    setError(null);
    try {
      const ifName = wanIfName.trim();
      const patch =
        wanDeviceId && ifName
          ? { wanUplink: { deviceId: wanDeviceId, ifName } }
          : { wanUplink: null as null };
      const res = await updateSite(token, site.id, patch);
      onSiteUpdated(res.site);
      setMsg(wanDeviceId && ifName ? "WAN uplink saved." : "WAN uplink cleared.");
      await reloadNetwork();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const dns = uplinkLabel(network?.uplink.dns ?? null);
  const vps = uplinkLabel(network?.uplink.vps ?? null);

  return (
    <div className="siteNetworkPanel">
      {error ? <div className="bannerError">{error}</div> : null}
      {msg ? <p className="muted">{msg}</p> : null}

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
          <strong>{formatBitrate(network?.traffic.inBps ?? null)}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Upload (out)</span>
          <strong>{formatBitrate(network?.traffic.outBps ?? null)}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Util in / out</span>
          <strong>
            {network?.traffic.utilInPct != null ? `${network.traffic.utilInPct}%` : "—"}
            {" / "}
            {network?.traffic.utilOutPct != null ? `${network.traffic.utilOutPct}%` : "—"}
          </strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Clients</span>
          <strong>{network?.clients.total != null ? network.clients.total : "—"}</strong>
        </div>
      </div>

      <div className="tableCard" style={{ marginBottom: 14 }}>
        <div className="tableTitle">WAN / internet pipe</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Tag the firewall/router interface that faces the ISP. Charts use that interface only.
        </p>
        <div className="siteNetworkWanForm">
          <label className="label">
            Device
            <select
              value={wanDeviceId}
              onChange={(e) => {
                setWanDeviceId(e.target.value);
                setWanIfName("");
              }}
            >
              <option value="">— Select —</option>
              {networkDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.type})
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Interface (from SNMP)
            <select
              value={interfaces.some((i) => i.ifName === wanIfName) ? wanIfName : ""}
              onChange={(e) => setWanIfName(e.target.value)}
              disabled={!wanDeviceId || interfaces.length === 0}
            >
              <option value="">
                {wanDeviceId
                  ? interfaces.length === 0
                    ? "No SNMP interfaces found — type below"
                    : "— Select —"
                  : "— Select device first —"}
              </option>
              {interfaces.map((i) => (
                <option key={i.ifName} value={i.ifName}>
                  {i.ifName}
                  {i.ifDescr && i.ifDescr !== i.ifName ? ` · ${i.ifDescr}` : ""}
                  {i.ifIndex ? ` [#${i.ifIndex}]` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Or type interface name
            <input
              value={wanIfName}
              onChange={(e) => setWanIfName(e.target.value.trimStart())}
              placeholder="e.g. wan1"
              disabled={!wanDeviceId}
            />
          </label>
          <div className="formActions" style={{ alignSelf: "end" }}>
            <button
              type="button"
              className="primary"
              disabled={busy || !wanDeviceId || !wanIfName.trim()}
              onClick={() => void saveWan()}
            >
              Save WAN tag
            </button>
            <button
              type="button"
              disabled={busy || (!site.wanUplink && !wanDeviceId)}
              onClick={() => {
                setWanDeviceId("");
                setWanIfName("");
              }}
            >
              Clear form
            </button>
          </div>
        </div>
        {network?.wanUplink ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Active: {network.wanDeviceName ?? network.wanUplink.deviceId} · {network.wanUplink.ifName}
            {network.traffic.capacityBps != null
              ? ` · capacity ${formatBitrate(network.traffic.capacityBps)}`
              : ""}
          </p>
        ) : (
          <p className="muted" style={{ marginBottom: 0 }}>
            No WAN interface tagged yet — traffic charts stay empty until configured.
          </p>
        )}
      </div>

      <div className="tableCard websiteChartCard" style={{ marginBottom: 14 }}>
        <div className="tableTitle">Bandwidth in/out (24h)</div>
        <div className="websiteChartInner">
          {!network?.wanUplink || chartData.length < 2 ? (
            <p className="muted">No WAN traffic history yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={28} />
                <YAxis tick={{ fontSize: 11 }} width={48} unit="M" />
                <Tooltip />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="inMbps"
                  name="In Mbps"
                  stroke="var(--accent)"
                  fill="rgba(0, 181, 226, 0.2)"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="outMbps"
                  name="Out Mbps"
                  stroke="var(--brand-yellow, #f5c400)"
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
                    No APs in inventory (or no client SNMP for this vendor).
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
