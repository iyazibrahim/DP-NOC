import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getIncidents, type NocIncident } from "../api";

export function AlertsIncidentsWidget({ compact }: { compact?: boolean }) {
  const { token } = useAuth();
  const [open, setOpen] = useState<NocIncident[]>([]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getIncidents(token);
        if (!cancelled) setOpen((res.open ?? []).slice(0, 20));
      } catch {
        /* keep last */
      }
    };
    load();
    const t = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  return (
    <div className="widgetInner widgetInnerScroll">
      {!compact ? <div className="widgetTitle">Open incidents</div> : null}
      {open.length === 0 ? (
        <div className="muted">No open incidents</div>
      ) : (
        <ul className="alertUl">
          {open.map((a) => (
            <li key={a.id}>
              <strong>{a.title}</strong> · {a.siteName}
              {a.resolvedAt ? <span className="muted"> (recovered — ack needed)</span> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="muted" style={{ marginTop: 8 }}>
        <Link to="/alerts">View alerts</Link>
      </div>
    </div>
  );
}
