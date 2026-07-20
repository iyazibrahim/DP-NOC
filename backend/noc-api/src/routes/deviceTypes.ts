import express from "express";
import { requireJwt } from "../middleware/auth";
import { listDeviceTypes, addDeviceType, type DeviceTypeDef } from "../data/deviceTypes";
import type { DeviceKind } from "../data/sites";

export const deviceTypesRouter = express.Router();

deviceTypesRouter.get("/", requireJwt(["operator", "wallboard"]), (_req, res) => {
  return res.json({ types: listDeviceTypes() });
});

deviceTypesRouter.post("/", requireJwt(["operator"]), (req, res) => {
  const body = (req.body ?? {}) as Partial<DeviceTypeDef>;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const kind = (body.kind === "server" || body.kind === "network" ? body.kind : undefined) as
    | DeviceKind
    | undefined;
  if (!label) return res.status(400).json({ error: "label is required" });
  if (!kind) return res.status(400).json({ error: "kind must be server or network" });
  try {
    const type = addDeviceType({
      id: typeof body.id === "string" ? body.id : undefined,
      label,
      kind
    });
    return res.status(201).json({ type, types: listDeviceTypes() });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed to add type" });
  }
});
