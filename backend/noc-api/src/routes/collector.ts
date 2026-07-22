import express from "express";
import {
  exportNetworkDevicesJson,
  getSiteById,
  markCollectorDevicesSynced,
  networkDevicesContentHash,
  toPublicSite,
  upsertNetworkDevice,
  verifyCollectorToken
} from "../data/sites";

export const collectorRouter = express.Router();

function extractCollectorToken(req: express.Request): string {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  const x = req.header("x-collector-token");
  if (x) return x.trim();
  return "";
}

function requireCollectorAuth(
  req: express.Request,
  res: express.Response,
  siteId: string
): boolean {
  const site = getSiteById(siteId);
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return false;
  }
  const token = extractCollectorToken(req);
  if (!verifyCollectorToken(siteId, token)) {
    res.status(401).json({ error: "Invalid or missing collector token" });
    return false;
  }
  return true;
}

collectorRouter.get("/:siteId/devices.json", (req, res) => {
  const siteId = req.params.siteId;
  if (!requireCollectorAuth(req, res, siteId)) return;

  const devices = exportNetworkDevicesJson(siteId);
  const etag = `"${networkDevicesContentHash(siteId)}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "no-store");

  const ifNoneMatch = req.header("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    markCollectorDevicesSynced(siteId);
    return res.status(304).end();
  }

  markCollectorDevicesSynced(siteId);
  res.setHeader("content-type", "application/json");
  return res.send(JSON.stringify(devices, null, 2) + "\n");
});

/**
 * Collector Console → NOC: register or update a network SNMP device.
 * Body: { id?, name, snmpIp, type?, vendor?, snmpCommunity? }
 * If id omitted, derived as {siteId}-{slug(name)}.
 */
collectorRouter.post("/:siteId/devices", (req, res) => {
  const siteId = req.params.siteId;
  if (!requireCollectorAuth(req, res, siteId)) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const snmpIp = typeof body.snmpIp === "string" ? body.snmpIp.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "switch";
  const vendor = typeof body.vendor === "string" ? body.vendor.trim() : "generic";
  const snmpCommunity =
    typeof body.snmpCommunity === "string" ? body.snmpCommunity.trim() : undefined;
  let id = typeof body.id === "string" ? body.id.trim() : "";

  if (!name) return res.status(400).json({ error: "name is required" });
  if (!snmpIp) return res.status(400).json({ error: "snmpIp is required" });

  if (!id) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    id = `${siteId}-${slug || "device"}`;
  }

  const result = upsertNetworkDevice(siteId, {
    id,
    name,
    type,
    snmpIp,
    vendor,
    snmpCommunity
  });
  if (!result) return res.status(404).json({ error: "Site not found" });

  markCollectorDevicesSynced(siteId);
  return res.status(result.created ? 201 : 200).json({
    created: result.created,
    device: result.site.devices?.find((d) => d.id === id),
    site: toPublicSite(result.site),
    devices: exportNetworkDevicesJson(siteId)
  });
});
