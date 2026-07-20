import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  addDeviceType,
  addSiteDevice,
  addSiteWebsite,
  applyWebsiteProbes,
  createSite,
  deleteSite,
  deleteSiteDevice,
  deleteSiteWebsite,
  downloadSiteDevicesJson,
  getAllSiteStatuses,
  getDiscoveredDevices,
  getSite,
  getSites,
  updateSite,
  updateSiteDevice,
  updateSiteWebsite
} from "../api";
import type { DeviceKind, DiscoveredDevice, Site, SiteDevice, SiteStatus } from "../types";
import { StatusPill } from "../components/StatusPill";
import { SiteLocationPicker } from "../components/SiteLocationPicker";
import { DeviceTypePicker, useDeviceTypes, type DeviceTypeOption } from "../components/DeviceTypePicker";

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
  const { types: deviceTypes, setTypes: setDeviceTypes } = useDeviceTypes(token);
  const [websiteForm, setWebsiteForm] = useState({ name: "", url: "" });
  const [editingWebsiteUrl, setEditingWebsiteUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredDevice[]>([]);

  async function reload() {
    if (!token || !id) return;
    const [s, st, disc] = await Promise.all([
      getSite(token, id),
      getAllSiteStatuses(token),
      getDiscoveredDevices(token, id).catch(() => ({ devices: [] as DiscoveredDevice[] }))
    ]);
    setSite(s.site);
    setSiteForm({
      name: s.site.name,
      address: s.site.address ?? "",
      notes: s.site.notes ?? "",
      lat: s.site.lat,
      lng: s.site.lng
    });
    setStatus(st.statuses.find((x) => x.siteId === id) ?? null);
    setDiscovered(disc.devices);
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

  function suggestDeviceId(typeId: string, kind: DeviceKind) {
    if (kind === "server" && (typeId === "nuc" || typeId === "server")) {
      return `${site?.id ?? "site"}-nuc`;
    }
    const suffix = typeId === "switch" ? "sw1" : typeId === "router" ? "rt1" : typeId === "ap" ? "ap1" : `${typeId}1`;
    return `${site?.id ?? "site"}-${suffix}`;
  }

  function onSelectDeviceType(type: DeviceTypeOption) {
    const suggestedId = !editingId ? suggestDeviceId(type.id, type.kind) : form.id;
    setForm((f) => ({
      ...f,
      type: type.id,
      kind: type.kind,
      id: suggestedId,
      hostMetricId: type.kind === "server" ? suggestedId : f.hostMetricId
    }));
  }

  async function onAddCustomType(label: string, kind: DeviceKind) {
    if (!token) return;
    const res = await addDeviceType(token, { label, kind });
    setDeviceTypes(res.types);
    onSelectDeviceType(res.type);
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

  async function onRegisterDiscovered(d: DiscoveredDevice) {
    if (!token || !id) return;
    if (d.kind === "network") {
      setEditingId(null);
      setForm({
        id: d.deviceId,
        name: d.suggestedName,
        type: d.suggestedType,
        kind: "network",
        snmpIp: "",
        hostMetricId: "",
        vendor: "generic"
      });
      setMsg(`Discovered ${d.deviceId} — enter SNMP IP below and click Add device.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addSiteDevice(token, id, {
        id: d.deviceId,
        name: d.suggestedName,
        type: d.suggestedType,
        kind: d.kind,
        vendor: "generic",
        hostMetricId: d.deviceId
      });
      setMsg(`Registered ${d.deviceId}. LAN status should update on the next refresh.`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Register failed");
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

  async function onWebsiteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !id) return;
    setBusy(true);
    setError(null);
    try {
      if (editingWebsiteUrl) {
        await updateSiteWebsite(token, id, {
          url: editingWebsiteUrl,
          name: websiteForm.name,
          newUrl: websiteForm.url !== editingWebsiteUrl ? websiteForm.url : undefined
        });
      } else {
        await addSiteWebsite(token, id, websiteForm);
      }
      setWebsiteForm({ name: "", url: "" });
      setEditingWebsiteUrl(null);
      setMsg("Website saved. Click Apply probes to start HTTP checks.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Website save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteWebsite(url: string) {
    if (!token || !id) return;
    if (!confirm(`Remove website ${url}?`)) return;
    setBusy(true);
    try {
      await deleteSiteWebsite(token, id, url);
      if (editingWebsiteUrl === url) {
        setEditingWebsiteUrl(null);
        setWebsiteForm({ name: "", url: "" });
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function onApplyProbes() {
    if (!token || !id) return;
    setBusy(true);
    try {
      const res = await applyWebsiteProbes(token, id);
      setMsg(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
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
        <StatusPill state={status?.overall ?? "unknown"} notes={status?.wan.notes} />
      </div>

      {error ? <div className="bannerError">{error}</div> : null}
      {msg ? <p className="muted">{msg}</p> : null}

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
          <div className="tableTitle">Websites</div>
          <p className="muted">
            Public URLs probed from the central VPS via Blackbox HTTP. Add here, then{" "}
            <strong>Apply probes</strong> to register in Prometheus.
          </p>
          <div className="formActions" style={{ marginBottom: 12 }}>
            <button type="button" onClick={onApplyProbes} disabled={busy}>
              Apply probes to Prometheus
            </button>
          </div>
          <table className="dataTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(site.websiteTargets ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No websites — add one below (e.g. https://digitalpenang.gov.my)
                  </td>
                </tr>
              ) : (
                (site.websiteTargets ?? []).map((w) => (
                  <tr key={w.url}>
                    <td>{w.name}</td>
                    <td>{w.url}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingWebsiteUrl(w.url);
                          setWebsiteForm({ name: w.name, url: w.url });
                        }}
                        disabled={busy}
                      >
                        Edit
                      </button>{" "}
                      <button type="button" onClick={() => onDeleteWebsite(w.url)} disabled={busy}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <form className="deviceForm" onSubmit={onWebsiteSubmit}>
            <div className="tableTitle">{editingWebsiteUrl ? "Edit website" : "Add website"}</div>
            <label className="label">Display name</label>
            <input
              value={websiteForm.name}
              onChange={(e) => setWebsiteForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Main website"
            />
            <label className="label">URL</label>
            <input
              value={websiteForm.url}
              onChange={(e) => setWebsiteForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://example.com"
              required
            />
            <div className="formActions">
              <button className="primary" type="submit" disabled={busy}>
                {editingWebsiteUrl ? "Save website" : "Add website"}
              </button>
              {editingWebsiteUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingWebsiteUrl(null);
                    setWebsiteForm({ name: "", url: "" });
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </div>

        <div className="tableCard">
          <div className="tableTitle">Devices</div>
          <p className="muted">
            Network devices export to Alloy <code>devices.json</code>. Server/collector devices use
            host metrics — set <code>HOST_DEVICE_ID</code> on the collector so Grafana series are
            labeled with <code>device=&quot;&lt;HOST_DEVICE_ID&gt;&quot;</code>.
            <span className="muted" style={{ display: "block", marginTop: 6 }}>
              Example:{" "}
              <code>{`up{job="site_host",site="site-1",device="site-1-nuc"}`}</code>
            </span>
          </p>

          {discovered.filter((d) => !d.alreadyRegistered).length > 0 ? (
            <div className="discoveryBanner">
              <div className="discoveryBannerTitle">Discovered from Prometheus (not registered)</div>
              {discovered
                .filter((d) => !d.alreadyRegistered)
                .map((d) => (
                  <div key={d.deviceId} className="discoveryRow">
                    <div>
                      <strong>{d.suggestedName}</strong>
                      <div className="muted">
                        {d.deviceId} · {d.kind}
                        {d.lastSeen ? ` · seen ${new Date(d.lastSeen).toLocaleString()}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => onRegisterDiscovered(d)}
                      disabled={busy}
                    >
                      {d.kind === "server" ? "Register" : "Add details"}
                    </button>
                  </div>
                ))}
            </div>
          ) : null}

          <div className="pageActions" style={{ marginBottom: 12 }}>
            <button type="button" onClick={onDownloadDevices}>
              Download devices.json (SNMP)
            </button>
          </div>
          <p className="muted" style={{ marginBottom: 12 }}>
            After adding SNMP devices, download <code>devices.json</code>, copy it to the collector
            host, then run <code>generate-config.sh</code> and restart Alloy.
          </p>
          <table className="dataTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Type</th>
                <th>Target</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(site.devices ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No devices yet — use Discover above or add one below.
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
                    <td>
                      {deviceTypes.find((t) => t.id === d.type)?.label ?? d.type}
                    </td>
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

            <DeviceTypePicker
              types={deviceTypes}
              selectedTypeId={form.type}
              onSelectType={onSelectDeviceType}
              vendor={form.vendor}
              onVendorChange={(vendor) => setForm((f) => ({ ...f, vendor }))}
              onAddCustomType={onAddCustomType}
            />

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
            <label className="label">Display name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Core switch"
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
