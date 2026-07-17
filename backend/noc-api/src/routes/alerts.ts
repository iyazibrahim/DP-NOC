import type { Request, Response } from "express";
import express from "express";
import { requireJwt } from "../middleware/auth";
import { getActiveAlerts } from "../services/alertmanager";

export const alertsRouter = express.Router();

alertsRouter.get("/recent", requireJwt(["operator", "wallboard"]), async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const site = typeof req.query.site === "string" ? req.query.site : null;

  const alerts = await getActiveAlerts();
  const filtered = alerts
    .filter((a) => !site || (a.labels?.site ?? "") === site)
    .slice(0, Number.isFinite(limit) ? limit : 20);

  return res.json({ alerts: filtered });
});

