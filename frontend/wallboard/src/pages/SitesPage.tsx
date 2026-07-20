import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getAllSiteStatuses, getSite, getSites } from "../api";
import type { Site, SiteStatus } from "../types";
import { StatusPill } from "../components/StatusPill";

export function SitesPage() {
  const { token } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [statuses, setStatuses] = useState<SiteStatus[]>([]);

  useEffect(() => {
    if (!token) return;
    Promise.all([getSites(token), getAllSiteStatuses(token)]).then(([s, st]) => {
      setSites(s.sites);
      setStatuses(st.statuses);
    });
  }, [token]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Sites</h1>
          <p className="pageSub">All monitored locations</p>
        </div>
      </div>
      <table className="dataTable full">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>WAN</th>
            <th>LAN</th>
            <th>Web</th>
            <th>Devices</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => {
            const st = statuses.find((x) => x.siteId === s.id);
            return (
              <tr key={s.id}>
                <td>
                  <Link to={`/sites/${s.id}`}>{s.name}</Link>
                </td>
                <td>
                  <StatusPill state={st?.overall ?? "unknown"} />
                </td>
                <td>{st?.wan.state ?? "—"}</td>
                <td>{st?.lan.state ?? "—"}</td>
                <td>{st?.websites.state ?? "—"}</td>
                <td>{s.devices?.length ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SiteDetailPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const [site, setSite] = useState<Site | null>(null);
  const [status, setStatus] = useState<SiteStatus | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    Promise.all([getSite(token, id), getAllSiteStatuses(token)]).then(([s, st]) => {
      setSite(s.site);
      setStatus(st.statuses.find((x) => x.siteId === id) ?? null);
    });
  }, [token, id]);

  if (!site) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>{site.name}</h1>
          <p className="pageSub">{site.id}</p>
        </div>
        <StatusPill state={status?.overall ?? "unknown"} />
      </div>
      <div className="detailGrid">
        <div className="tableCard">
          <div className="tableTitle">Health</div>
          <div className="kvList">
            <div>WAN: {status?.wan.state ?? "unknown"}</div>
            <div>LAN/SNMP: {status?.lan.state ?? "unknown"}</div>
            <div>Websites: {status?.websites.state ?? "unknown"}</div>
            <div>
              Alerts: {status?.alerts.firing ?? 0} firing / {status?.alerts.resolved ?? 0} resolved
            </div>
          </div>
        </div>
        <div className="tableCard">
          <div className="tableTitle">Devices</div>
          <table className="dataTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>IP</th>
                <th>Vendor</th>
              </tr>
            </thead>
            <tbody>
              {(site.devices ?? []).map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.type}</td>
                  <td>{d.snmpIp}</td>
                  <td>{d.vendor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tableCard">
          <div className="tableTitle">Websites</div>
          <ul className="alertUl">
            {site.websiteTargets.map((w) => (
              <li key={w.url}>
                {w.name}: {w.url}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p>
        <Link to="/sites">← Back to sites</Link>
      </p>
    </div>
  );
}
