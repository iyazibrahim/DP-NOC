import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  addDeviceType,
  addSiteDevice,
  addSiteWebsite,
  applyWebsiteProbes,
  clearCollectorToken,
  createSite,
  deleteSite,
  deleteSiteDevice,
  deleteSiteWebsite,
  downloadSiteDevicesJson,
  getAllSiteStatuses,
  getDiscoveredDevices,
  getSite,
  getSites,
  rotateCollectorToken,
  updateSite,
  updateSiteDevice,
  updateSiteWebsite
} from "../api";
import type { DeviceKind, DiscoveredDevice, Site, SiteDevice, SiteStatus } from "../types";
import { StatusPill } from "../components/StatusPill";
import { SiteLocationPicker } from "../components/SiteLocationPicker";
import { DeviceTypePicker, useDeviceTypes, type DeviceTypeOption } from "../components/DeviceTypePicker";
import { collectorOf, localDevicesOf, uplinkOf } from "../statusLabels";
import { Modal } from "../components/Modal";
import { SitesLeafletMap } from "../components/SitesLeafletMap";

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
            <th>Collector</th>
            <th>Uplink</th>
            <th>Local devices</th>
            <th>Devices</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => {
            const st = statuses.find((x) => x.siteId === s.id);
            const up = uplinkOf(st);
            const col = collectorOf(st);
            const loc = localDevicesOf(st);
            return (
              <tr key={s.id}>
                <td>
                  <Link to={`/sites/${s.id}`}>{s.name}</Link>
                  <div className="muted">{s.id}</div>
                </td>
                <td>{s.address ?? "—"}</td>
                <td>
                  <StatusPill state={st?.overall ?? "unknown"} notes={col.notes ?? up.notes} />
                </td>
                <td>
                  <StatusPill state={col.state} notes={col.notes} />
                </td>
                <td>
                  <StatusPill state={up.state} notes={up.notes} />
                </td>
                <td>
                  <StatusPill state={loc.state} notes={loc.notes} />
                </td>
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
  snmpCommunity: "",
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
  const [editSiteOpen, setEditSiteOpen] = useState(false);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [websiteModalOpen, setWebsiteModalOpen] = useState(false);
  const [revealedCollectorToken, setRevealedCollectorToken] = useState<string | null>(null);

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
      snmpCommunity: d.snmpCommunity ?? "",
      hostMetricId: d.hostMetricId ?? d.id,
      vendor: d.vendor
    });
    setError(null);
    setDeviceModalOpen(true);
  }

  function openAddDevice() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setDeviceModalOpen(true);
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
    setDeviceModalOpen(false);
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
        snmpCommunity:
          form.kind === "network" && form.snmpCommunity.trim()
            ? form.snmpCommunity.trim()
            : form.kind === "network"
              ? ""
              : undefined,
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
        snmpCommunity: "",
        hostMetricId: "",
        vendor: "generic"
      });
      setMsg(`Discovered ${d.deviceId} — enter SNMP IP and save.`);
      setDeviceModalOpen(true);
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
      setEditSiteOpen(false);
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
      setWebsiteModalOpen(false);
      setMsg("Website saved. Click Save and start checking to activate probes.");
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

  const pendingDisc = discovered.filter((d) => !d.alreadyRegistered);
  const col = collectorOf(status);
  const up = uplinkOf(status);
  const loc = localDevicesOf(status);
  const web = status?.websites ?? { state: "unknown" as const };

  function openAddWebsite() {
    setEditingWebsiteUrl(null);
    setWebsiteForm({ name: "", url: "" });
    setWebsiteModalOpen(true);
  }

  function openEditWebsite(w: { name: string; url: string }) {
    setEditingWebsiteUrl(w.url);
    setWebsiteForm({ name: w.name, url: w.url });
    setWebsiteModalOpen(true);
  }

  async function onRotateCollectorToken() {
    if (!token || !id) return;
    if (
      site?.hasCollectorToken &&
      !confirm("Generate a new token? The previous token on the collector will stop working.")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await rotateCollectorToken(token, id);
      setSite(res.site);
      setRevealedCollectorToken(res.token);
      setMsg("Collector token generated — copy it into the site box .env as COLLECTOR_TOKEN.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Token generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function onClearCollectorToken() {
    if (!token || !id) return;
    if (!confirm("Remove collector sync token? Inventory pull will stop until a new token is set.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await clearCollectorToken(token, id);
      setSite(res.site);
      setRevealedCollectorToken(null);
      setMsg("Collector token cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <p className="pageEyebrow">
            <Link to="/sites">Sites</Link>
            <span aria-hidden> / </span>
            {site.id}
          </p>
          <h1>{site.name}</h1>
          {site.address ? <p className="pageSub">{site.address}</p> : null}
        </div>
        <div className="pageActions">
          <StatusPill
            state={status?.overall ?? "unknown"}
            notes={col.notes ?? up.notes}
          />
          <button type="button" onClick={() => setEditSiteOpen(true)}>
            Edit site
          </button>
        </div>
      </div>

      {error ? <div className="bannerError">{error}</div> : null}
      {msg ? <p className="muted">{msg}</p> : null}

      <div className="siteBento">
        <section className="bentoTile bentoHealth">
          <div className="bentoTileHeader">
            <div className="tableTitle">Health</div>
            <div className="formActions">
              <button type="button" onClick={() => setEditSiteOpen(true)}>
                Edit details
              </button>
              <button type="button" onClick={onDeleteSite} disabled={busy}>
                Delete site
              </button>
            </div>
          </div>
          <div className="healthMiniGrid">
            <div className={`healthMini healthMini--${col.state}`}>
              <span className="healthMiniLabel">Collector</span>
              <strong>{col.state}</strong>
              {col.notes ? <span className="muted">{col.notes}</span> : null}
            </div>
            <div className={`healthMini healthMini--${up.state}`}>
              <span className="healthMiniLabel">Uplink</span>
              <strong>{up.state}</strong>
              {up.notes ? <span className="muted">{up.notes}</span> : null}
            </div>
            <div className={`healthMini healthMini--${loc.state}`}>
              <span className="healthMiniLabel">Local devices</span>
              <strong>{loc.state}</strong>
              {loc.notes ? <span className="muted">{loc.notes}</span> : null}
            </div>
            <div className={`healthMini healthMini--${web.state}`}>
              <span className="healthMiniLabel">Websites</span>
              <strong>{web.state}</strong>
              {web.notes ? <span className="muted">{web.notes}</span> : null}
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Alerts: {status?.alerts.firing ?? 0} firing / {status?.alerts.resolved ?? 0} resolved
            {site.notes?.trim() ? ` · ${site.notes.trim()}` : ""}
          </p>
        </section>

        <section className="bentoTile bentoMap">
          <div className="tableTitle">Location</div>
          <div className="bentoMapFrame">
            <SitesLeafletMap
              key={`site-map-${site.id}`}
              sites={[site]}
              statuses={status ? [status] : []}
              height="100%"
              selectedSiteId={site.id}
            />
          </div>
          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            {site.lat.toFixed(5)}, {site.lng.toFixed(5)}
            {site.address ? ` · ${site.address}` : ""}
          </p>
        </section>

        <section className="bentoTile bentoDevices">
          <div className="bentoTileHeader">
            <div className="tableTitle">Devices</div>
            <div className="formActions">
              <button type="button" className="primary" onClick={openAddDevice}>
                Add device
              </button>
              <button type="button" onClick={onDownloadDevices}>
                Download devices.json
              </button>
            </div>
          </div>

          {pendingDisc.length > 0 ? (
            <div className="discoveryBanner">
              <div className="discoveryBannerTitle">New devices found</div>
              {pendingDisc.map((d) => (
                <div key={d.deviceId} className="discoveryRow">
                  <div>
                    <strong>{d.suggestedName}</strong>
                    <div className="muted">
                      {d.deviceId} · {d.kind === "server" ? "Collector" : "Local device"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onRegisterDiscovered(d)}
                    disabled={busy}
                  >
                    {d.kind === "server" ? "Add collector" : "Add details"}
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <table className="dataTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Type</th>
                <th>Target</th>
                <th>SNMP</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(site.devices ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No devices yet — add a collector or local device. Network devices need an SNMP IP
                    so the site collector can poll them.
                  </td>
                </tr>
              ) : (
                (site.devices ?? []).map((d) => {
                  const snmpRow =
                    d.kind === "network"
                      ? status?.localDeviceStates?.find((x) => x.deviceId === d.id)
                      : undefined;
                  return (
                    <tr key={d.id}>
                      <td>
                        {d.name}
                        <div className="muted">{d.id}</div>
                      </td>
                      <td>{d.kind}</td>
                      <td>{deviceTypes.find((t) => t.id === d.type)?.label ?? d.type}</td>
                      <td>
                        {d.kind === "server" ? d.hostMetricId ?? d.id : d.snmpIp ?? "—"}
                        {d.kind === "network" && !d.snmpIp ? (
                          <div className="muted">Needs SNMP IP</div>
                        ) : null}
                      </td>
                      <td>
                        {d.kind === "network" ? (
                          <StatusPill
                            state={snmpRow?.state ?? "unknown"}
                            notes={
                              snmpRow?.notes ??
                              (!d.snmpIp
                                ? "Needs SNMP IP"
                                : "Waiting for collector SNMP scrape")
                            }
                          />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <button type="button" onClick={() => startEdit(d)} disabled={busy}>
                          Edit
                        </button>{" "}
                        <button type="button" onClick={() => onDeleteDevice(d.id)} disabled={busy}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 10 }}>
            Network inventory syncs to the site collector automatically when the Collector Console is
            configured and running (typically every 90 seconds).
          </p>

          <div className="collectorSyncPanel" style={{ marginTop: 16 }}>
            <div className="tableTitle">Collector inventory sync</div>
            <p className="muted">
              {site.hasCollectorToken
                ? "Token configured. Open the Collector Console on the site box (http://<collector-ip>:8090) to add SNMP devices and sync. Devices added there appear here automatically."
                : "Generate a token so this site’s Alloy box can pull SNMP targets from the UI."}
            </p>
            {site.collectorDevicesSyncedAt ? (
              <p className="muted">
                Last collector pull: {new Date(site.collectorDevicesSyncedAt).toLocaleString()}
              </p>
            ) : (
              <p className="muted">No successful collector pull yet.</p>
            )}
            {revealedCollectorToken ? (
              <div className="bannerHint" style={{ marginTop: 8 }}>
                <strong>Copy now (shown once):</strong>
                <code style={{ display: "block", marginTop: 6, wordBreak: "break-all" }}>
                  {revealedCollectorToken}
                </code>
              </div>
            ) : null}
            <div className="formActions" style={{ marginTop: 10 }}>
              <button type="button" className="primary" onClick={onRotateCollectorToken} disabled={busy}>
                {site.hasCollectorToken ? "Rotate token" : "Generate token"}
              </button>
              {site.hasCollectorToken ? (
                <button type="button" onClick={onClearCollectorToken} disabled={busy}>
                  Clear token
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="bentoTile bentoWebsites">
          <div className="bentoTileHeader">
            <div className="tableTitle">Website checks</div>
            <div className="formActions">
              <button type="button" className="primary" onClick={openAddWebsite}>
                Add website
              </button>
              <button type="button" onClick={onApplyProbes} disabled={busy}>
                Save and start checking
              </button>
            </div>
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
                    No websites yet — optional public URL checks from the central server.
                  </td>
                </tr>
              ) : (
                (site.websiteTargets ?? []).map((w) => (
                  <tr key={w.url}>
                    <td>{w.name}</td>
                    <td>{w.url}</td>
                    <td>
                      <button type="button" onClick={() => openEditWebsite(w)} disabled={busy}>
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
        </section>
      </div>

      <Modal open={editSiteOpen} title="Edit site" onClose={() => setEditSiteOpen(false)} wide>
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
            <button type="button" onClick={() => setEditSiteOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={deviceModalOpen}
        title={editingId ? `Edit ${editingId}` : "Add device"}
        onClose={cancelEdit}
        wide
      >
        <form className="deviceForm" onSubmit={onSubmit}>
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
              <label className="label">SNMP community (optional)</label>
              <input
                value={form.snmpCommunity}
                onChange={(e) => setForm((f) => ({ ...f, snmpCommunity: e.target.value }))}
                placeholder="Leave blank to use collector default"
                autoComplete="off"
              />
              <p className="hint" style={{ marginTop: 4 }}>
                Per-device SNMPv2c string. Blank = Collector Console default community.
              </p>
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
            <button type="button" onClick={cancelEdit} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={websiteModalOpen}
        title={editingWebsiteUrl ? "Edit website" : "Add website"}
        onClose={() => {
          setWebsiteModalOpen(false);
          setEditingWebsiteUrl(null);
          setWebsiteForm({ name: "", url: "" });
        }}
      >
        <form className="deviceForm" onSubmit={onWebsiteSubmit}>
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
            <button
              type="button"
              onClick={() => {
                setWebsiteModalOpen(false);
                setEditingWebsiteUrl(null);
                setWebsiteForm({ name: "", url: "" });
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
