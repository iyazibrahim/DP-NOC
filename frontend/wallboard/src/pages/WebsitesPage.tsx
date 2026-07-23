import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  addSiteWebsite,
  applyWebsiteProbes,
  deleteSiteWebsite,
  getSites,
  getWebsites,
  updateSiteWebsite
} from "../api";
import { StatusPill } from "../components/StatusPill";
import { Modal } from "../components/Modal";
import type { Site } from "../types";

type WebsiteRow = {
  siteId: string;
  siteName: string;
  name: string;
  url: string;
  state: string;
  notes?: string;
  latencyMs?: number | null;
  uptime24h?: number | null;
  sparkline?: number[];
};

function UptimeSparkline({ values }: { values?: number[] }) {
  const pts = values?.length ? values : [];
  if (pts.length < 2) {
    return <span className="muted">—</span>;
  }
  const w = 72;
  const h = 22;
  const max = 1;
  const min = 0;
  const step = w / (pts.length - 1);
  const d = pts
    .map((v, i) => {
      const x = i * step;
      const y = h - ((Math.max(min, Math.min(max, v)) - min) / (max - min || 1)) * (h - 2) - 1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="uptimeSparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

export function WebsitesPage() {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<WebsiteRow[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [form, setForm] = useState({ siteId: "", name: "", url: "" });
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!token) return;
    const [w, s] = await Promise.all([getWebsites(token), getSites(token)]);
    setRows(w.websites);
    setSites(s.sites);
    const querySiteId = searchParams.get("siteId");
    const preferred =
      querySiteId === "global"
        ? "global"
        : querySiteId && s.sites.some((site) => site.id === querySiteId)
          ? querySiteId
          : "global";
    setForm((f) => ({ ...f, siteId: f.siteId || preferred }));
  }

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [token, searchParams]);

  function openAdd() {
    setEditingUrl(null);
    setForm((f) => ({ ...f, name: "", url: "" }));
    setModalOpen(true);
  }

  function openEdit(r: { siteId: string; name: string; url: string }) {
    setEditingUrl(r.url);
    setForm({ siteId: r.siteId, name: r.name, url: r.url });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingUrl(null);
    setForm((f) => ({ ...f, name: "", url: "" }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !form.siteId) return;
    setBusy(true);
    setError(null);
    try {
      if (editingUrl) {
        await updateSiteWebsite(token, form.siteId, {
          url: editingUrl,
          name: form.name,
          newUrl: form.url !== editingUrl ? form.url : undefined
        });
      } else {
        await addSiteWebsite(token, form.siteId, { name: form.name, url: form.url });
      }
      setMsg("Saved. Click Save and start checking to activate.");
      await reload();
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(siteId: string, url: string) {
    if (!token) return;
    if (!confirm(`Remove ${url}?`)) return;
    setBusy(true);
    try {
      await deleteSiteWebsite(token, siteId, url);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function onApply(siteId: string) {
    if (!token) return;
    setBusy(true);
    try {
      const res = await applyWebsiteProbes(token, siteId);
      setMsg(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Website checks</h1>
          <p className="pageSub">We check if your public websites respond</p>
        </div>
        <div className="pageActions">
          <button type="button" className="primary" onClick={openAdd}>
            Add website
          </button>
        </div>
      </div>

      {error ? <div className="bannerError">{error}</div> : null}
      {msg ? <p className="muted">{msg}</p> : null}

      <div className="tableCard">
        <div className="tableTitle">Checked URLs</div>
        <table className="dataTable">
          <thead>
            <tr>
              <th>Site</th>
              <th>Name</th>
              <th>URL</th>
              <th>Latency</th>
              <th>Uptime 24h</th>
              <th>24h</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  No websites yet —{" "}
                  <button type="button" className="linkBtn" onClick={openAdd}>
                    add one
                  </button>{" "}
                  or use a <Link to="/sites">site detail page</Link>.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.siteId}-${r.url}`}>
                  <td>
                    {r.siteId === "global" ? (
                      <span>{r.siteName}</span>
                    ) : (
                      <Link to={`/sites/${r.siteId}`}>{r.siteName}</Link>
                    )}
                  </td>
                  <td>{r.name}</td>
                  <td>{r.url}</td>
                  <td>{r.latencyMs != null ? `${r.latencyMs} ms` : "—"}</td>
                  <td>{r.uptime24h != null ? `${r.uptime24h}%` : "—"}</td>
                  <td>
                    <UptimeSparkline values={r.sparkline} />
                  </td>
                  <td>
                    <StatusPill state={r.state} notes={r.notes} />
                  </td>
                  <td>
                    <button type="button" onClick={() => openEdit(r)}>
                      Edit
                    </button>{" "}
                    <button type="button" onClick={() => onDelete(r.siteId, r.url)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen}
        title={editingUrl ? "Edit website" : "Add website"}
        onClose={closeModal}
      >
        <form className="deviceForm" onSubmit={onSubmit}>
          <label className="label">Site</label>
          <select
            value={form.siteId}
            onChange={(e) => setForm((f) => ({ ...f, siteId: e.target.value }))}
            required
            disabled={Boolean(editingUrl)}
          >
            <option value="global">Global / Central</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="label">Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <label className="label">URL</label>
          <input
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            required
            placeholder="https://example.com"
          />
          <div className="formActions">
            <button type="submit" className="primary" disabled={busy}>
              {editingUrl ? "Save" : "Add"}
            </button>
            {form.siteId ? (
              <button type="button" disabled={busy} onClick={() => onApply(form.siteId)}>
                Save and start checking
              </button>
            ) : null}
            <button type="button" onClick={closeModal}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
