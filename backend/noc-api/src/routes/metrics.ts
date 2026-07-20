import express from "express";
import { requireJwt } from "../middleware/auth";
import { METRIC_PRESETS, buildQuery, queryInstant, queryRange } from "../services/metrics";

export const metricsRouter = express.Router();

metricsRouter.get("/presets", requireJwt(["operator", "wallboard"]), (_req, res) => {
  return res.json({ presets: METRIC_PRESETS });
});

metricsRouter.get("/query", requireJwt(["operator", "wallboard"]), async (req, res) => {
  const query = typeof req.query.query === "string" ? req.query.query : "";
  if (!query) return res.status(400).json({ error: "query is required" });
  try {
    const data = await queryInstant(query);
    return res.json({ data });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : "Query failed" });
  }
});

metricsRouter.get("/query_range", requireJwt(["operator", "wallboard"]), async (req, res) => {
  let query = typeof req.query.query === "string" ? req.query.query : "";
  const preset = typeof req.query.preset === "string" ? req.query.preset : "";
  const siteId = typeof req.query.siteId === "string" ? req.query.siteId : "";
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : "";
  const hours = Number(req.query.hours ?? 1);
  const step = typeof req.query.step === "string" ? req.query.step : "60s";

  if (preset && siteId && deviceId) {
    const built = buildQuery(preset, siteId, deviceId);
    if (!built) return res.status(400).json({ error: "Unknown preset" });
    query = built;
  }
  if (!query) return res.status(400).json({ error: "query or preset+siteId+deviceId required" });

  try {
    const data = await queryRange(query, Number.isFinite(hours) ? hours : 1, step);
    return res.json({ data, query });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : "Query failed" });
  }
});

metricsRouter.get("/instant", requireJwt(["operator", "wallboard"]), async (req, res) => {
  const preset = typeof req.query.preset === "string" ? req.query.preset : "";
  const siteId = typeof req.query.siteId === "string" ? req.query.siteId : "";
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : "";
  if (!preset || !siteId || !deviceId) {
    return res.status(400).json({ error: "preset, siteId, deviceId required" });
  }
  const query = buildQuery(preset, siteId, deviceId);
  if (!query) return res.status(400).json({ error: "Unknown preset" });
  try {
    const data = await queryInstant(query);
    return res.json({ data, query });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : "Query failed" });
  }
});
