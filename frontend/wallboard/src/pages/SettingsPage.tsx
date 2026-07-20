import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  applyRetentionSettings,
  applyNotificationsSettings,
  downloadExportFile,
  getNotificationsSettings,
  getRetentionSettings,
  getSettings,
  getStatusTiming,
  listExports,
  resetDashboardLayout,
  resetSitesFromSeed,
  runExport,
  saveNotificationsSettings,
  saveRetentionSettings,
  STATUS_POLL_MS
} from "../api";
import type { ExportRecord, NotificationsConfig, RetentionConfig, StatusTimingInfo } from "../types";

function formatBytes(n: number | null) {
  if (n == null) return "—";
  const gb = n / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(n / (1024 * 1024)).toFixed(0)} MB`;
}

export function SettingsPage() {
  const { token } = useAuth();
  const [grafanaUrl, setGrafanaUrl] = useState("");
  const [retention, setRetention] = useState<RetentionConfig | null>(null);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationsConfig | null>(null);
  const [statusTiming, setStatusTiming] = useState<StatusTimingInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!token) return;
    const [settings, ret, ex, notif, timing] = await Promise.all([
      getSettings(),
      getRetentionSettings(token),
      listExports(token),
      getNotificationsSettings(token),
      getStatusTiming(token)
    ]);
    setGrafanaUrl(settings.grafanaPublicUrl);
    setRetention(ret.config);
    setStorageBytes(ret.storageBytes);
    setExports(ex.exports);
    setNotifications(notif.config);
    setStatusTiming(timing);
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

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Settings</h1>
          <p className="pageSub">Storage, notifications, exports, and integrations</p>
        </div>
      </div>

      {error ? <div className="bannerError">{error}</div> : null}
      {msg ? <p className="muted">{msg}</p> : null}

      <div className="detailGrid">
        <div className="tableCard">
          <div className="tableTitle">Prometheus storage</div>
          <p className="muted">
            Target ~10GB / 28 days on a 40GB VPS. See <code>docs/STORAGE_RETENTION.md</code>.
          </p>
          <div className="kvList">
            <div>Current TSDB size: {formatBytes(storageBytes)}</div>
          </div>
          {retention ? (
            <form className="deviceForm" onSubmit={onSaveRetention}>
              <label className="label">Retention time</label>
              <input
                value={retention.retentionTime}
                onChange={(e) => setRetention({ ...retention, retentionTime: e.target.value })}
                placeholder="28d"
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
              </div>
            </form>
          ) : (
            <p className="muted">Loading retention…</p>
          )}
        </div>

        <div className="tableCard">
          <div className="tableTitle">Reports & exports</div>
          <p className="muted">Weekly (Sunday 00:00 MYT) and monthly (1st 00:00 MYT) when enabled.</p>
          <div className="formActions">
            <button type="button" onClick={() => onRunExport("weekly")} disabled={busy}>
              Export now (weekly)
            </button>
            <button type="button" onClick={() => onRunExport("monthly")} disabled={busy}>
              Export now (monthly)
            </button>
          </div>
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
        </div>

        <div className="tableCard">
          <div className="tableTitle">Alert notifications</div>
          <p className="muted">
            Configures Alertmanager receivers (Telegram, SMTP email, webhook). Save then Apply to
            restart Alertmanager.
          </p>
          {notifications ? (
            <form className="deviceForm" onSubmit={onSaveNotifications}>
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
                placeholder={notifications.telegram.hasToken ? "•••••• (unchanged)" : "123456:ABC..."}
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
              </div>
            </form>
          ) : (
            <p className="muted">Loading notifications…</p>
          )}
        </div>

        <div className="tableCard">
          <div className="tableTitle">Status detection timing</div>
          <p className="muted">
            How quickly the dashboard reflects outages. Critical = down; unknown = never received
            metrics.
          </p>
          {statusTiming ? (
            <ul className="alertUl">
              <li>Dashboard refresh: every {statusTiming.dashboardRefreshSec}s</li>
              <li>Alloy scrape interval: ~{statusTiming.scrapeIntervalSec}s</li>
              <li>Typical WAN/device down detection: ~{statusTiming.typicalDetectionSec}s</li>
              <li>Stale collector (no metrics): critical after {statusTiming.metricFreshWindowSec}s silence</li>
              {statusTiming.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </div>

        <div className="tableCard">
          <div className="tableTitle">Integrations</div>
          <div className="kvList">
            <div>
              <strong>Grafana public URL</strong>
              <div className="muted">{grafanaUrl || "—"}</div>
            </div>
          </div>
          <div className="pageActions" style={{ marginTop: 16 }}>
            <button type="button" onClick={resetLayout}>
              Reset my dashboard layout
            </button>
            <button type="button" onClick={onResetSites} disabled={busy}>
              Reset sites from seed
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
