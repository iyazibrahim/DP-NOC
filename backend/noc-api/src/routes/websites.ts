import type { Response } from "express";
import express from "express";
import { requireJwt } from "../middleware/auth";
import { siteList } from "../data/sites";
import { computeAllSitesStatus } from "../services/status";
import { env } from "../env";

export const websitesRouter = express.Router();

websitesRouter.get(
  "/",
  requireJwt(["operator", "wallboard"]),
  async (_req, res: Response) => {
    const statuses = await computeAllSitesStatus();
    const bySite = new Map(statuses.map((s) => [s.siteId, s]));

    const websites = siteList.flatMap((site) =>
      site.websiteTargets.map((w) => {
        const st = bySite.get(site.id);
        return {
          siteId: site.id,
          siteName: site.name,
          name: w.name,
          url: w.url,
          state: st?.websites.state ?? "unknown",
          notes: st?.websites.notes
        };
      })
    );

    return res.json({ websites });
  }
);

websitesRouter.get(
  "/summary",
  requireJwt(["operator", "wallboard"]),
  async (_req, res: Response) => {
    const statuses = await computeAllSitesStatus();
    const counts = { healthy: 0, warning: 0, critical: 0, unknown: 0 };
    for (const s of statuses) {
      counts[s.websites.state] += 1;
    }
    return res.json({ counts, grafanaUrl: env.GRAFANA_PUBLIC_URL });
  }
);
