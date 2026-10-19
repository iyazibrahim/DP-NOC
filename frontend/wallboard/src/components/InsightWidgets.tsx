import { useEffect, useState } from "react";
import { getDeviceSummary, getWirelessSummary } from "@/api";
import { useAuth } from "@/auth/AuthContext";
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
  color
}: {
  siteId: string;
  deviceId: string;
  color?: string;
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
        const res = await getDeviceSummary(token, siteId, deviceId);
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
  }, [token, siteId, deviceId]);

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
    <div className="clusterCard" style={{ borderColor: accent }}>
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
  );
}
