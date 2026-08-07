import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import {
  addSiteWebsite,
  applyWebsiteProbes,
  deleteSiteWebsite,
  getSites,
  getWebsites,
  updateSiteWebsite
} from "@/api";
import { PageHeader } from "@/components/noc/PageHeader";
import { StatusBadge } from "@/components/noc/StatusBadge";
import {
  DataTableCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/noc/DataTable";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Site } from "@/types";

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
    return <span className="text-muted-foreground">—</span>;
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
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth="1.5" />
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
      <PageHeader
        title="Website checks"
        subtitle="We check if your public websites respond"
        actions={
          <Button type="button" onClick={openAdd}>
            Add website
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {msg ? <p className="mb-3 text-sm text-muted-foreground">{msg}</p> : null}

      <DataTableCard title="Checked URLs" empty={false}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Site</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Uptime 24h</TableHead>
              <TableHead>24h</TableHead>
              <TableHead>State</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">
                  No websites yet —{" "}
                  <Button type="button" variant="link" className="h-auto p-0" onClick={openAdd}>
                    add one
                  </Button>{" "}
                  or use a <Link to="/sites">site detail page</Link>.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const detailTo = `/websites/${r.siteId}?url=${encodeURIComponent(r.url)}`;
                return (
                  <TableRow key={`${r.siteId}-${r.url}`}>
                    <TableCell>
                      {r.siteId === "global" ? (
                        <span>{r.siteName}</span>
                      ) : (
                        <Link to={`/sites/${r.siteId}`}>{r.siteName}</Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link className="text-primary underline-offset-4 hover:underline" to={detailTo}>
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link className="text-primary underline-offset-4 hover:underline" to={detailTo}>
                        {r.url}
                      </Link>{" "}
                      <a
                        className="text-muted-foreground"
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open live site"
                        onClick={(e) => e.stopPropagation()}
                      >
                        ↗
                      </a>
                    </TableCell>
                    <TableCell>{r.latencyMs != null ? `${r.latencyMs} ms` : "—"}</TableCell>
                    <TableCell>{r.uptime24h != null ? `${r.uptime24h}%` : "—"}</TableCell>
                    <TableCell>
                      <UptimeSparkline values={r.sparkline} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge state={r.state} notes={r.notes} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button asChild variant="outline" size="sm">
                          <Link to={detailTo}>View</Link>
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => openEdit(r)}>
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void onDelete(r.siteId, r.url)}
                        >
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </DataTableCard>

      <Modal open={modalOpen} title={editingUrl ? "Edit website" : "Add website"} onClose={closeModal}>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-site">Site</Label>
            <select
              id="ws-site"
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
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
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-url">URL</Label>
            <Input
              id="ws-url"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              required
              placeholder="https://example.com"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {editingUrl ? "Save" : "Add"}
            </Button>
            {form.siteId ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void onApply(form.siteId)}>
                Save and start checking
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
