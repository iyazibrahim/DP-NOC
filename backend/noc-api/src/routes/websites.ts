import type { Response } from "express";
import express from "express";
import { requireJwt } from "../middleware/auth";
import { siteList } from "../data/sites";
import { getGlobalWebsites } from "../data/globalWebsites";
import { getWebsiteProbeMetrics } from "../services/websiteMetrics";
import { env } from "../env";

export const websitesRouter = express.Router();

type WebsiteRow = {
  siteId: string;
  siteName: string;
  name: string;
  url: string;
  state: string;
  notes?: string;
  latencyMs: number | null;
  uptime24h: number | null;
  sparkline: number[];
};

async function buildWebsiteRows(): Promise<WebsiteRow[]> {
  const websites: WebsiteRow[] = [];

  for (const site of siteList) {
    for (const w of site.websiteTargets) {
      const metrics = await getWebsiteProbeMetrics(site.id, w.url);
      websites.push({
        siteId: site.id,
        siteName: site.name,
        name: w.name,
        url: w.url,
        state: metrics.state,
        notes: metrics.notes,
        latencyMs: metrics.latencyMs,
        uptime24h: metrics.uptime24h,
        sparkline: metrics.sparkline
      });
    }
  }

  for (const w of getGlobalWebsites()) {
    const metrics = await getWebsiteProbeMetrics("global", w.url);
    websites.push({
      siteId: "global",
      siteName: "Global / Central",
      name: w.name,
      url: w.url,
      state: metrics.state,
      notes: metrics.notes,
      latencyMs: metrics.latencyMs,
      uptime24h: metrics.uptime24h,
      sparkline: metrics.sparkline
    });
  }

  return websites;
}

websitesRouter.get(
  "/",
  requireJwt(["operator", "wallboard"]),
  async (_req, res: Response) => {
    const websites = await buildWebsiteRows();
    return res.json({ websites });
  }
);

websitesRouter.get(
  "/summary",
  requireJwt(["operator", "wallboard"]),
  async (_req, res: Response) => {
    const websites = await buildWebsiteRows();
    const counts = { healthy: 0, warning: 0, critical: 0, unknown: 0 };
    let latencySum = 0;
    let latencyN = 0;
    for (const w of websites) {
      const key = w.state as keyof typeof counts;
      if (key in counts) counts[key] += 1;
      else counts.unknown += 1;
      if (w.latencyMs != null) {
        latencySum += w.latencyMs;
        latencyN += 1;
      }
    }
    return res.json({
      counts,
      avgLatencyMs: latencyN > 0 ? Math.round(latencySum / latencyN) : null,
      grafanaUrl: env.GRAFANA_PUBLIC_URL
    });
  }
);
