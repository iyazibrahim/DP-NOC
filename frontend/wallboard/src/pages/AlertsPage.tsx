import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getAllSiteStatuses, getRecentAlerts, getSites, STATUS_POLL_MS } from "../api";
import type { ActiveAlert, Site, SiteStatus } from "../types";
import { collectorOf, uplinkOf } from "../statusLabels";
import { StatusPill } from "../components/StatusPill";

type IncidentRow = {
  id: string;
  source: "status" | "alertmanager";
  name: string;
  siteId: string;
  siteName: string;
  status: string;
  summary: string;
};

function buildStatusIncidents(sites: Site[], statuses: SiteStatus[]): IncidentRow[] {
  const rows: IncidentRow[] = [];
  for (const st of statuses) {
    const site = sites.find((s) => s.id === st.siteId);
    const siteName = site?.name ?? st.siteId;
    const up = uplinkOf(st);
    const col = collectorOf(st);
    if (up.state === "critical") {
      rows.push({
        id: `uplink-${st.siteId}`,
        source: "status",
        name: "Internet / uplink DOWN",
        siteId: st.siteId,
        siteName,
        status: "firing",
        summary: up.notes ?? "Uplink critical"
      });
    }
    if (col.state === "critical") {
      rows.push({
        id: `collector-${st.siteId}`,
        source: "status",
        name: "Collector offline",
        siteId: st.siteId,
        siteName,
        status: "firing",
        summary: col.notes ?? "Collector critical"
      });
    }
    if (
      st.overall === "critical" &&
      up.state !== "critical" &&
      col.state !== "critical"
    ) {
      rows.push({
        id: `site-${st.siteId}`,
        source: "status",
        name: "Site DOWN",
        siteId: st.siteId,
        siteName,
        status: "firing",
        summary: "Overall site health critical"
      });
    }
  }
  return rows;
}

export function AlertsPage() {
  const { token } = useAuth();
  const [amAlerts, setAmAlerts] = useState<ActiveAlert[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [statuses, setStatuses] = useState<SiteStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [al, s, st] = await Promise.all([
          getRecentAlerts(token, 100),
          getSites(token),
          getAllSiteStatuses(token)
        ]);
        if (cancelled) return;
        setAmAlerts(al.alerts ?? []);
        setSites(s.sites);
        setStatuses(st.statuses);
        setError(null);
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

  const statusIncidents = useMemo(
    () => buildStatusIncidents(sites, statuses),
    [sites, statuses]
  );

  const amRows: IncidentRow[] = amAlerts.map((a, i) => {
    const siteId = a.labels?.site ?? "";
    return {
      id: `am-${a.labels?.alertname ?? i}-${siteId}-${a.startsAt ?? i}`,
      source: "alertmanager" as const,
      name: a.labels?.alertname ?? a.labels?.alert ?? "Alert",
      siteId,
      siteName: sites.find((s) => s.id === siteId)?.name ?? (siteId || "—"),
      status: a.status,
      summary: a.annotations?.summary ?? "—"
    };
  });

  const firingAm = amRows.filter((r) => r.status === "firing");
  const resolvedAm = amRows.filter((r) => r.status === "resolved");

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Alerts</h1>
          <p className="pageSub">
            Live site problems from status (same as dashboard toasts) plus Alertmanager rules
          </p>
        </div>
      </div>

      {error ? <div className="bannerError">{error}</div> : null}

      <div className="healthStrip" style={{ marginBottom: 14 }}>
        <div className="healthChip">
          <span className="healthChipLabel">Live incidents</span>
          <strong>{statusIncidents.length}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Alertmanager firing</span>
          <strong>{firingAm.length}</strong>
        </div>
      </div>

      <div className="tableCard" style={{ marginBottom: 14 }}>
        <div className="tableTitle">Live site incidents</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          From the status API (~30–60s). Dashboard toasts use this same signal — not Telegram until
          Alertmanager rules fire.
        </p>
        <table className="dataTable">
          <thead>
            <tr>
              <th>Problem</th>
              <th>Site</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {statusIncidents.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No live incidents — all monitored sites look healthy or unknown.
                </td>
              </tr>
            ) : (
              statusIncidents.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    <Link to={`/sites/${r.siteId}`}>{r.siteName}</Link>
                  </td>
                  <td>
                    <StatusPill state="critical" />
                  </td>
                  <td>{r.summary}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="tableCard">
        <div className="tableTitle">Alertmanager</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Prometheus rules (silence / probe down). Needs rules deployed and Prometheus + Alertmanager
          running. Empty here while live incidents show above means rules have not fired yet (or AM is
          unreachable).
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
            {amRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No Alertmanager alerts. After a collector stop, expect SiteUplinkDown /
                  SiteCollectorDown within ~60s once rules are loaded.
                </td>
              </tr>
            ) : (
              [...firingAm, ...resolvedAm].map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    {r.siteId ? <Link to={`/sites/${r.siteId}`}>{r.siteName}</Link> : r.siteName}
                  </td>
                  <td>{r.status}</td>
                  <td>{r.summary}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
