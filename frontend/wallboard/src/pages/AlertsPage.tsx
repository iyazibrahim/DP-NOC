import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getRecentAlerts } from "../api";
import type { ActiveAlert } from "../types";

export function AlertsPage() {
  const { token } = useAuth();
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);

  useEffect(() => {
    if (!token) return;
    const load = () => getRecentAlerts(token, 100).then((r) => setAlerts(r.alerts));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [token]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Alerts</h1>
          <p className="pageSub">From Alertmanager</p>
        </div>
      </div>
      <table className="dataTable full">
        <thead>
          <tr>
            <th>Alert</th>
            <th>Site</th>
            <th>Device</th>
            <th>Status</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {alerts.length === 0 ? (
            <tr>
              <td colSpan={5}>No alerts</td>
            </tr>
          ) : (
            alerts.map((a, i) => (
              <tr key={i}>
                <td>{a.labels.alertname ?? a.labels.alert ?? "—"}</td>
                <td>{a.labels.site ?? "—"}</td>
                <td>{a.labels.device ?? "—"}</td>
                <td>{a.status}</td>
                <td>{a.annotations?.summary ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
