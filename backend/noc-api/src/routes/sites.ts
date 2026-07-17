import type { Request, Response } from "express";
import express from "express";
import { requireJwt } from "../middleware/auth";
import { siteList, getSiteById } from "../data/sites";
import { computeSiteStatus, computeAllSitesStatus } from "../services/status";

export const sitesRouter = express.Router();

sitesRouter.get("/", requireJwt(["operator"]), async (req: Request, res: Response) => {
  return res.json({ sites: siteList.map((s) => ({ ...s, lan: s.lan ?? {} })) });
});

sitesRouter.get("/:id/status", requireJwt(["operator", "wallboard"]), async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!getSiteById(id)) {
    return res.status(404).json({ error: "Site not found" });
  }

  const status = await computeSiteStatus(id);
  return res.json({ status });
});

sitesRouter.get("/status/all", requireJwt(["operator", "wallboard"]), async (_req: Request, res: Response) => {
  const statuses = await computeAllSitesStatus();
  return res.json({ statuses });
});

