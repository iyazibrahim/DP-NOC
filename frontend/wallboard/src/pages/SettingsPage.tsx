import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  applyRetentionSettings,
  applyNotificationsSettings,
  downloadExportFile,
  getLatestMonthlyReport,
  getNotificationsSettings,
  getRetentionSettings,
  getSettings,
  getStatusTiming,
  listExports,
  resetDashboardLayout,
  resetSitesFromSeed,
  runExport,
  saveNotificationsSettings,
  saveRetentionSettings
} from "../api";
import type {
  ExportRecord,
  MonthlyReportPayload,
  NotificationsConfig,
  RetentionConfig,
  StatusTimingInfo
} from "../types";
import { Modal } from "../components/Modal";

function formatBytes(n: number | null) {
  if (n == null) return "—";
  const gb = n / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(n / (1024 * 1024)).toFixed(0)} MB`;
}

function fmtPct(v: number | string | null | undefined) {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
}

function fmtWhen(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type SettingsModal = "notifications" | "storage" | "exports" | "advanced" | null;

export function SettingsPage() {
  const { token } = useAuth();
  const [grafanaUrl, setGrafanaUrl] = useState("");
  const [retention, setRetention] = useState<RetentionConfig | null>(null);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReportPayload | null>(null);
  const [notifications, setNotifications] = useState<NotificationsConfig | null>(null);
  const [statusTiming, setStatusTiming] = useState<StatusTimingInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<SettingsModal>(null);

  async function reload() {
    if (!token) return;
    const [settings, ret, ex, notif, timing, monthly] = await Promise.all([
      getSettings(),
      getRetentionSettings(token),
      listExports(token),
      getNotificationsSettings(token),
      getStatusTiming(token),
      getLatestMonthlyReport(token)
    ]);
    setGrafanaUrl(settings.grafanaPublicUrl);
    setRetention(ret.config);
    setStorageBytes(ret.storageBytes);
    setExports(ex.exports);
    setNotifications(notif.config);
    setStatusTiming(timing);
    setMonthlyReport(monthly.report);
  }

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [token]);

  const resetLayout = async () => {
    if (!token) return;
    await resetDashboardLayout(token);
    setMsg("Dashboard layout reset to default.");
  };

  const onSaveRetention = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !retention) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveRetentionSettings(token, retention);
      setRetention(res.config);
      setStorageBytes(res.storageBytes);
      setMsg("Retention settings saved.");
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const onApplyRetention = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await applyRetentionSettings(token);
      setMsg(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  const onRunExport = async (period: "weekly" | "monthly") => {
    if (!token) return;
    setBusy(true);
    try {
      await runExport(token, period);
      await reload();
      setMsg(`${period} export completed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const onDownload = async (rec: ExportRecord, filename: string) => {
    if (!token) return;
    try {
      const blob = await downloadExportFile(token, rec.id, filename);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const onResetSites = async () => {
    if (!token) return;
    if (!confirm("Reset all sites from seed data? This replaces site list and removes custom sites.")) {
      return;
    }
    setBusy(true);
    try {
      await resetSitesFromSeed(token);
      setMsg("Sites reset from seed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  const onSaveNotifications = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !notifications) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveNotificationsSettings(token, notifications);
      setNotifications(res.config);
      setMsg("Notification settings saved.");
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const onApplyNotifications = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const res = await applyNotificationsSettings(token);
      setMsg(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  const notifSummary = notifications
    ? [
        notifications.telegram.enabled ? "Telegram" : null,
        notifications.email.enabled ? "Email" : null,
        notifications.webhook.enabled ? "Webhook" : null
      ]
        .filter(Boolean)
        .join(" · ") || "All channels off"
    : "Loading…";

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Settings</h1>
          <p className="pageSub">Open a module to configure — keeps the page clear</p>
        </div>
      </div>

      {error ? <div className="bannerError">{error}</div> : null}
      {msg ? <p className="muted">{msg}</p> : null}

      <div className="settingsBento">
        <section className="settingsBentoCard settingsBentoCard--detection">
          <div className="settingsBentoEyebrow">Read-only</div>
          <h2 className="settingsBentoTitle">Detection</h2>
          <p className="muted settingsBentoBlurb">
            UI refreshes every 5s. Outages show in ~30–60s. Collector ICMP scrape must be 15–30s.
          </p>
          {statusTiming ? (
            <ul className="settingsBentoList">
              <li>Refresh every {statusTiming.dashboardRefreshSec}s</li>
              <li>Down after {statusTiming.metricFreshWindowSec}s silence</li>
              <li>Typical detection ~{statusTiming.typicalDetectionSec}s</li>
            </ul>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </section>

        <button
          type="button"
          className="settingsBentoCard settingsBentoCard--click"
          onClick={() => setModal("notifications")}
        >
          <div className="settingsBentoEyebrow">Alerts</div>
          <h2 className="settingsBentoTitle">Notifications</h2>
          <p className="muted settingsBentoBlurb">{notifSummary}</p>
          <span className="settingsBentoCta">Configure →</span>
        </button>

        <button
          type="button"
          className="settingsBentoCard settingsBentoCard--click"
          onClick={() => setModal("storage")}
        >
          <div className="settingsBentoEyebrow">Prometheus</div>
          <h2 className="settingsBentoTitle">Storage</h2>
          <p className="muted settingsBentoBlurb">
            Retention & scrape · {formatBytes(storageBytes)}
          </p>
          <span className="settingsBentoCta">Configure →</span>
        </button>

        <button
          type="button"
          className="settingsBentoCard settingsBentoCard--click"
          onClick={() => setModal("exports")}
        >
          <div className="settingsBentoEyebrow">Reports</div>
          <h2 className="settingsBentoTitle">Exports</h2>
          <p className="muted settingsBentoBlurb">
            {exports.length === 0
              ? "No exports yet — run weekly or monthly"
              : `${exports.length} export record(s)`}
          </p>
          <span className="settingsBentoCta">Open →</span>
        </button>

        <button
          type="button"
          className="settingsBentoCard settingsBentoCard--click settingsBentoCard--accent"
          onClick={() => setModal("advanced")}
        >
          <div className="settingsBentoEyebrow">System</div>
          <h2 className="settingsBentoTitle">Advanced</h2>
          <p className="muted settingsBentoBlurb">Grafana URL, layout reset, seed sites</p>
          <span className="settingsBentoCta">Open →</span>
        </button>
      </div>

      <Modal
        open={modal === "notifications"}
        title="Alert notifications"
        onClose={() => setModal(null)}
        wide
      >
        {notifications ? (
          <form className="deviceForm" onSubmit={onSaveNotifications}>
            <p className="muted">Telegram / email / webhook via Alertmanager. Save, then Apply.</p>
            <div className="tableTitle">Telegram</div>
            <label className="label">
              <input
                type="checkbox"
                checked={notifications.telegram.enabled}
                onChange={(e) =>
                  setNotifications({
                    ...notifications,
                    telegram: { ...notifications.telegram, enabled: e.target.checked }
                  })
                }
              />{" "}
              Enable Telegram
            </label>
            <label className="label">Bot token</label>
            <input
              type="password"
              value={notifications.telegram.botToken}
              placeholder={
                notifications.telegram.hasToken ? "•••••• (unchanged)" : "123456:ABC..."
              }
              onChange={(e) =>
                setNotifications({
                  ...notifications,
                  telegram: { ...notifications.telegram, botToken: e.target.value }
                })
              }
            />
            <label className="label">Chat ID</label>
            <input
              value={notifications.telegram.chatId}
              placeholder="-1001234567890"
              onChange={(e) =>
                setNotifications({
                  ...notifications,
                  telegram: { ...notifications.telegram, chatId: e.target.value }
                })
              }
            />

            <div className="tableTitle">SMTP email</div>
            <label className="label">
              <input
                type="checkbox"
                checked={notifications.email.enabled}
                onChange={(e) =>
                  setNotifications({
                    ...notifications,
                    email: { ...notifications.email, enabled: e.target.checked }
                  })
                }
              />{" "}
              Enable email
            </label>
            <label className="label">To</label>
            <input
              value={notifications.email.to}
              onChange={(e) =>
                setNotifications({
                  ...notifications,
                  email: { ...notifications.email, to: e.target.value }
                })
              }
            />
            <label className="label">From</label>
            <input
              value={notifications.email.from}
              onChange={(e) =>
                setNotifications({
                  ...notifications,
                  email: { ...notifications.email, from: e.target.value }
                })
              }
            />
            <label className="label">SMTP host:port</label>
            <input
              value={notifications.email.smarthost}
              placeholder="smtp.example.com:587"
              onChange={(e) =>
                setNotifications({
                  ...notifications,
                  email: { ...notifications.email, smarthost: e.target.value }
                })
              }
            />
            <label className="label">SMTP username</label>
            <input
              value={notifications.email.authUsername}
              onChange={(e) =>
                setNotifications({
                  ...notifications,
                  email: { ...notifications.email, authUsername: e.target.value }
                })
              }
            />
            <label className="label">SMTP password</label>
            <input
              type="password"
              value={notifications.email.authPassword}
              placeholder={notifications.email.hasPassword ? "•••••• (unchanged)" : ""}
              onChange={(e) =>
                setNotifications({
                  ...notifications,
                  email: { ...notifications.email, authPassword: e.target.value }
                })
              }
            />

            <div className="tableTitle">Webhook (optional)</div>
            <label className="label">
              <input
                type="checkbox"
                checked={notifications.webhook.enabled}
                onChange={(e) =>
                  setNotifications({
                    ...notifications,
                    webhook: { ...notifications.webhook, enabled: e.target.checked }
                  })
                }
              />{" "}
              Enable webhook
            </label>
            <input
              value={notifications.webhook.url}
              placeholder="https://hooks.example.com/alerts"
              onChange={(e) =>
                setNotifications({
                  ...notifications,
                  webhook: { ...notifications.webhook, url: e.target.value }
                })
              }
            />

            <div className="formActions">
              <button className="primary" type="submit" disabled={busy}>
                Save notifications
              </button>
              <button type="button" onClick={onApplyNotifications} disabled={busy}>
                Apply to Alertmanager
              </button>
              <button type="button" onClick={() => setModal(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">Loading notifications…</p>
        )}
      </Modal>

      <Modal
        open={modal === "storage"}
        title="Prometheus storage"
        onClose={() => setModal(null)}
        wide
      >
        {retention ? (
          <form className="deviceForm" onSubmit={onSaveRetention}>
            <p className="muted">Current size: {formatBytes(storageBytes)}</p>
            <label className="label">Retention time</label>
            <input
              value={retention.retentionTime}
              onChange={(e) => setRetention({ ...retention, retentionTime: e.target.value })}
              placeholder="30d"
            />
            <label className="label">Retention size (GB)</label>
            <input
              type="number"
              min={1}
              max={100}
              value={retention.retentionSizeGB}
              onChange={(e) =>
                setRetention({ ...retention, retentionSizeGB: Number(e.target.value) })
              }
            />
            <label className="label">Host scrape interval (sec)</label>
            <input
              type="number"
              min={15}
              value={retention.hostScrapeIntervalSec}
              onChange={(e) =>
                setRetention({ ...retention, hostScrapeIntervalSec: Number(e.target.value) })
              }
            />
            <label className="label">ICMP scrape interval (sec)</label>
            <input
              type="number"
              min={15}
              value={retention.icmpScrapeIntervalSec}
              onChange={(e) =>
                setRetention({ ...retention, icmpScrapeIntervalSec: Number(e.target.value) })
              }
            />
            <label className="label">SNMP scrape interval (sec)</label>
            <input
              type="number"
              min={15}
              value={retention.snmpScrapeIntervalSec}
              onChange={(e) =>
                setRetention({ ...retention, snmpScrapeIntervalSec: Number(e.target.value) })
              }
            />
            <label className="label">
              <input
                type="checkbox"
                checked={retention.scheduledExportsEnabled}
                onChange={(e) =>
                  setRetention({ ...retention, scheduledExportsEnabled: e.target.checked })
                }
              />{" "}
              Enable scheduled exports
            </label>
            <div className="formActions">
              <button className="primary" type="submit" disabled={busy}>
                Save retention
              </button>
              <button type="button" onClick={onApplyRetention} disabled={busy}>
                Apply to Prometheus
              </button>
              <button type="button" onClick={() => setModal(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">Loading retention…</p>
        )}
      </Modal>

      <Modal open={modal === "exports"} title="Reports & exports" onClose={() => setModal(null)} wide>
        <p className="muted">
          Weekly (Sunday 00:00 MYT) and monthly (1st 00:00 MYT) when enabled. Metrics retention default
          is 30 days — apply storage settings and restart Prometheus so monthly history is complete.
        </p>
        <div className="formActions">
          <button type="button" className="primary" onClick={() => onRunExport("weekly")} disabled={busy}>
            Export now (weekly)
          </button>
          <button type="button" onClick={() => onRunExport("monthly")} disabled={busy}>
            Export now (monthly)
          </button>
        </div>

        <div className="tableTitle" style={{ marginTop: 18 }}>
          Latest monthly summary
        </div>
        {!monthlyReport ? (
          <p className="muted">No monthly report yet — click Export now (monthly).</p>
        ) : (
          <div className="monthlySummary">
            <p className="muted">
              Generated {fmtWhen(monthlyReport.generatedAt)} · last {monthlyReport.rangeDays} days
            </p>
            <div className="healthStrip" style={{ marginBottom: 12 }}>
              <div className="healthChip">
                <span className="healthChipLabel">Incidents opened</span>
                <strong>{monthlyReport.incidents?.summary?.openedInRange ?? 0}</strong>
              </div>
              <div className="healthChip">
                <span className="healthChipLabel">Resolved</span>
                <strong>{monthlyReport.incidents?.summary?.resolvedInRange ?? 0}</strong>
              </div>
              <div className="healthChip">
                <span className="healthChipLabel">Still open</span>
                <strong>{monthlyReport.incidents?.summary?.stillOpen ?? 0}</strong>
              </div>
              <div className="healthChip">
                <span className="healthChipLabel">Acknowledged</span>
                <strong>{monthlyReport.incidents?.summary?.acknowledgedInRange ?? 0}</strong>
              </div>
            </div>

            <div className="tableTitle">Site uptime (WAN)</div>
            <table className="dataTable" style={{ marginBottom: 14 }}>
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Overall</th>
                  <th>WAN uptime</th>
                  <th>Devices</th>
                </tr>
              </thead>
              <tbody>
                {(monthlyReport.sites ?? []).map((s) => (
                  <tr key={s.siteId}>
                    <td>{s.name}</td>
                    <td>{s.overall}</td>
                    <td>{fmtPct(s.wanUptimePct)}</td>
                    <td>{s.deviceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="tableTitle">Bandwidth utilization (network)</div>
            <p className="muted fieldHint">
              Approx. util from SNMP ifSpeed (nominal link). Peak/avg over the report window.
            </p>
            <table className="dataTable" style={{ marginBottom: 14 }}>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Site</th>
                  <th>Avg in</th>
                  <th>Peak in</th>
                  <th>Avg out</th>
                  <th>Peak out</th>
                </tr>
              </thead>
              <tbody>
                {(monthlyReport.devices ?? []).filter((d) => d.kind === "network").length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No network devices in report.
                    </td>
                  </tr>
                ) : (
                  (monthlyReport.devices ?? [])
                    .filter((d) => d.kind === "network")
                    .map((d) => (
                      <tr key={`${d.siteId}-${d.deviceId}`}>
                        <td>{d.name}</td>
                        <td>{d.siteName}</td>
                        <td>{fmtPct(d.avgUtilInPct)}</td>
                        <td>{fmtPct(d.peakUtilInPct)}</td>
                        <td>{fmtPct(d.avgUtilOutPct)}</td>
                        <td>{fmtPct(d.peakUtilOutPct)}</td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>

            <div className="tableTitle">Incident timeline</div>
            <table className="dataTable" style={{ marginBottom: 14 }}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Problem</th>
                  <th>Site</th>
                  <th>Resolved</th>
                  <th>Acked</th>
                </tr>
              </thead>
              <tbody>
                {(monthlyReport.incidents?.timeline ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No incidents in this period.
                    </td>
                  </tr>
                ) : (
                  (monthlyReport.incidents?.timeline ?? []).slice(0, 50).map((i) => (
                    <tr key={i.id}>
                      <td>{fmtWhen(i.openedAt)}</td>
                      <td>
                        {i.title}
                        <div className="muted">{i.detail}</div>
                      </td>
                      <td>{i.siteName}</td>
                      <td>{fmtWhen(i.resolvedAt)}</td>
                      <td>{fmtWhen(i.acknowledgedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="tableTitle">Export files</div>
        <table className="dataTable" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Period</th>
              <th>Created</th>
              <th>Files</th>
            </tr>
          </thead>
          <tbody>
            {exports.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No exports yet.
                </td>
              </tr>
            ) : (
              exports.map((rec) => (
                <tr key={rec.id}>
                  <td>{rec.period}</td>
                  <td>{new Date(rec.createdAt).toLocaleString()}</td>
                  <td>
                    {rec.files.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => onDownload(rec, f)}
                        style={{ marginRight: 8 }}
                      >
                        {f}
                      </button>
                    ))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Modal>

      <Modal open={modal === "advanced"} title="Advanced" onClose={() => setModal(null)}>
        <div className="kvList">
          <div>
            <strong>Grafana public URL</strong>
            <div className="muted">{grafanaUrl || "—"}</div>
            <p className="muted fieldHint" style={{ marginTop: 8 }}>
              Charts in this app use the same Prometheus metrics as Grafana.
            </p>
          </div>
        </div>
        <div className="formActions" style={{ marginTop: 16 }}>
          <button type="button" onClick={resetLayout}>
            Reset my dashboard layout
          </button>
          <button type="button" onClick={onResetSites} disabled={busy}>
            Reset sites from seed
          </button>
          <button type="button" onClick={() => setModal(null)}>
            Close
          </button>
        </div>
      </Modal>
    </div>
  );
}
