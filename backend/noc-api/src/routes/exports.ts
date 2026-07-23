import fs from "fs";
import path from "path";
import express from "express";
import { requireJwt } from "../middleware/auth";
import { listExports, runExport, resolveExportFile, getLatestMonthlyReport, type ExportPeriod } from "../services/exports";

export const exportsRouter = express.Router();

exportsRouter.get("/", requireJwt(["operator", "wallboard"]), (_req, res) => {
  return res.json({ exports: listExports() });
});

exportsRouter.get("/latest/monthly", requireJwt(["operator", "wallboard"]), (_req, res) => {
  const report = getLatestMonthlyReport();
  if (!report) return res.json({ report: null });
  return res.json({ report });
});

exportsRouter.post("/run", requireJwt(["operator"]), async (req, res) => {
  const period = (req.body?.period === "monthly" ? "monthly" : "weekly") as ExportPeriod;
  try {
    const record = await runExport(period);
    return res.status(201).json({ export: record });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : "Export failed" });
  }
});

exportsRouter.get("/:id/download/:filename", requireJwt(["operator", "wallboard"]), (req, res) => {
  const file = resolveExportFile(req.params.id, req.params.filename);
  if (!file) return res.status(404).json({ error: "Export file not found" });
  const ext = path.extname(file);
  res.setHeader(
    "content-type",
    ext === ".json" ? "application/json" : "text/csv"
  );
  res.setHeader("content-disposition", `attachment; filename="${path.basename(file)}"`);
  return fs.createReadStream(file).pipe(res);
});
