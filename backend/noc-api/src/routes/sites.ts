import type { Request, Response } from "express";
import express from "express";
import { requireJwt } from "../middleware/auth";
import {
  siteList,
  getSiteById,
  addDevice,
  updateDevice,
  removeDevice,
  type SiteDevice
} from "../data/sites";
import { computeSiteStatus, computeAllSitesStatus } from "../services/status";

export const sitesRouter = express.Router();

function parseDeviceBody(body: unknown): SiteDevice | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id.trim() : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const type = typeof b.type === "string" ? b.type.trim() : "switch";
  const snmpIp = typeof b.snmpIp === "string" ? b.snmpIp.trim() : "";
  const vendor = typeof b.vendor === "string" ? b.vendor.trim() : "generic";
  if (!id) return { error: "id is required" };
  if (!name) return { error: "name is required" };
  if (!snmpIp) return { error: "snmpIp is required" };
  return { id, name, type: type || "switch", snmpIp, vendor: vendor || "generic" };
}

sitesRouter.get("/", requireJwt(["operator", "wallboard"]), async (_req: Request, res: Response) => {
  return res.json({ sites: siteList });
});

sitesRouter.get("/status/all", requireJwt(["operator", "wallboard"]), async (_req: Request, res: Response) => {
  const statuses = await computeAllSitesStatus();
  return res.json({ statuses });
});

sitesRouter.get("/:id/status", requireJwt(["operator", "wallboard"]), async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!getSiteById(id)) {
    return res.status(404).json({ error: "Site not found" });
  }

  const status = await computeSiteStatus(id);
  return res.json({ status });
});

sitesRouter.post(
  "/:id/devices",
  requireJwt(["operator"]),
  async (req: Request, res: Response) => {
    const siteId = req.params.id;
    if (!getSiteById(siteId)) {
      return res.status(404).json({ error: "Site not found" });
    }
    const parsed = parseDeviceBody(req.body);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    try {
      const site = addDevice(siteId, parsed);
      return res.status(201).json({ site });
    } catch (e) {
      return res.status(409).json({ error: e instanceof Error ? e.message : "Conflict" });
    }
  }
);

sitesRouter.patch(
  "/:id/devices/:deviceId",
  requireJwt(["operator"]),
  async (req: Request, res: Response) => {
    const { id: siteId, deviceId } = req.params;
    if (!getSiteById(siteId)) {
      return res.status(404).json({ error: "Site not found" });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<Omit<SiteDevice, "id">> = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.type === "string") patch.type = body.type.trim();
    if (typeof body.snmpIp === "string") patch.snmpIp = body.snmpIp.trim();
    if (typeof body.vendor === "string") patch.vendor = body.vendor.trim();
    const site = updateDevice(siteId, deviceId, patch);
    if (!site) {
      return res.status(404).json({ error: "Device not found" });
    }
    return res.json({ site });
  }
);

sitesRouter.delete(
  "/:id/devices/:deviceId",
  requireJwt(["operator"]),
  async (req: Request, res: Response) => {
    const { id: siteId, deviceId } = req.params;
    if (!getSiteById(siteId)) {
      return res.status(404).json({ error: "Site not found" });
    }
    const site = removeDevice(siteId, deviceId);
    if (!site) {
      return res.status(404).json({ error: "Device not found" });
    }
    return res.json({ site });
  }
);

sitesRouter.get("/:id", requireJwt(["operator", "wallboard"]), async (req: Request, res: Response) => {
  const site = getSiteById(req.params.id);
  if (!site) {
    return res.status(404).json({ error: "Site not found" });
  }
  return res.json({ site });
});
