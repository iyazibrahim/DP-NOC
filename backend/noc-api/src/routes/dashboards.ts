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
    "alerts_table",
    "top_devices",
    "mini_map",
    "website_summary",
    "site_card",
    "grafana_panel"
  ]),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(24),
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
