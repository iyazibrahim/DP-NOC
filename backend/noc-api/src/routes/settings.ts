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
    metricFreshWindowSec: STATUS_META.metricFreshWindowSec,
    typicalDetectionSec: STATUS_META.typicalDetectionSec,
    scrapeIntervalSec: STATUS_META.scrapeIntervalSec,
    notes: [
      "Dashboard polls /api/sites/status/all every ~5s (UI refresh only — does not change detection speed).",
      `Status and gauges use last_over_time over ${STATUS_META.metricFreshWindowSec}s; missing samples = DOWN for uplink/collector.`,
      "Critical Internet DOWN requires both wan_dns and wan_vps failed (quorum). Single-path failure is warning.",
      "Collector offline suppresses uplink critical (cannot confirm WAN when metrics path is down).",
      "Incidents open only after ~90s sustained critical; Alertmanager SiteUplinkDown/SiteCollectorDown use for: 2m.",
      "Target page time ~2 minutes — collector ICMP scrape must stay 15s–30s (not Alloy’s 60s default).",
      "If uplink flickers while the collector is healthy, check ICMP scrape interval on the collector."
    ]
  });
});

/** HetrixTools integration status (token never returned). */
settingsRouter.get("/hetrix", requireJwt(["operator", "wallboard"]), async (_req, res) => {
  const { hetrixEnabled, listHetrixMonitors } = await import("../services/hetrixtools");
  const configured = hetrixEnabled();
  if (!configured) {
    return res.json({
      configured: false,
      locations: env.HETRIXTOOLS_LOCATIONS,
      monitorCount: null,
      ok: false,
      message:
        "HETRIXTOOLS_API_TOKEN is not set on noc-app. Add it in Dokploy → Environment, then redeploy."
    });
  }
  try {
    const monitors = await listHetrixMonitors(true);
    return res.json({
      configured: true,
      locations: env.HETRIXTOOLS_LOCATIONS,
      monitorCount: monitors.length,
      ok: true,
      message: `Connected — ${monitors.length} website monitor(s) visible to API`
    });
  } catch (e) {
    return res.json({
      configured: true,
      locations: env.HETRIXTOOLS_LOCATIONS,
      monitorCount: null,
      ok: false,
      message: e instanceof Error ? e.message : String(e)
    });
  }
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
