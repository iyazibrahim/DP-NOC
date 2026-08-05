import type { Response } from "express";
import express from "express";
import { requireJwt } from "../middleware/auth";
import { siteList, getSiteById } from "../data/sites";
import { getGlobalWebsites } from "../data/globalWebsites";
import { getWebsiteProbeMetrics, getWebsiteDetailMetrics, type WebsiteRange } from "../services/websiteMetrics";
import { getHistoryIncidents, getOpenIncidents } from "../data/incidents";
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

function parseRange(raw: string): WebsiteRange {
  if (raw === "7d" || raw === "30d") return raw;
  return "24h";
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

websitesRouter.get(
  "/detail",
  requireJwt(["operator", "wallboard"]),
  async (req, res: Response) => {
    const siteId = String(req.query.siteId ?? "").trim();
    const url = String(req.query.url ?? "").trim();
    const range = parseRange(String(req.query.range ?? "24h").trim());

    if (!siteId || !url) {
      return res.status(400).json({ error: "siteId and url are required" });
    }

    let name = url;
    let siteName = siteId;
    if (siteId === "global") {
      siteName = "Global / Central";
      const match = getGlobalWebsites().find((w) => w.url === url);
      if (!match) return res.status(404).json({ error: "Website not found" });
      name = match.name;
    } else {
      const site = getSiteById(siteId);
      if (!site) return res.status(404).json({ error: "Site not found" });
      siteName = site.name;
      const match = site.websiteTargets.find((w) => w.url === url);
      if (!match) return res.status(404).json({ error: "Website not found" });
      name = match.name;
    }

    const detail = await getWebsiteDetailMetrics(siteId, url, range, { name, siteName });
    const relatedIncidents = [...getOpenIncidents(), ...getHistoryIncidents()]
      .filter((i) => {
        if (i.siteId !== siteId) return false;
        const hay = `${i.title} ${i.detail}`.toLowerCase();
        return (
          hay.includes("website") ||
          hay.includes("sitewebsitedown") ||
          hay.includes(url.toLowerCase()) ||
          hay.includes(name.toLowerCase())
        );
      })
      .slice(0, 10)
      .map((i) => ({
        id: i.id,
        title: i.title,
        detail: i.detail,
        openedAt: i.openedAt,
        resolvedAt: i.resolvedAt,
        acknowledgedAt: i.acknowledgedAt
      }));

    return res.json({ website: detail, relatedIncidents });
  }
);
