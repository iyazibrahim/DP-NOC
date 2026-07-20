import type { Response } from "express";
import express from "express";
import { requireJwt } from "../middleware/auth";
import { siteList } from "../data/sites";
import { getGlobalWebsites } from "../data/globalWebsites";
import { computeAllSitesStatus } from "../services/status";
import { env } from "../env";

export const websitesRouter = express.Router();

websitesRouter.get(
  "/",
  requireJwt(["operator", "wallboard"]),
  async (_req, res: Response) => {
    const { statuses } = await computeAllSitesStatus();
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

    for (const w of getGlobalWebsites()) {
      const st = bySite.get("global");
      websites.push({
        siteId: "global",
        siteName: "Global / Central",
        name: w.name,
        url: w.url,
        state: st?.websites.state ?? "unknown",
        notes: st?.websites.notes
      });
    }

    return res.json({ websites });
  }
);

websitesRouter.get(
  "/summary",
  requireJwt(["operator", "wallboard"]),
  async (_req, res: Response) => {
    const { statuses } = await computeAllSitesStatus();
    const counts = { healthy: 0, warning: 0, critical: 0, unknown: 0 };
    const bySite = new Map(statuses.map((s) => [s.siteId, s]));
    for (const site of siteList) {
      const n = site.websiteTargets?.length ?? 0;
      if (n <= 0) continue;
      const st = bySite.get(site.id);
      const state = st?.websites.state ?? "unknown";
      counts[state] += n;
    }

    const globalTargets = getGlobalWebsites();
    if (globalTargets.length > 0) {
      const st = bySite.get("global");
      const state = st?.websites.state ?? "unknown";
      counts[state] += globalTargets.length;
    }
    return res.json({ counts, grafanaUrl: env.GRAFANA_PUBLIC_URL });
  }
);
