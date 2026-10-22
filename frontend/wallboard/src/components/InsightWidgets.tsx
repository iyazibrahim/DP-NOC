import { useEffect, useMemo, useState } from "react";
import { getDeviceSummary, getWirelessSummary } from "@/api";
import { useAuth } from "@/auth/AuthContext";
import { Modal } from "@/components/Modal";
import type { DeviceSummary, WirelessClusterSummary } from "@/types";
import { resolveWidgetColor } from "@/widgetColors";
import { formatMetricValue } from "./DeviceMetricWidgets";

function formatBitrate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatMetricValue(value, "bps");
}

export function DeviceHealthCard({
  siteId,
  deviceId,
  color,
  metrics
}: {
  siteId: string;
  deviceId: string;
  color?: string;
  metrics?: string;
}) {
  const { token } = useAuth();
  const [summary, setSummary] = useState<DeviceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accent = resolveWidgetColor(color);

  useEffect(() => {
    if (!token || !siteId || !deviceId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getDeviceSummary(token, siteId, deviceId, metrics);
        if (!cancelled) {
          setSummary(res);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Summary failed");
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, siteId, deviceId, metrics]);

  if (!siteId || !deviceId) return <div className="muted">Pick a device in settings.</div>;
  if (error) return <div className="muted">{error}</div>;
  if (!summary) return <div className="chartSkeleton" aria-hidden />;

  const online = summary.online?.value;
  const onlineLabel = online == null ? "NO DATA" : online >= 1 ? "UP" : "DOWN";
  const onlineTone = online == null ? "unknown" : online >= 1 ? "ok" : "bad";

  return (
    <div className="healthCard" style={{ borderColor: accent }}>
      <div className={`healthOnline healthOnline--${onlineTone}`}>{onlineLabel}</div>
      <div className="healthStats">
        {summary.stats.map((stat) => (
          <div key={stat.id} className="healthStat">
            <div className="healthStatValue" style={{ color: accent }}>
              {stat.id === "nas_raid_ok"
                ? stat.value == null
                  ? "—"
                  : stat.value >= 1
                    ? "OK"
                    : "Check"
                : stat.value == null
                  ? "—"
                  : formatMetricValue(stat.value, stat.unit)}
            </div>
            <div className="healthStatLabel">{stat.label}</div>
            {stat.value == null ? <div className="muted">No data</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApClusterCard({
  siteId,
  deviceIds,
  color
}: {
  siteId: string;
  deviceIds: string;
  color?: string;
}) {
  const { token } = useAuth();
  const [summary, setSummary] = useState<WirelessClusterSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const accent = resolveWidgetColor(color);

  useEffect(() => {
    if (!token || !siteId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getWirelessSummary(token, siteId, deviceIds);
        if (!cancelled) {
          setSummary(res.summary);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Cluster summary failed");
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, siteId, deviceIds]);

  if (!siteId) return <div className="muted">Pick a site in settings.</div>;
  if (error) return <div className="muted">{error}</div>;
  if (!summary) return <div className="chartSkeleton" aria-hidden />;

  return (
    <>
    <div
      className="clusterCard metricChartClick"
      style={{ borderColor: accent }}
      role="button"
      tabIndex={0}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen(true);
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="clusterHeadline">
        <div className="clusterClients" style={{ color: accent }}>
          {summary.clients == null ? "—" : Math.round(summary.clients)}
        </div>
        <div className="clusterClientsLabel">Clients</div>
        {summary.clients == null ? <div className="muted">No data</div> : null}
      </div>
      <div className="clusterMeta">
        {summary.reporting} / {summary.selected} APs reporting
      </div>
      <div className="healthStats">
        <div className="healthStat">
          <div className="healthStatValue" style={{ color: accent }}>
            {formatBitrate(summary.radioInBps)}
          </div>
          <div className="healthStatLabel">Radio in</div>
        </div>
        <div className="healthStat">
          <div className="healthStatValue" style={{ color: accent }}>
            {formatBitrate(summary.radioOutBps)}
          </div>
          <div className="healthStatLabel">Radio out</div>
        </div>
        <div className="healthStat">
          <div className="healthStatValue" style={{ color: accent }}>
            {summary.snrAvg == null ? "—" : `${Math.round(summary.snrAvg)} dB`}
          </div>
          <div className="healthStatLabel">Average SNR</div>
        </div>
        <div className="healthStat">
          <div className="healthStatValue" style={{ color: accent }}>
            {summary.snrMin == null ? "—" : `${Math.round(summary.snrMin)} dB`}
          </div>
          <div className="healthStatLabel">Lowest SNR</div>
        </div>
      </div>
      <div className="clusterApList">
        {summary.byAp.map((ap) => (
          <div key={ap.deviceId} className="clusterApRow">
            <span>{ap.label}</span>
            <span>{ap.clients == null ? "—" : Math.round(ap.clients)}</span>
          </div>
        ))}
      </div>
    </div>
    {open ? (
      <Modal open title="AP cluster" onClose={() => setOpen(false)} wide className="sm:max-w-4xl">
        <ApClusterDetail summary={summary} />
      </Modal>
    ) : null}
    </>
  );
}

function snrText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)} dB`;
}

function clientLabel(row: { hostname: string | null; mac: string | null; ip: string | null }): string {
  return row.hostname || row.mac || row.ip || "Client";
}

function ApClusterDetail({ summary }: { summary: WirelessClusterSummary }) {
  const aps = useMemo(
    () =>
      [...summary.byAp].sort((a, b) => (b.clients ?? -1) - (a.clients ?? -1) || a.label.localeCompare(b.label)),
    [summary.byAp]
  );
  const stations = useMemo(
    () =>
      [...(summary.stations ?? [])].sort(
        (a, b) => (b.inBps ?? 0) + (b.outBps ?? 0) - ((a.inBps ?? 0) + (a.outBps ?? 0))
      ),
    [summary.stations]
  );

  return (
    <div className="apDetailStack">
      <div className="metricDetailStats">
        <span>{summary.clients == null ? "—" : Math.round(summary.clients)} clients</span>
        <span>
          {summary.reporting} / {summary.selected} APs reporting
        </span>
        <span>Radio in {formatBitrate(summary.radioInBps)}</span>
        <span>Radio out {formatBitrate(summary.radioOutBps)}</span>
        <span>Average SNR {snrText(summary.snrAvg)}</span>
        <span>Lowest SNR {snrText(summary.snrMin)}</span>
      </div>
      <div className="tableTitle">Access points</div>
      <table className="dataTable">
        <thead>
          <tr>
            <th>AP</th>
            <th>Clients</th>
            <th>Radio in</th>
            <th>Radio out</th>
            <th>Average SNR</th>
            <th>Lowest SNR</th>
          </tr>
        </thead>
        <tbody>
          {aps.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted">
                No access points in this cluster.
              </td>
            </tr>
          ) : (
            aps.map((ap) => (
              <tr key={ap.deviceId}>
                <td>{ap.label}</td>
                <td className="num">{ap.clients == null ? "—" : Math.round(ap.clients)}</td>
                <td className="num">{formatBitrate(ap.radioInBps ?? null)}</td>
                <td className="num">{formatBitrate(ap.radioOutBps ?? null)}</td>
                <td className="num">{snrText(ap.snrAvg)}</td>
                <td className="num">{snrText(ap.snrMin)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="tableTitle">Clients</div>
      <table className="dataTable">
        <thead>
          <tr>
            <th>Client</th>
            <th>AP</th>
            <th>SSID</th>
            <th>SNR</th>
            <th>Down</th>
            <th>Up</th>
          </tr>
        </thead>
        <tbody>
          {stations.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted">
                No clients reported.
              </td>
            </tr>
          ) : (
            stations.map((row, i) => (
              <tr key={`${row.deviceId}-${row.mac ?? row.ip ?? i}`}>
                <td>
                  {clientLabel(row)}
                  {row.hostname && row.mac ? <div className="muted">{row.mac}</div> : null}
                  {row.ip ? <div className="muted">{row.ip}</div> : null}
                </td>
                <td>{row.apLabel}</td>
                <td>{row.ssid || "—"}</td>
                <td className="num">{snrText(row.snr)}</td>
                <td className="num">{formatBitrate(row.inBps)}</td>
                <td className="num">{formatBitrate(row.outBps)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
