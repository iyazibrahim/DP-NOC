import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  addSiteDevice,
  deleteSiteDevice,
  getAllSiteStatuses,
  getSite,
  getSites,
  updateSiteDevice
} from "../api";
import type { Site, SiteDevice, SiteStatus } from "../types";
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

const emptyForm = {
  id: "",
  name: "",
  type: "switch",
  snmpIp: "",
  vendor: "generic"
};

export function SiteDetailPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const [site, setSite] = useState<Site | null>(null);
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!token || !id) return;
    const [s, st] = await Promise.all([getSite(token, id), getAllSiteStatuses(token)]);
    setSite(s.site);
    setStatus(st.statuses.find((x) => x.siteId === id) ?? null);
  }

  useEffect(() => {
    if (!token || !id) return;
    reload().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [token, id]);

  function startEdit(d: SiteDevice) {
    setEditingId(d.id);
    setForm({
      id: d.id,
      name: d.name,
      type: d.type,
      snmpIp: d.snmpIp,
      vendor: d.vendor
    });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !id) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await updateSiteDevice(token, id, editingId, {
          name: form.name,
          type: form.type,
          snmpIp: form.snmpIp,
          vendor: form.vendor
        });
      } else {
        await addSiteDevice(token, id, {
          id: form.id,
          name: form.name,
          type: form.type,
          snmpIp: form.snmpIp,
          vendor: form.vendor
        });
      }
      cancelEdit();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(deviceId: string) {
    if (!token || !id) return;
    if (!confirm(`Remove device ${deviceId}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSiteDevice(token, id, deviceId);
      if (editingId === deviceId) cancelEdit();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

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
          <p className="muted">
            Registry for the NOC UI. After changes, update the site Alloy{" "}
            <code>devices.json</code> and re-run <code>generate-config.sh</code> /{" "}
            <code>deploy.sh</code> on the NUC.
          </p>
          {error ? <div className="bannerError">{error}</div> : null}
          <table className="dataTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>IP</th>
                <th>Vendor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(site.devices ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No devices yet — add one below.
                  </td>
                </tr>
              ) : (
                (site.devices ?? []).map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.name}
                      <div className="muted">{d.id}</div>
                    </td>
                    <td>{d.type}</td>
                    <td>{d.snmpIp}</td>
                    <td>{d.vendor}</td>
                    <td>
                      <button type="button" onClick={() => startEdit(d)} disabled={busy}>
                        Edit
                      </button>{" "}
                      <button type="button" onClick={() => onDelete(d.id)} disabled={busy}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <form className="deviceForm" onSubmit={onSubmit}>
            <div className="tableTitle">{editingId ? `Edit ${editingId}` : "Add device"}</div>
            {!editingId ? (
              <>
                <label className="label">ID</label>
                <input
                  value={form.id}
                  onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder={`${site.id}-sw1`}
                  required
                />
              </>
            ) : null}
            <label className="label">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <label className="label">Type</label>
            <input
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              placeholder="switch / router / firewall / ap"
              required
            />
            <label className="label">SNMP IP</label>
            <input
              value={form.snmpIp}
              onChange={(e) => setForm((f) => ({ ...f, snmpIp: e.target.value }))}
              placeholder="192.168.1.1"
              required
            />
            <label className="label">Vendor</label>
            <input
              value={form.vendor}
              onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
              placeholder="generic / cisco / mikrotik / ubiquiti"
              required
            />
            <div className="formActions">
              <button className="primary" type="submit" disabled={busy}>
                {editingId ? "Save" : "Add device"}
              </button>
              {editingId ? (
                <button type="button" onClick={cancelEdit} disabled={busy}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </div>
        <div className="tableCard">
          <div className="tableTitle">Websites</div>
          {(site.websiteTargets ?? []).length === 0 ? (
            <p className="muted">No website targets configured.</p>
          ) : (
            <ul className="alertUl">
              {site.websiteTargets.map((w) => (
                <li key={w.url}>
                  {w.name}: {w.url}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p>
        <Link to="/sites">← Back to sites</Link>
      </p>
    </div>
  );
}
