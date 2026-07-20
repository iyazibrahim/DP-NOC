import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  addSiteDevice,
  createSite,
  deleteSite,
  deleteSiteDevice,
  downloadSiteDevicesJson,
  getAllSiteStatuses,
  getSite,
  getSites,
  updateSite,
  updateSiteDevice
} from "../api";
import type { DeviceKind, Site, SiteDevice, SiteStatus } from "../types";
import { StatusPill } from "../components/StatusPill";
import { SiteLocationPicker } from "../components/SiteLocationPicker";

export function SitesPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [sites, setSites] = useState<Site[]>([]);
  const [statuses, setStatuses] = useState<SiteStatus[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    address: "",
    lat: 5.41,
    lng: 100.33
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!token) return;
    const [s, st] = await Promise.all([getSites(token), getAllSiteStatuses(token)]);
    setSites(s.sites);
    setStatuses(st.statuses);
  }

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [token]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createSite(token, createForm);
      setShowCreate(false);
      setCreateForm({ name: "", address: "", lat: 5.41, lng: 100.33 });
      await reload();
      navigate(`/sites/${res.site.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Sites</h1>
          <p className="pageSub">All monitored locations</p>
        </div>
        <div className="pageActions">
          <button type="button" className="primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Cancel" : "Add site"}
          </button>
        </div>
      </div>

      {error ? <div className="bannerError">{error}</div> : null}

      {showCreate ? (
        <form className="tableCard deviceForm" onSubmit={onCreate} style={{ marginBottom: 16 }}>
          <div className="tableTitle">New site</div>
          <label className="label">Name</label>
          <input
            value={createForm.name}
            onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <label className="label">Address</label>
          <input
            value={createForm.address}
            onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
          />
          <SiteLocationPicker
            lat={createForm.lat}
            lng={createForm.lng}
            onChange={(lat, lng) => setCreateForm((f) => ({ ...f, lat, lng }))}
          />
          <div className="formActions">
            <button className="primary" type="submit" disabled={busy}>
              Create site
            </button>
          </div>
        </form>
      ) : null}

      <table className="dataTable full">
        <thead>
          <tr>
            <th>Name</th>
            <th>Address</th>
            <th>Status</th>
            <th>WAN</th>
            <th>LAN</th>
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
                  <div className="muted">{s.id}</div>
                </td>
                <td>{s.address ?? "—"}</td>
                <td>
                  <StatusPill state={st?.overall ?? "unknown"} notes={st?.wan.notes} />
                </td>
                <td>{st?.wan.state ?? "—"}</td>
                <td>{st?.lan.state ?? "—"}</td>
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
  kind: "network" as DeviceKind,
  snmpIp: "",
  hostMetricId: "",
  vendor: "generic"
};

export function SiteDetailPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [site, setSite] = useState<Site | null>(null);
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [siteForm, setSiteForm] = useState({ name: "", address: "", notes: "", lat: 0, lng: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!token || !id) return;
    const [s, st] = await Promise.all([getSite(token, id), getAllSiteStatuses(token)]);
    setSite(s.site);
    setSiteForm({
      name: s.site.name,
      address: s.site.address ?? "",
      notes: s.site.notes ?? "",
      lat: s.site.lat,
      lng: s.site.lng
    });
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
      kind: d.kind ?? "network",
      snmpIp: d.snmpIp ?? "",
      hostMetricId: d.hostMetricId ?? d.id,
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
    if (!token || !id || !site) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        id: form.id || `${site.id}-nuc`,
        name: form.name,
        type: form.type,
        kind: form.kind,
        vendor: form.vendor,
        snmpIp: form.kind === "network" ? form.snmpIp : undefined,
        hostMetricId: form.kind === "server" ? form.hostMetricId || form.id : undefined
      };
      if (editingId) {
        await updateSiteDevice(token, id, editingId, payload);
      } else {
        await addSiteDevice(token, id, payload);
      }
      cancelEdit();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteDevice(deviceId: string) {
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

  async function onSaveSite(e: FormEvent) {
    e.preventDefault();
    if (!token || !id) return;
    setBusy(true);
    setError(null);
    try {
      await updateSite(token, id, siteForm);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteSite() {
    if (!token || !id || !site) return;
    if (!confirm(`Delete site "${site.name}" and all its devices?`)) return;
    setBusy(true);
    try {
      await deleteSite(token, id);
      navigate("/sites");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
    }
  }

  async function onDownloadDevices() {
    if (!token || !id || !site) return;
    try {
      const blob = await downloadSiteDevicesJson(token, id);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${site.id}-devices.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
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
        <StatusPill state={status?.overall ?? "unknown"} notes={status?.wan.notes} />
      </div>

      {error ? <div className="bannerError">{error}</div> : null}

      <div className="detailGrid">
        <div className="tableCard">
          <div className="tableTitle">Site details</div>
          <form className="deviceForm" onSubmit={onSaveSite}>
            <label className="label">Name</label>
            <input
              value={siteForm.name}
              onChange={(e) => setSiteForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <label className="label">Address</label>
            <input
              value={siteForm.address}
              onChange={(e) => setSiteForm((f) => ({ ...f, address: e.target.value }))}
            />
            <label className="label">Notes</label>
            <input
              value={siteForm.notes}
              onChange={(e) => setSiteForm((f) => ({ ...f, notes: e.target.value }))}
            />
            <SiteLocationPicker
              lat={siteForm.lat}
              lng={siteForm.lng}
              onChange={(lat, lng) => setSiteForm((f) => ({ ...f, lat, lng }))}
            />
            <div className="formActions">
              <button className="primary" type="submit" disabled={busy}>
                Save site
              </button>
              <button type="button" onClick={onDeleteSite} disabled={busy}>
                Delete site
              </button>
            </div>
          </form>
        </div>

        <div className="tableCard">
          <div className="tableTitle">Health</div>
          <div className="kvList">
            <div>WAN: {status?.wan.state ?? "unknown"}{status?.wan.notes ? ` — ${status.wan.notes}` : ""}</div>
            <div>LAN: {status?.lan.state ?? "unknown"}{status?.lan.notes ? ` — ${status.lan.notes}` : ""}</div>
            <div>Websites: {status?.websites.state ?? "unknown"}</div>
            <div>
              Alerts: {status?.alerts.firing ?? 0} firing / {status?.alerts.resolved ?? 0} resolved
            </div>
          </div>
        </div>

        <div className="tableCard">
          <div className="tableTitle">Devices</div>
          <p className="muted">
            Network devices export to Alloy <code>devices.json</code>. Server/NUC devices use host
            metrics — set <code>HOST_DEVICE_ID</code> on the NUC to match.
          </p>
          <div className="pageActions" style={{ marginBottom: 12 }}>
            <button type="button" onClick={onDownloadDevices}>
              Download devices.json (SNMP)
            </button>
          </div>
          <table className="dataTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Target</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(site.devices ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
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
                    <td>{d.kind}</td>
                    <td>{d.kind === "server" ? d.hostMetricId ?? d.id : d.snmpIp}</td>
                    <td>
                      <button type="button" onClick={() => startEdit(d)} disabled={busy}>
                        Edit
                      </button>{" "}
                      <button type="button" onClick={() => onDeleteDevice(d.id)} disabled={busy}>
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
            <label className="label">Kind</label>
            <select
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value as DeviceKind;
                setForm((f) => ({
                  ...f,
                  kind,
                  type: kind === "server" ? "server" : f.type,
                  id: f.id || (kind === "server" ? `${site.id}-nuc` : f.id),
                  hostMetricId: kind === "server" ? f.hostMetricId || `${site.id}-nuc` : f.hostMetricId
                }));
              }}
            >
              <option value="server">Server / NUC</option>
              <option value="network">Network (SNMP)</option>
            </select>
            {!editingId ? (
              <>
                <label className="label">ID</label>
                <input
                  value={form.id}
                  onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder={form.kind === "server" ? `${site.id}-nuc` : `${site.id}-sw1`}
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
              placeholder={form.kind === "server" ? "server" : "switch / router / firewall"}
              required
            />
            {form.kind === "network" ? (
              <>
                <label className="label">SNMP IP</label>
                <input
                  value={form.snmpIp}
                  onChange={(e) => setForm((f) => ({ ...f, snmpIp: e.target.value }))}
                  placeholder="192.168.1.1"
                  required
                />
              </>
            ) : (
              <>
                <label className="label">Host metric ID (Alloy HOST_DEVICE_ID)</label>
                <input
                  value={form.hostMetricId}
                  onChange={(e) => setForm((f) => ({ ...f, hostMetricId: e.target.value }))}
                  placeholder={`${site.id}-nuc`}
                  required
                />
              </>
            )}
            <label className="label">Vendor</label>
            <input
              value={form.vendor}
              onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
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
      </div>
      <p>
        <Link to="/sites">← Back to sites</Link>
      </p>
    </div>
  );
}
