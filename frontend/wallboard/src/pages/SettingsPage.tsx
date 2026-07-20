import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getSettings, resetDashboardLayout } from "../api";

export function SettingsPage() {
  const { token } = useAuth();
  const [grafanaUrl, setGrafanaUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then((s) => setGrafanaUrl(s.grafanaPublicUrl));
  }, []);

  const reset = async () => {
    if (!token) return;
    await resetDashboardLayout(token);
    setMsg("Dashboard layout reset to default.");
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Settings</h1>
          <p className="pageSub">NOC app configuration</p>
        </div>
      </div>
      <div className="tableCard" style={{ maxWidth: 520 }}>
        <div className="tableTitle">Integrations</div>
        <div className="kvList">
          <div>
            <strong>Grafana public URL</strong>
            <div className="muted">{grafanaUrl || "—"}</div>
            <div className="muted">Set via GRAFANA_PUBLIC_URL on noc-app.</div>
          </div>
        </div>
        <div className="pageActions" style={{ marginTop: 16 }}>
          <button type="button" onClick={reset}>
            Reset my dashboard layout
          </button>
        </div>
        {msg && <p className="muted">{msg}</p>}
      </div>
    </div>
  );
}
