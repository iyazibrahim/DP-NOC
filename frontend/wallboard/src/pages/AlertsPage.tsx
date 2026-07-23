import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  acknowledgeIncident,
  getIncidents,
  getRecentAlerts,
  STATUS_POLL_MS,
  type NocIncident
} from "../api";
import type { ActiveAlert } from "../types";
import { StatusPill } from "../components/StatusPill";

function incidentStatusLabel(i: NocIncident) {
  if (i.acknowledgedAt) return "acked";
  if (i.resolvedAt) return "resolved — pending ack";
  return "firing";
}

function formatWhen(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AlertsPage() {
  const { token } = useAuth();
  const [open, setOpen] = useState<NocIncident[]>([]);
  const [history, setHistory] = useState<NocIncident[]>([]);
  const [amAlerts, setAmAlerts] = useState<ActiveAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    if (!token) return;
    const [inc, al] = await Promise.all([getIncidents(token), getRecentAlerts(token, 100)]);
    setOpen(inc.open ?? []);
    setHistory(inc.history ?? []);
    setAmAlerts(al.alerts ?? []);
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        await reload();
        if (!cancelled) setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const t = setInterval(load, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  async function onAck(id: string) {
    if (!token) return;
    setBusyId(id);
    try {
      await acknowledgeIncident(token, id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Acknowledge failed");
    } finally {
      setBusyId(null);
    }
  }

  const firingAm = amAlerts.filter((a) => a.status === "firing");
  const pendingAck = open.filter((i) => i.resolvedAt).length;

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Alerts</h1>
          <p className="pageSub">
            Incidents stay until you acknowledge them — even after the site recovers
          </p>
        </div>
      </div>

      {error ? <div className="bannerError">{error}</div> : null}

      <div className="healthStrip" style={{ marginBottom: 14 }}>
        <div className="healthChip">
          <span className="healthChipLabel">Open incidents</span>
          <strong>{open.length}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Pending ack (recovered)</span>
          <strong>{pendingAck}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Alertmanager firing</span>
          <strong>{firingAm.length}</strong>
        </div>
      </div>

      <div className="tableCard" style={{ marginBottom: 14 }}>
        <div className="tableTitle">Open incidents</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Acknowledge to clear from this list. Recovered incidents stay here until you ack them.
        </p>
        <table className="dataTable">
          <thead>
            <tr>
              <th>Problem</th>
              <th>Site</th>
              <th>Status</th>
              <th>Detail</th>
              <th>Opened</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {open.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No open incidents.
                </td>
              </tr>
            ) : (
              open.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>
                    {r.siteId === "global" ? (
                      r.siteName
                    ) : (
                      <Link to={`/sites/${r.siteId}`}>{r.siteName}</Link>
                    )}
                  </td>
                  <td>
                    {r.resolvedAt ? (
                      <span className="muted">{incidentStatusLabel(r)}</span>
                    ) : (
                      <StatusPill state="critical" />
                    )}
                  </td>
                  <td>{r.detail}</td>
                  <td>{formatWhen(r.openedAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="primary"
                      disabled={busyId === r.id}
                      onClick={() => onAck(r.id)}
                    >
                      Acknowledge
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="tableCard" style={{ marginBottom: 14 }}>
        <div className="tableTitle">History</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Acknowledged incidents (last 30 days, up to 200).
        </p>
        <table className="dataTable">
          <thead>
            <tr>
              <th>Problem</th>
              <th>Site</th>
              <th>Opened</th>
              <th>Resolved</th>
              <th>Acknowledged</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No acknowledged incidents yet.
                </td>
              </tr>
            ) : (
              history.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>
                    {r.siteId === "global" ? (
                      r.siteName
                    ) : (
                      <Link to={`/sites/${r.siteId}`}>{r.siteName}</Link>
                    )}
                  </td>
                  <td>{formatWhen(r.openedAt)}</td>
                  <td>{formatWhen(r.resolvedAt)}</td>
                  <td>{formatWhen(r.acknowledgedAt)}</td>
                  <td>{r.acknowledgedBy ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="tableCard">
        <div className="tableTitle">Alertmanager</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Live Prometheus rules feed (Telegram / email). Use Open incidents above to acknowledge
          operator work.
        </p>
        <table className="dataTable">
          <thead>
            <tr>
              <th>Alert</th>
              <th>Site</th>
              <th>Status</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {amAlerts.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No Alertmanager alerts.
                </td>
              </tr>
            ) : (
              amAlerts.map((a, i) => {
                const siteId = a.labels?.site ?? "";
                return (
                  <tr key={`${a.labels?.alertname}-${siteId}-${a.startsAt ?? i}`}>
                    <td>{a.labels?.alertname ?? "Alert"}</td>
                    <td>
                      {siteId ? <Link to={`/sites/${siteId}`}>{siteId}</Link> : "—"}
                    </td>
                    <td>{a.status}</td>
                    <td>{a.annotations?.summary ?? "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
