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
import { useAuth } from "../auth/AuthContext";
import {
  applyWebsiteProbes,
  deleteSiteWebsite,
  getWebsiteDetail,
  updateSiteWebsite,
  STATUS_POLL_MS,
  type WebsiteDetail
} from "../api";
import { StatusPill } from "../components/StatusPill";
import { Modal } from "../components/Modal";

type DetailRange = "24h" | "7d" | "30d";

function formatWhen(tsSec?: number | null) {
  if (tsSec == null) return "—";
  try {
    return new Date(tsSec * 1000).toLocaleString();
  } catch {
    return "—";
  }
}

function formatDuration(sec: number) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatAge(tsSec: number | null) {
  if (tsSec == null) return "—";
  const age = Math.max(0, Math.floor(Date.now() / 1000 - tsSec));
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  return `${Math.floor(age / 3600)}h ago`;
}

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
  if (pct >= 99.5) return "var(--ok, #22c55e)";
  if (pct >= 95) return "var(--warn, #eab308)";
  return "var(--critical, #ef4444)";
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
    <div className="tableCard websiteChartCard">
      <div className="tableTitle">{title}</div>
      <div className="websiteChartInner websiteTrendInner">
        {data.length === 0 ? (
          <p className="muted">No trend data yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} unit="%" />
              <Tooltip
                formatter={(value, _name, item) => {
                  const missing = Boolean((item?.payload as { missing?: boolean } | undefined)?.missing);
                  if (missing) return ["—", "Uptime"];
                  return [`${value}%`, "Uptime"];
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
    </div>
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
        <div className="bannerError">Missing website URL.</div>
        <Link to="/websites">Back to website checks</Link>
      </div>
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <p className="muted" style={{ marginBottom: 6 }}>
            <Link to="/websites">Website checks</Link>
            {" / "}
            {detail?.name ?? "…"}
          </p>
          <h1>{detail?.name ?? "Website"}</h1>
          <p className="pageSub">
            {detail ? (
              <>
                <a className="websiteUrlLink" href={detail.url} target="_blank" rel="noreferrer">
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
            )}
          </p>
        </div>
        <div className="pageActions">
          <button type="button" onClick={() => setEditOpen(true)} disabled={!detail || busy}>
            Edit
          </button>
          <button type="button" onClick={() => void onApply()} disabled={!detail || busy}>
            Start checking
          </button>
          <button type="button" onClick={() => void onDelete()} disabled={!detail || busy}>
            Remove
          </button>
          {detail ? (
            <a className="primary" href={detail.url} target="_blank" rel="noreferrer">
              Open URL
            </a>
          ) : null}
        </div>
      </div>

      {error ? <div className="bannerError">{error}</div> : null}
      {msg ? <p className="muted">{msg}</p> : null}

      <div className="websiteKpiStrip">
        <div className="healthChip">
          <span className="healthChipLabel">State</span>
          {detail ? <StatusPill state={detail.state} notes={detail.notes} /> : <strong>—</strong>}
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Latency</span>
          <strong>{detail?.latencyMs != null ? `${detail.latencyMs} ms` : "—"}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Avg / max ({range})</span>
          <strong>
            {detail?.latencyAvgMs != null ? `${detail.latencyAvgMs}` : "—"}
            {" / "}
            {detail?.latencyMaxMs != null ? `${detail.latencyMaxMs} ms` : "—"}
          </strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Uptime {range}</span>
          <strong>
            {detail?.uptimeRangePct != null ? `${detail.uptimeRangePct}%` : "—"}
          </strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Uptime 24h / 7d / 30d</span>
          <strong>
            {detail?.uptime24h != null ? `${detail.uptime24h}%` : "—"}
            {" / "}
            {detail?.uptime7d != null ? `${detail.uptime7d}%` : "—"}
            {" / "}
            {detail?.uptime30d != null ? `${detail.uptime30d}%` : "—"}
          </strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Last check</span>
          <strong>{formatAge(detail?.lastCheckAt ?? null)}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Outages</span>
          <strong>{detail?.outages.length ?? 0}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Range</span>
          <div style={{ display: "flex", gap: 6 }}>
            {(["24h", "7d", "30d"] as DetailRange[]).map((r) => (
              <button
                key={r}
                type="button"
                className={range === r ? "primary" : undefined}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="websiteDetailCharts">
        <div className="tableCard websiteChartCard">
          <div className="tableTitle">Availability ({range})</div>
          <div className="websiteChartInner">
            {availChart.length < 2 ? (
              <p className="muted">No availability history yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={availChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={28} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} width={36} />
                  <Tooltip />
                  <Area
                    type="stepAfter"
                    dataKey="v"
                    name="Up"
                    stroke="var(--accent)"
                    fill="rgba(45, 212, 191, 0.2)"
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="tableCard websiteChartCard">
          <div className="tableTitle">Latency ms ({range})</div>
          <div className="websiteChartInner">
            {latencyChart.length < 2 ? (
              <p className="muted">No latency history yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={latencyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={28} />
                  <YAxis tick={{ fontSize: 11 }} width={44} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="v"
                    name="ms"
                    stroke="var(--accent)"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="websiteDetailCharts">
        <TrendBars title="Weekly uptime trend (daily)" bars={detail?.weeklyTrend ?? []} />
        <TrendBars title="Monthly uptime trend (daily)" bars={detail?.monthlyTrend ?? []} />
      </div>

      <div className="tableCard" style={{ marginBottom: 14 }}>
        <div className="tableTitle">Outage timeline</div>
        {detail && detail.outages.length > 0 ? (
          <div className="outageTimelineStrip" aria-hidden>
            {detail.outages
              .slice()
              .reverse()
              .map((o) => {
                const rangeStart =
                  range === "30d"
                    ? nowSec - 30 * 24 * 3600
                    : range === "7d"
                      ? nowSec - 7 * 24 * 3600
                      : nowSec - 24 * 3600;
                const span = Math.max(1, nowSec - rangeStart);
                const left = Math.max(0, ((o.start - rangeStart) / span) * 100);
                const width = Math.max(0.4, ((o.end - o.start) / span) * 100);
                return (
                  <span
                    key={`${o.start}-${o.end}`}
                    className={`outageTick${o.ongoing ? " outageTick--ongoing" : ""}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${formatWhen(o.start)} → ${o.ongoing ? "now" : formatWhen(o.end)}`}
                  />
                );
              })}
          </div>
        ) : null}
        <table className="dataTable">
          <thead>
            <tr>
              <th>When</th>
              <th>Ended</th>
              <th>Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {!detail || detail.outages.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No outages in this range.
                </td>
              </tr>
            ) : (
              detail.outages.map((o) => (
                <tr key={`${o.start}-${o.end}`}>
                  <td>{formatWhen(o.start)}</td>
                  <td>{o.ongoing ? "—" : formatWhen(o.end)}</td>
                  <td>{formatDuration(o.durationSec)}</td>
                  <td>
                    <span className={o.ongoing ? "pillCritical" : "muted"}>
                      {o.ongoing ? "Ongoing" : "Ended"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="tableCard">
        <div className="tableTitle">Related website incidents</div>
        <table className="dataTable">
          <thead>
            <tr>
              <th>Problem</th>
              <th>Detail</th>
              <th>Opened</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {incidents.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No related website incidents.
                </td>
              </tr>
            ) : (
              incidents.map((i) => (
                <tr key={i.id}>
                  <td>{i.title}</td>
                  <td>{i.detail}</td>
                  <td>{new Date(i.openedAt).toLocaleString()}</td>
                  <td>
                    {i.acknowledgedAt ? "Acked" : i.resolvedAt ? "Needs ack" : "Active"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={editOpen} title="Edit website" onClose={() => setEditOpen(false)}>
        <form className="deviceForm" onSubmit={onSaveEdit}>
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
          />
          <div className="formActions">
            <button type="submit" className="primary" disabled={busy}>
              Save
            </button>
            <button type="button" onClick={() => setEditOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
