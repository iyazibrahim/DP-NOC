import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getWebsitesSummary } from "../api";

export function WebsiteSummaryWidget({ compact }: { compact?: boolean }) {
  const { token } = useAuth();
  const [counts, setCounts] = useState({ healthy: 0, warning: 0, critical: 0, unknown: 0 });
  const [avgLatencyMs, setAvgLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getWebsitesSummary(token);
        if (cancelled) return;
        setCounts(res.counts);
        setAvgLatencyMs(res.avgLatencyMs);
      } catch {
        /* keep last good values */
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  return (
    <div className="widgetInner">
      {!compact ? <div className="widgetTitle">Website checks</div> : null}
      <div className="kvList">
        <div className="dotLine dotLine--healthy">Healthy: {counts.healthy}</div>
        <div className="dotLine dotLine--warning">Warning: {counts.warning}</div>
        <div className="dotLine dotLine--critical">Critical: {counts.critical}</div>
        <div className="dotLine dotLine--unknown">Unknown: {counts.unknown}</div>
        <div className="muted">
          Avg latency: {avgLatencyMs != null ? `${avgLatencyMs} ms` : "—"}
        </div>
      </div>
    </div>
  );
}
