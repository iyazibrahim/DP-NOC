import fs from "fs";
import path from "path";
import express from "express";
import { requireJwt } from "../middleware/auth";
import {
  listExports,
  runExport,
  resolveExportFile,
  getLatestMonthlyReport,
  getExportPayload,
  ensureExportHtml,
  type ExportPeriod
} from "../services/exports";

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

exportsRouter.get("/:id", requireJwt(["operator", "wallboard"]), (req, res) => {
  const report = getExportPayload(req.params.id);
  if (!report) return res.status(404).json({ error: "Export not found" });
  return res.json({ report });
});

/** Inline A4 HTML report (open in browser → Print → Save as PDF). */
exportsRouter.get("/:id/view", requireJwt(["operator", "wallboard"]), (req, res) => {
  const file = ensureExportHtml(req.params.id) ?? resolveExportFile(req.params.id, "report.html");
  if (!file) return res.status(404).json({ error: "Report HTML not found" });
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("content-disposition", `inline; filename="report.html"`);
  return fs.createReadStream(file).pipe(res);
});

exportsRouter.get("/:id/download/:filename", requireJwt(["operator", "wallboard"]), (req, res) => {
  let file = resolveExportFile(req.params.id, req.params.filename);
  if (!file && req.params.filename === "report.html") {
    file = ensureExportHtml(req.params.id);
  }
  if (!file) return res.status(404).json({ error: "Export file not found" });
  const ext = path.extname(file).toLowerCase();
  const type =
    ext === ".json"
      ? "application/json"
      : ext === ".html"
        ? "text/html; charset=utf-8"
        : "text/csv";
  res.setHeader("content-type", type);
  res.setHeader(
    "content-disposition",
    `${ext === ".html" ? "inline" : "attachment"}; filename="${path.basename(file)}"`
  );
  return fs.createReadStream(file).pipe(res);
});
