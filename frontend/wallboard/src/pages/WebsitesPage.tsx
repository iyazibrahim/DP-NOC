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
import type { Site } from "../types";

export function WebsitesPage() {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<
    Array<{ siteId: string; siteName: string; name: string; url: string; state: string }>
  >([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [form, setForm] = useState({ siteId: "", name: "", url: "" });
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
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
      setForm((f) => ({ ...f, name: "", url: "" }));
      setEditingUrl(null);
      setMsg("Saved. Click Save and start checking to activate.");
      await reload();
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
      </div>

      {error ? <div className="bannerError">{error}</div> : null}
      {msg ? <p className="muted">{msg}</p> : null}

      <div className="detailGrid">
        <div className="tableCard" style={{ gridColumn: "1 / -1" }}>
          <div className="tableTitle">{editingUrl ? "Edit website" : "Add website"}</div>
          <form className="deviceForm" onSubmit={onSubmit}>
            <label className="label">Site</label>
            <select
              value={form.siteId}
              onChange={(e) => setForm((f) => ({ ...f, siteId: e.target.value }))}
              required
            >
              <option value="global">Global (no physical site)</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="muted fieldHint">
              Website checks run from the central server and count toward that site&apos;s health.
            </p>
            <label className="label">Display name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Public website"
            />
            <label className="label">URL</label>
            <input
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://example.com"
              required
            />
            <div className="formActions">
              <button className="primary" type="submit" disabled={busy}>
                {editingUrl ? "Save" : "Add website"}
              </button>
              {form.siteId ? (
                <button type="button" onClick={() => onApply(form.siteId)} disabled={busy}>
                  Save and start checking
                </button>
              ) : null}
              {editingUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingUrl(null);
                    setForm((f) => ({ ...f, name: "", url: "" }));
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </div>

      <table className="dataTable full" style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>Site</th>
            <th>Name</th>
            <th>URL</th>
            <th>State</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No websites yet — add one above or on a{" "}
                <Link to="/sites">site detail page</Link>.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`${r.siteId}-${r.url}`}>
                <td>
                  {r.siteId === "global" ? <span>{r.siteName}</span> : <Link to={`/sites/${r.siteId}`}>{r.siteName}</Link>}
                </td>
                <td>{r.name}</td>
                <td>{r.url}</td>
                <td>
                  <StatusPill state={r.state} />
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingUrl(r.url);
                      setForm({ siteId: r.siteId, name: r.name, url: r.url });
                    }}
                  >
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
  );
}
