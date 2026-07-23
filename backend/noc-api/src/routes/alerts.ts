import type { Response } from "express";
import express from "express";
import { requireJwt, type AuthenticatedRequest } from "../middleware/auth";
import { getActiveAlerts } from "../services/alertmanager";
import { computeAllSitesStatus } from "../services/status";
import { listSyncedIncidents } from "../services/incidents";
import { acknowledgeIncident } from "../data/incidents";

export const alertsRouter = express.Router();

alertsRouter.get("/recent", requireJwt(["operator", "wallboard"]), async (req, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const site = typeof req.query.site === "string" ? req.query.site : null;

  const alerts = await getActiveAlerts();
  const filtered = alerts
    .filter((a) => !site || (a.labels?.site ?? "") === site)
    .slice(0, Number.isFinite(limit) ? limit : 20);

  return res.json({ alerts: filtered });
});

alertsRouter.get(
  "/incidents",
  requireJwt(["operator", "wallboard"]),
  async (_req, res: Response) => {
    const { statuses } = await computeAllSitesStatus();
    const { open, history } = listSyncedIncidents(statuses);
    return res.json({ open, history });
  }
);

alertsRouter.post(
  "/incidents/:id/ack",
  requireJwt(["operator"]),
  (req: AuthenticatedRequest, res: Response) => {
    const id = req.params.id;
    const by = req.auth?.sub ?? "operator";
    const row = acknowledgeIncident(id, by);
    if (!row) return res.status(404).json({ error: "Incident not found" });
    return res.json({ incident: row });
  }
);
