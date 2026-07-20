import express from "express";
import { requireJwt } from "../middleware/auth";
import {
  loadRetentionConfig,
  saveRetentionConfig,
  getStorageStats,
  applyRetentionToPrometheus,
  type RetentionConfig
} from "../services/retention";
import {
  loadNotificationsConfig,
  saveNotificationsConfig,
  maskNotificationsConfig,
  mergeNotificationsPatch,
  applyNotificationsToAlertmanager,
  writeAlertmanagerYaml,
  type NotificationsConfig
} from "../services/notifications";
import { STATUS_META } from "../services/status";
import { env } from "../env";

export const settingsRouter = express.Router();

settingsRouter.get("/retention", requireJwt(["operator", "wallboard"]), async (_req, res) => {
  const stats = await getStorageStats();
  return res.json(stats);
});

settingsRouter.patch("/retention", requireJwt(["operator"]), async (req, res) => {
  const body = (req.body ?? {}) as Partial<RetentionConfig>;
  const current = loadRetentionConfig();
  const next: RetentionConfig = {
    ...current,
    ...(typeof body.retentionTime === "string" ? { retentionTime: body.retentionTime } : {}),
    ...(typeof body.retentionSizeGB === "number" ? { retentionSizeGB: body.retentionSizeGB } : {}),
    ...(typeof body.hostScrapeIntervalSec === "number"
      ? { hostScrapeIntervalSec: body.hostScrapeIntervalSec }
      : {}),
    ...(typeof body.icmpScrapeIntervalSec === "number"
      ? { icmpScrapeIntervalSec: body.icmpScrapeIntervalSec }
      : {}),
    ...(typeof body.snmpScrapeIntervalSec === "number"
      ? { snmpScrapeIntervalSec: body.snmpScrapeIntervalSec }
      : {}),
    ...(typeof body.scheduledExportsEnabled === "boolean"
      ? { scheduledExportsEnabled: body.scheduledExportsEnabled }
      : {})
  };
  const saved = saveRetentionConfig(next);
  const stats = await getStorageStats();
  return res.json({ ...stats, config: saved });
});

settingsRouter.post("/retention/apply", requireJwt(["operator"]), async (_req, res) => {
  const result = await applyRetentionToPrometheus();
  return res.json(result);
});

settingsRouter.get("/status-timing", requireJwt(["operator", "wallboard"]), (_req, res) => {
  return res.json({
    dashboardRefreshSec: env.STATUS_DASHBOARD_REFRESH_SEC,
    metricFreshWindowSec: env.STATUS_METRIC_FRESH_SEC,
    typicalDetectionSec: STATUS_META.typicalDetectionSec,
    scrapeIntervalSec: STATUS_META.scrapeIntervalSec,
    notes: [
      "Dashboard polls /api/sites/status/all every ~10s.",
      "Status uses last_over_time over 3m; probe failure (0) shows as critical within ~1 scrape cycle (~60s).",
      "If Alloy stops sending metrics, status becomes critical after ~3m of silence (not unknown).",
      "Alertmanager SiteWANDown fires after 2m of probe_success=0."
    ]
  });
});

settingsRouter.get("/notifications", requireJwt(["operator"]), (_req, res) => {
  const config = loadNotificationsConfig();
  return res.json({
    config: maskNotificationsConfig(config),
    configPath: "data/runtime/notifications.json"
  });
});

settingsRouter.patch("/notifications", requireJwt(["operator"]), (req, res) => {
  const body = (req.body ?? {}) as Partial<NotificationsConfig> & {
    telegram?: Partial<NotificationsConfig["telegram"]>;
    email?: Partial<NotificationsConfig["email"]>;
    webhook?: Partial<NotificationsConfig["webhook"]>;
    route?: Partial<NotificationsConfig["route"]>;
  };
  const current = loadNotificationsConfig();
  const saved = saveNotificationsConfig(mergeNotificationsPatch(current, body));
  return res.json({ config: maskNotificationsConfig(saved) });
});

settingsRouter.post("/notifications/apply", requireJwt(["operator"]), async (_req, res) => {
  const result = await applyNotificationsToAlertmanager();
  return res.json(result);
});

settingsRouter.post("/notifications/test", requireJwt(["operator"]), async (_req, res) => {
  const config = loadNotificationsConfig();
  const enabled =
    (config.telegram.enabled && config.telegram.botToken) ||
    (config.email.enabled && config.email.smarthost) ||
    (config.webhook.enabled && config.webhook.url);
  if (!enabled) {
    return res.status(400).json({ error: "Enable and save at least one notification channel first." });
  }
  writeAlertmanagerYaml(config);
  return res.json({
    ok: true,
    message:
      "Configuration written. Save + Apply to Alertmanager, then wait for the next firing alert — or trigger a test by stopping Alloy briefly on a site."
  });
});
