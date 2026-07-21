import express from "express";
import {
  exportNetworkDevicesJson,
  getSiteById,
  markCollectorDevicesSynced,
  networkDevicesContentHash,
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

collectorRouter.get("/:siteId/devices.json", (req, res) => {
  const siteId = req.params.siteId;
  const site = getSiteById(siteId);
  if (!site) {
    return res.status(404).json({ error: "Site not found" });
  }

  const token = extractCollectorToken(req);
  if (!verifyCollectorToken(siteId, token)) {
    return res.status(401).json({ error: "Invalid or missing collector token" });
  }

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
