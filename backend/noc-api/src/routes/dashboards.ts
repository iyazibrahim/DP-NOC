import type { Request, Response } from "express";
import express from "express";
import { z } from "zod";
import { requireJwt, type AuthenticatedRequest } from "../middleware/auth";
import { loadLayout, saveLayout, resetLayout, getDefaultLayout } from "../services/layouts";

export const dashboardsRouter = express.Router();

const widgetSchema = z.object({
  i: z.string().min(1),
  type: z.enum([
    "site_status_grid",
    "site_signal_board",
    "local_devices_board",
    "snmp_device_status",
    "uplink_status",
    "collector_status",
    "alerts_table",
    "top_devices",
    "mini_map",
    "website_summary",
    "site_card",
    "grafana_panel",
    "device_metric_chart",
    "device_metric_bar",
    "device_stat_gauge",
    "device_detail"
  ]),
  // RGL / JSON may send null for Infinity/NaN — coerce before int checks
  x: z.preprocess((v) => {
    const n = Number(v);
    return v == null || !Number.isFinite(n) ? 0 : Math.trunc(n);
  }, z.number().int().min(0)),
  y: z.preprocess((v) => {
    const n = Number(v);
    return v == null || !Number.isFinite(n) ? 0 : Math.trunc(n);
  }, z.number().int().min(0)),
  w: z.preprocess((v) => {
    const n = Number(v);
    return v == null || !Number.isFinite(n) || n < 1 ? 4 : Math.trunc(n);
  }, z.number().int().min(1).max(12)),
  h: z.preprocess((v) => {
    const n = Number(v);
    return v == null || !Number.isFinite(n) || n < 1 ? 4 : Math.trunc(n);
  }, z.number().int().min(1).max(24)),
  config: z.record(z.string()).optional()
});

const layoutSchema = z.object({
  version: z.literal(1),
  widgets: z.array(widgetSchema)
});

dashboardsRouter.get(
  "/me",
  requireJwt(["operator", "wallboard"]),
  (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth?.sub ?? "anonymous";
    return res.json({ layout: loadLayout(userId) });
  }
);

dashboardsRouter.put(
  "/me",
  requireJwt(["operator", "wallboard"]),
  (req: AuthenticatedRequest, res: Response) => {
    const parsed = layoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid layout", details: parsed.error.flatten() });
    }
    const userId = req.auth?.sub ?? "anonymous";
    saveLayout(userId, parsed.data);
    return res.json({ layout: parsed.data });
  }
);

dashboardsRouter.post(
  "/me/reset",
  requireJwt(["operator", "wallboard"]),
  (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth?.sub ?? "anonymous";
    const layout = resetLayout(userId);
    return res.json({ layout });
  }
);

dashboardsRouter.get(
  "/default",
  requireJwt(["operator", "wallboard"]),
  (_req: Request, res: Response) => {
    return res.json({ layout: getDefaultLayout() });
  }
);
