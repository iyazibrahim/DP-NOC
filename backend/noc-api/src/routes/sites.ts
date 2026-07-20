import type { Request, Response } from "express";
import express from "express";
import { requireJwt } from "../middleware/auth";
import {
  siteList,
  getSiteById,
  getSiteCatalog,
  createSite,
  updateSite,
  deleteSite,
  resetSitesFromSeed,
  addDevice,
  updateDevice,
  removeDevice,
  exportNetworkDevicesJson,
  addWebsite,
  updateWebsite,
  removeWebsite,
  type SiteDevice,
  type DeviceKind,
  type Site
} from "../data/sites";
import { computeSiteStatus, computeAllSitesStatus } from "../services/status";
import { applyWebsiteProbes } from "../services/websiteProbes";
import { discoverDevicesForSite } from "../services/deviceDiscovery";
import { addGlobalWebsite, removeGlobalWebsite, updateGlobalWebsite, getGlobalWebsites } from "../data/globalWebsites";

export const sitesRouter = express.Router();

function asGlobalSite(siteId: "global"): Site {
  return {
    id: siteId,
    name: "Global / Central",
    lat: 0,
    lng: 0,
    devices: [],
    wan: { dnsTarget: "1.1.1.1", vpsTarget: "139.99.88.174" },
    websiteTargets: getGlobalWebsites(),
    address: undefined,
    notes: undefined,
    createdAt: new Date().toISOString()
  };
}

function parseDeviceBody(body: unknown): SiteDevice | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id.trim() : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const type = typeof b.type === "string" ? b.type.trim() : "switch";
  const kind = (b.kind === "server" || b.kind === "network" ? b.kind : "network") as DeviceKind;
  const snmpIp = typeof b.snmpIp === "string" ? b.snmpIp.trim() : "";
  const hostMetricId = typeof b.hostMetricId === "string" ? b.hostMetricId.trim() : "";
  const vendor = typeof b.vendor === "string" ? b.vendor.trim() : "generic";
  if (!id) return { error: "id is required" };
  if (!name) return { error: "name is required" };
  if (kind === "network" && !snmpIp) return { error: "snmpIp is required for network devices" };
  if (kind === "server" && !hostMetricId) {
    return {
      id,
      name,
      type: type || "server",
      kind,
      hostMetricId: id,
      vendor: vendor || "generic"
    };
  }
  return {
    id,
    name,
    type: type || (kind === "server" ? "server" : "switch"),
    kind,
    snmpIp: kind === "network" ? snmpIp : undefined,
    hostMetricId: kind === "server" ? hostMetricId || id : undefined,
    vendor: vendor || "generic"
  };
}

sitesRouter.get("/catalog", requireJwt(["operator", "wallboard"]), (_req, res) => {
  return res.json({ sites: getSiteCatalog() });
});

sitesRouter.post("/reset-from-seed", requireJwt(["operator"]), (_req, res) => {
  const sites = resetSitesFromSeed();
  return res.json({ sites });
});

sitesRouter.get("/", requireJwt(["operator", "wallboard"]), async (_req: Request, res: Response) => {
  return res.json({ sites: siteList });
});

sitesRouter.post("/", requireJwt(["operator"]), async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const lat = typeof body.lat === "number" ? body.lat : Number(body.lat);
  const lng = typeof body.lng === "number" ? body.lng : Number(body.lng);
  if (!name) return res.status(400).json({ error: "name is required" });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng are required" });
  }
  const wanBody = body.wan as Site["wan"] | undefined;
  const site = createSite({
    name,
    lat,
    lng,
    address: typeof body.address === "string" ? body.address : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    wan: wanBody
  });
  return res.status(201).json({ site });
});

sitesRouter.get("/status/all", requireJwt(["operator", "wallboard"]), async (_req: Request, res: Response) => {
  const result = await computeAllSitesStatus();
  return res.json(result);
});

sitesRouter.get("/:id/status", requireJwt(["operator", "wallboard"]), async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!getSiteById(id)) {
    return res.status(404).json({ error: "Site not found" });
  }
  const status = await computeSiteStatus(id);
  return res.json({ status });
});

sitesRouter.get("/:id/discovered-devices", requireJwt(["operator", "wallboard"]), async (req, res) => {
  const siteId = req.params.id;
  if (!getSiteById(siteId)) {
    return res.status(404).json({ error: "Site not found" });
  }
  try {
    const devices = await discoverDevicesForSite(siteId);
    return res.json({ devices });
  } catch (e) {
    return res.status(502).json({
      error: e instanceof Error ? e.message : "Discovery failed"
    });
  }
});

sitesRouter.get("/:id/export/devices.json", requireJwt(["operator"]), (req, res) => {
  const siteId = req.params.id;
  if (!getSiteById(siteId)) {
    return res.status(404).json({ error: "Site not found" });
  }
  const devices = exportNetworkDevicesJson(siteId);
  res.setHeader("content-type", "application/json");
  res.setHeader("content-disposition", `attachment; filename="${siteId}-devices.json"`);
  return res.send(JSON.stringify(devices, null, 2) + "\n");
});

sitesRouter.post("/:id/websites/apply-probes", requireJwt(["operator"]), async (req, res) => {
  const siteId = req.params.id;
  if (siteId !== "global" && !getSiteById(siteId)) {
    return res.status(404).json({ error: "Site not found" });
  }
  const result = await applyWebsiteProbes();
  return res.json(result);
});

sitesRouter.post("/:id/websites", requireJwt(["operator"]), (req, res) => {
  const siteId = req.params.id;
  if (siteId !== "global" && !getSiteById(siteId)) {
    return res.status(404).json({ error: "Site not found" });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name : "";
  const url = typeof body.url === "string" ? body.url : "";
  try {
    if (siteId === "global") {
      addGlobalWebsite({ name, url });
      return res.status(201).json({ site: asGlobalSite("global") });
    }
    const site = addWebsite(siteId, { name, url });
    return res.status(201).json({ site });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Add failed" });
  }
});

sitesRouter.patch("/:id/websites", requireJwt(["operator"]), (req, res) => {
  const siteId = req.params.id;
  if (siteId !== "global" && !getSiteById(siteId)) {
    return res.status(404).json({ error: "Site not found" });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const currentUrl = typeof body.url === "string" ? body.url : "";
  if (!currentUrl) return res.status(400).json({ error: "url (current) is required" });
  try {
    if (siteId === "global") {
      updateGlobalWebsite(currentUrl, {
        name: typeof body.name === "string" ? body.name : undefined,
        newUrl: typeof body.newUrl === "string" ? body.newUrl : undefined
      });
      return res.json({ site: asGlobalSite("global") });
    }
    const site = updateWebsite(siteId, currentUrl, {
      name: typeof body.name === "string" ? body.name : undefined,
      url: typeof body.newUrl === "string" ? body.newUrl : undefined
    });
    if (!site) return res.status(404).json({ error: "Website not found" });
    return res.json({ site });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Update failed" });
  }
});

sitesRouter.delete("/:id/websites", requireJwt(["operator"]), (req, res) => {
  const siteId = req.params.id;
  if (siteId !== "global" && !getSiteById(siteId)) {
    return res.status(404).json({ error: "Site not found" });
  }
  const url = typeof req.body?.url === "string" ? req.body.url : typeof req.query.url === "string" ? req.query.url : "";
  if (!url) return res.status(400).json({ error: "url is required" });
  if (siteId === "global") {
    removeGlobalWebsite(url);
    return res.json({ site: asGlobalSite("global") });
  }
  const site = removeWebsite(siteId, url);
  if (!site) return res.status(404).json({ error: "Website not found" });
  return res.json({ site });
});

sitesRouter.patch("/:id", requireJwt(["operator"]), async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!getSiteById(id)) {
    return res.status(404).json({ error: "Site not found" });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Parameters<typeof updateSite>[1] = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.address === "string") patch.address = body.address;
  if (typeof body.notes === "string") patch.notes = body.notes;
  if (typeof body.lat === "number") patch.lat = body.lat;
  if (typeof body.lng === "number") patch.lng = body.lng;
  if (body.wan && typeof body.wan === "object") {
    const w = body.wan as Record<string, unknown>;
    patch.wan = {
      dnsTarget: typeof w.dnsTarget === "string" ? w.dnsTarget : "1.1.1.1",
      vpsTarget: typeof w.vpsTarget === "string" ? w.vpsTarget : "139.99.88.174"
    };
  }
  if (Array.isArray(body.websiteTargets)) {
    patch.websiteTargets = body.websiteTargets as Array<{ name: string; url: string }>;
  }
  const site = updateSite(id, patch);
  return res.json({ site });
});

sitesRouter.delete("/:id", requireJwt(["operator"]), async (req: Request, res: Response) => {
  try {
    const ok = deleteSite(req.params.id);
    if (!ok) return res.status(404).json({ error: "Site not found" });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Delete failed" });
  }
});

sitesRouter.post("/:id/devices", requireJwt(["operator"]), async (req: Request, res: Response) => {
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
});

sitesRouter.patch("/:id/devices/:deviceId", requireJwt(["operator"]), async (req: Request, res: Response) => {
  const { id: siteId, deviceId } = req.params;
  if (!getSiteById(siteId)) {
    return res.status(404).json({ error: "Site not found" });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Partial<Omit<SiteDevice, "id">> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.type === "string") patch.type = body.type.trim();
  if (body.kind === "server" || body.kind === "network") patch.kind = body.kind;
  if (typeof body.snmpIp === "string") patch.snmpIp = body.snmpIp.trim();
  if (typeof body.hostMetricId === "string") patch.hostMetricId = body.hostMetricId.trim();
  if (typeof body.vendor === "string") patch.vendor = body.vendor.trim();
  const site = updateDevice(siteId, deviceId, patch);
  if (!site) {
    return res.status(404).json({ error: "Device not found" });
  }
  return res.json({ site });
});

sitesRouter.delete("/:id/devices/:deviceId", requireJwt(["operator"]), async (req: Request, res: Response) => {
  const { id: siteId, deviceId } = req.params;
  if (!getSiteById(siteId)) {
    return res.status(404).json({ error: "Site not found" });
  }
  const site = removeDevice(siteId, deviceId);
  if (!site) {
    return res.status(404).json({ error: "Device not found" });
  }
  return res.json({ site });
});

sitesRouter.get("/:id", requireJwt(["operator", "wallboard"]), async (req: Request, res: Response) => {
  const site = getSiteById(req.params.id);
  if (!site) {
    return res.status(404).json({ error: "Site not found" });
  }
  return res.json({ site });
});
