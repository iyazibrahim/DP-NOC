import type { Response } from "express";
import express from "express";
import { requireJwt } from "../middleware/auth";
import { getAllDevices, siteList } from "../data/sites";
import { getActiveAlerts } from "../services/alertmanager";

export const devicesRouter = express.Router();

devicesRouter.get("/", requireJwt(["operator", "wallboard"]), async (_req, res: Response) => {
  return res.json({ devices: getAllDevices() });
});

devicesRouter.get(
  "/top-by-alerts",
  requireJwt(["operator", "wallboard"]),
  async (_req, res: Response) => {
    const devices = getAllDevices();
    const alerts = await getActiveAlerts();
    const firing = alerts.filter((a) => a.status === "firing");

    const scored = devices.map((d) => {
      const count = firing.filter((a) => {
        const site = a.labels?.site ?? "";
        const device = a.labels?.device ?? "";
        return site === d.siteId && (device === d.id || device === "" || !device);
      }).length;
      // Also count site-level alerts without device label (attribute to first device lightly)
      const siteOnly = firing.filter(
        (a) => (a.labels?.site ?? "") === d.siteId && !a.labels?.device
      ).length;
      return {
        ...d,
        alertCount: count + (siteOnly > 0 ? Math.ceil(siteOnly / Math.max(devices.filter((x) => x.siteId === d.siteId).length, 1)) : 0)
      };
    });

    // Prefer true device-labeled matches; also include site-level aggregation rows
    const byDevice = scored.sort((a, b) => b.alertCount - a.alertCount);

    const siteRows = siteList.map((s) => {
      const alertCount = firing.filter((a) => (a.labels?.site ?? "") === s.id).length;
      return {
        id: s.id,
        name: s.name,
        type: "site",
        snmpIp: "",
        vendor: "",
        siteId: s.id,
        siteName: s.name,
        alertCount
      };
    });

    return res.json({
      devices: byDevice,
      sites: siteRows.sort((a, b) => b.alertCount - a.alertCount)
    });
  }
);
