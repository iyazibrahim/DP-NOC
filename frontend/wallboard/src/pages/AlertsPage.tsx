import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import {
  acknowledgeIncident,
  getIncidents,
  getRecentAlerts,
  STATUS_POLL_MS,
  type NocIncident
} from "@/api";
import type { ActiveAlert } from "@/types";
import { StatusPill } from "@/components/StatusPill";
import { PageHeader } from "@/components/noc/PageHeader";
import { TablePagination, paginateItems } from "@/components/TableControls";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

function incidentStatusLabel(i: NocIncident) {
  if (i.acknowledgedAt) return "Acked";
  if (i.resolvedAt) return "Needs ack";
  return "Active";
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
  const [openPage, setOpenPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [alertPage, setAlertPage] = useState(1);

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
  const openPager = useMemo(() => paginateItems(open, openPage), [open, openPage]);
  const historyPager = useMemo(() => paginateItems(history, historyPage), [history, historyPage]);
  const alertPager = useMemo(() => paginateItems(amAlerts, alertPage), [amAlerts, alertPage]);

  useEffect(() => {
    if (openPage !== openPager.page) setOpenPage(openPager.page);
  }, [openPage, openPager.page]);
  useEffect(() => {
    if (historyPage !== historyPager.page) setHistoryPage(historyPager.page);
  }, [historyPage, historyPager.page]);
  useEffect(() => {
    if (alertPage !== alertPager.page) setAlertPage(alertPager.page);
  }, [alertPage, alertPager.page]);

  return (
    <div className="page">
      <PageHeader
        title="Alerts"
        subtitle="Acknowledge clears open incidents — it does not change site health"
      />

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="healthStrip" style={{ marginBottom: 14 }}>
        <div className="healthChip">
          <span className="healthChipLabel">Open incidents</span>
          <strong>{open.length}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Needs ack</span>
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
          Acknowledge clears this list (does not fix the site). If still down, it stays cleared until
          the site recovers — then a new outage can open again. Recovered incidents also stay here
          until you ack them.
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
              openPager.slice.map((r) => (
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
                    <Button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => onAck(r.id)}
                    >
                      Acknowledge
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {open.length > 0 ? (
          <TablePagination
            page={openPager.page}
            totalPages={openPager.totalPages}
            total={openPager.total}
            start={openPager.start}
            end={openPager.end}
            onPageChange={setOpenPage}
          />
        ) : null}
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
              historyPager.slice.map((r) => (
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
        {history.length > 0 ? (
          <TablePagination
            page={historyPager.page}
            totalPages={historyPager.totalPages}
            total={historyPager.total}
            start={historyPager.start}
            end={historyPager.end}
            onPageChange={setHistoryPage}
          />
        ) : null}
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
              alertPager.slice.map((a, i) => {
                const siteId = a.labels?.site ?? "";
                return (
                  <tr key={`${a.labels?.alertname}-${siteId}-${a.startsAt ?? i}`}>
                    <td>{a.labels?.alertname ?? "Alert"}</td>
                    <td>
                      {siteId ? <Link to={`/sites/${siteId}`}>{siteId}</Link> : "—"}
                    </td>
                    <td>{typeof a.status === "string" ? a.status : "firing"}</td>
                    <td>{a.annotations?.summary ?? "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {amAlerts.length > 0 ? (
          <TablePagination
            page={alertPager.page}
            totalPages={alertPager.totalPages}
            total={alertPager.total}
            start={alertPager.start}
            end={alertPager.end}
            onPageChange={setAlertPage}
          />
        ) : null}
      </div>
    </div>
  );
}
