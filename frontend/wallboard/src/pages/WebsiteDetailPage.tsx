import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useAuth } from "@/auth/AuthContext";
import {
  applyWebsiteProbes,
  deleteSiteWebsite,
  getWebsiteDetail,
  updateSiteWebsite,
  STATUS_POLL_MS,
  type WebsiteDetail
} from "@/api";
import { PageHeader } from "@/components/noc/PageHeader";
import { StatusBadge } from "@/components/noc/StatusBadge";
import {
  MetricChartFrame,
  darkTooltipProps,
  formatAvailabilityRatio,
  formatMs,
  formatPct
} from "@/components/noc/MetricChart";
import { OutageTimeline } from "@/components/noc/OutageTimeline";
import { RangeToggle } from "@/components/noc/RangeToggle";
import { KpiChip, KpiStrip } from "@/components/noc/KpiStrip";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DetailRange = "24h" | "7d" | "30d";

function parseRange(raw: string | null): DetailRange {
  if (raw === "7d" || raw === "30d") return raw;
  return "24h";
}

function seriesToChart(series: Array<{ ts: number; value: number }>, range: DetailRange) {
  const fmt =
    range === "24h"
      ? { hour: "2-digit" as const, minute: "2-digit" as const }
      : { month: "short" as const, day: "numeric" as const, hour: "2-digit" as const };
  return series.map((p) => ({
    t: new Date(p.ts * 1000).toLocaleString([], fmt),
    v: p.value
  }));
}

function trendColor(pct: number | null) {
  if (pct == null) return "rgba(148, 163, 184, 0.45)";
  if (pct >= 99.5) return "var(--success)";
  if (pct >= 95) return "var(--warning)";
  return "var(--destructive)";
}

function rangeSeconds(range: DetailRange) {
  if (range === "30d") return 30 * 24 * 3600;
  if (range === "7d") return 7 * 24 * 3600;
  return 24 * 3600;
}

function formatAge(tsSec: number | null) {
  if (tsSec == null) return "—";
  const age = Math.max(0, Math.floor(Date.now() / 1000 - tsSec));
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  return `${Math.floor(age / 3600)}h ago`;
}

function TrendBars({
  title,
  bars
}: {
  title: string;
  bars: Array<{ label: string; uptimePct: number | null }>;
}) {
  const data = bars.map((b) => ({
    label: b.label,
    uptime: b.uptimePct ?? 0,
    missing: b.uptimePct == null
  }));
  return (
    <MetricChartFrame title={title} className="websiteChartCard">
      <div className="websiteChartInner websiteTrendInner h-[200px]">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trend data yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} unit="%" />
              <Tooltip
                {...darkTooltipProps()}
                formatter={(value, _name, item) => {
                  const missing = Boolean((item?.payload as { missing?: boolean } | undefined)?.missing);
                  if (missing) return ["—", "Uptime"];
                  return [formatPct(Number(value)), "Uptime"];
                }}
              />
              <Bar dataKey="uptime" name="Uptime" radius={[3, 3, 0, 0]}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.missing ? trendColor(null) : trendColor(d.uptime)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </MetricChartFrame>
  );
}

export function WebsiteDetailPage() {
  const { siteId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const url = searchParams.get("url") ?? "";
  const range = parseRange(searchParams.get("range"));
  const { token } = useAuth();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<WebsiteDetail | null>(null);
  const [incidents, setIncidents] = useState<
    Array<{
      id: string;
      title: string;
      detail: string;
      openedAt: string;
      resolvedAt?: string;
      acknowledgedAt?: string;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ name: "", url: "" });

  async function reload() {
    if (!token || !siteId || !url) return;
    const res = await getWebsiteDetail(token, { siteId, url, range });
    setDetail(res.website);
    setIncidents(res.relatedIncidents ?? []);
    setForm({ name: res.website.name, url: res.website.url });
  }

  useEffect(() => {
    if (!token || !siteId || !url) return;
    let cancelled = false;
    const load = async () => {
      try {
        await reload();
        if (!cancelled) setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      }
    };
    load();
    const t = setInterval(load, STATUS_POLL_MS * 2);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, siteId, url, range]);

  const availChart = useMemo(
    () => (detail ? seriesToChart(detail.availabilitySeries, range) : []),
    [detail, range]
  );
  const latencyChart = useMemo(
    () => (detail ? seriesToChart(detail.latencySeries, range) : []),
    [detail, range]
  );

  function setRange(next: DetailRange) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("range", next);
    setSearchParams(nextParams, { replace: true });
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!token || !detail) return;
    setBusy(true);
    setError(null);
    try {
      await updateSiteWebsite(token, detail.siteId, {
        url: detail.url,
        name: form.name,
        newUrl: form.url !== detail.url ? form.url : undefined
      });
      setMsg("Saved. Click Start checking to activate probe changes.");
      setEditOpen(false);
      if (form.url !== detail.url) {
        navigate(`/websites/${detail.siteId}?url=${encodeURIComponent(form.url)}&range=${range}`, {
          replace: true
        });
      } else {
        await reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onApply() {
    if (!token || !detail) return;
    setBusy(true);
    try {
      const res = await applyWebsiteProbes(token, detail.siteId);
      setMsg(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!token || !detail) return;
    if (!confirm(`Remove ${detail.url}?`)) return;
    setBusy(true);
    try {
      await deleteSiteWebsite(token, detail.siteId, detail.url);
      navigate("/websites");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
      setBusy(false);
    }
  }

  if (!url) {
    return (
      <div className="page">
        <Alert variant="destructive">
          <AlertDescription>Missing website URL.</AlertDescription>
        </Alert>
        <Button asChild variant="link" className="mt-2 px-0">
          <Link to="/websites">Back to website checks</Link>
        </Button>
      </div>
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const rangeStart = nowSec - rangeSeconds(range);

  return (
    <div className="page">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/websites">Website checks</Link>
            {" / "}
            {detail?.name ?? "…"}
          </>
        }
        title={detail?.name ?? "Website"}
        subtitle={
          detail ? (
            <>
              <a className="text-primary underline-offset-4 hover:underline" href={detail.url} target="_blank" rel="noreferrer">
                {detail.url}
              </a>
              {" · "}
              {detail.siteId === "global" ? (
                detail.siteName
              ) : (
                <Link to={`/sites/${detail.siteId}`}>{detail.siteName}</Link>
              )}
            </>
          ) : (
            "Loading probe status…"
          )
        }
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setEditOpen(true)} disabled={!detail || busy}>
              Edit
            </Button>
            <Button type="button" variant="outline" onClick={() => void onApply()} disabled={!detail || busy}>
              Start checking
            </Button>
            <Button type="button" variant="outline" onClick={() => void onDelete()} disabled={!detail || busy}>
              Remove
            </Button>
            {detail ? (
              <Button asChild>
                <a href={detail.url} target="_blank" rel="noreferrer" className="text-primary-foreground no-underline hover:no-underline">
                  Open URL
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {msg ? <p className="mb-3 text-sm text-muted-foreground">{msg}</p> : null}

      <KpiStrip>
        <KpiChip
          label="State"
          value={detail ? <StatusBadge state={detail.state} notes={detail.notes} /> : "—"}
        />
        <KpiChip label="Latency" value={detail?.latencyMs != null ? `${detail.latencyMs} ms` : "—"} />
        <KpiChip
          label={`Avg / max (${range})`}
          value={`${detail?.latencyAvgMs != null ? detail.latencyAvgMs : "—"} / ${
            detail?.latencyMaxMs != null ? `${detail.latencyMaxMs} ms` : "—"
          }`}
        />
        <KpiChip
          label={`Uptime ${range}`}
          value={detail?.uptimeRangePct != null ? `${detail.uptimeRangePct}%` : "—"}
        />
        <KpiChip
          label="Uptime 24h / 7d / 30d"
          value={`${detail?.uptime24h != null ? `${detail.uptime24h}%` : "—"} / ${
            detail?.uptime7d != null ? `${detail.uptime7d}%` : "—"
          } / ${detail?.uptime30d != null ? `${detail.uptime30d}%` : "—"}`}
        />
        <KpiChip label="Last check" value={formatAge(detail?.lastCheckAt ?? null)} />
        <KpiChip label="Outages" value={detail?.outages.length ?? 0} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Range</span>
          <RangeToggle value={range} onChange={(v) => setRange(v as DetailRange)} />
        </div>
      </KpiStrip>

      <div className="websiteDetailCharts mb-4 grid gap-3 md:grid-cols-2">
        <MetricChartFrame title={`Availability (${range})`}>
          <div className="websiteChartInner h-[220px]">
            {availChart.length < 2 ? (
              <p className="text-sm text-muted-foreground">No availability history yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={availChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={28} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} width={36} />
                  <Tooltip
                    {...darkTooltipProps()}
                    formatter={(value) => [formatAvailabilityRatio(Number(value)), "Up"]}
                  />
                  <Area
                    type="stepAfter"
                    dataKey="v"
                    name="Up"
                    stroke="var(--primary)"
                    fill="rgba(0, 181, 226, 0.2)"
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </MetricChartFrame>

        <MetricChartFrame title={`Latency ms (${range})`}>
          <div className="websiteChartInner h-[220px]">
            {latencyChart.length < 2 ? (
              <p className="text-sm text-muted-foreground">No latency history yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={latencyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={28} />
                  <YAxis tick={{ fontSize: 11 }} width={44} />
                  <Tooltip
                    {...darkTooltipProps()}
                    formatter={(value) => [formatMs(Number(value)), "Latency"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="v"
                    name="ms"
                    stroke="var(--primary)"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </MetricChartFrame>
      </div>

      <div className="websiteDetailCharts mb-4 grid gap-3 md:grid-cols-2">
        <TrendBars title="Weekly uptime trend (daily)" bars={detail?.weeklyTrend ?? []} />
        <TrendBars title="Monthly uptime trend (daily)" bars={detail?.monthlyTrend ?? []} />
      </div>

      <Card className="mb-4">
        <CardHeader className="py-3">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Outage timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <OutageTimeline
            outages={detail?.outages ?? []}
            rangeStart={rangeStart}
            rangeEnd={nowSec}
          />
        </CardContent>
      </Card>

      <DataTableCard title="Related website incidents">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Problem</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>Opened</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {incidents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No related website incidents.
                </TableCell>
              </TableRow>
            ) : (
              incidents.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.title}</TableCell>
                  <TableCell>{i.detail}</TableCell>
                  <TableCell>{new Date(i.openedAt).toLocaleString()}</TableCell>
                  <TableCell>
                    {i.acknowledgedAt ? "Acked" : i.resolvedAt ? "Needs ack" : "Active"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableCard>

      <Modal open={editOpen} title="Edit website" onClose={() => setEditOpen(false)}>
        <form className="flex flex-col gap-3" onSubmit={onSaveEdit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-url">URL</Label>
            <Input
              id="edit-url"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
