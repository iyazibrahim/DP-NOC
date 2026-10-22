import fs from "fs";
import path from "path";
import { siteList, type Site } from "../data/sites";
import { listIncidents, type Incident } from "../data/incidents";
import { env } from "../env";
import { promQuery, promQueryRange, parseFirstVectorValue, type PromQueryResult } from "./prometheus";
import { collectLineUseDays } from "./siteNetwork";
import { calendarMonthSlots, calendarWeekSlots, sumLineUseDays, type DaySlot, type LineUseDay } from "./lineUseWindow";
import { renderExportReportHtml } from "./exportReportHtml";

export type ExportPeriod = "weekly" | "monthly";

export type ExportReportFile = {
  file: string;
  title: string;
  scope: string;
};

export type ExportRecord = {
  id: string;
  period: ExportPeriod;
  createdAt: string;
  dir: string;
  files: string[];
  reports?: ExportReportFile[];
};

export type ReportBytes = {
  date: string;
  inBytes: number | null;
  outBytes: number | null;
};

export type ReportAccessPoint = {
  name: string;
  inBytes: number | null;
  outBytes: number | null;
  note?: string;
};

export type ReportLocation = {
  siteId: string;
  name: string;
  address: string;
  probeUptimePct: number | null;
  internetUptimePct: number | null;
  lineInBytes: number | null;
  lineOutBytes: number | null;
  lineDays: ReportBytes[];
  accessPoints: ReportAccessPoint[];
};

export type ReportIncident = {
  id: string;
  title: string;
  siteId: string;
  siteName: string;
  kind: string;
  detail: string;
  openedAt: string;
  resolvedAt?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
};

export type ExportReportPayload = {
  id: string;
  period: ExportPeriod;
  scope: string;
  scopeName: string;
  generatedAt: string;
  rangeLabel: string;
  locations: ReportLocation[];
  skipped: Array<{ siteId: string; name: string }>;
  incidents: {
    opened: number;
    recovered: number;
    stillFailing: number;
    acknowledged: number;
    timeline: ReportIncident[];
  };
};

function exportsRoot(): string {
  const candidates = [
    path.join(process.cwd(), "data/exports"),
    path.join(__dirname, "../../data/exports"),
    "/app/data/exports"
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  const preferred = path.join(process.cwd(), "data/exports");
  fs.mkdirSync(preferred, { recursive: true });
  return preferred;
}

function listExportDirs(period: ExportPeriod): string[] {
  const base = path.join(exportsRoot(), period);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(base, d.name))
    .sort()
    .reverse();
}

function pruneExports(period: ExportPeriod, keep = 12) {
  const dirs = listExportDirs(period);
  for (const dir of dirs.slice(keep)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readManifest(dir: string): ExportReportFile[] | undefined {
  const file = path.join(dir, "manifest.json");
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { reports?: ExportReportFile[] };
    return Array.isArray(parsed.reports) ? parsed.reports : undefined;
  } catch {
    return undefined;
  }
}

function escapePromLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isApLike(d: { type: string; kind: string; vendor: string }): boolean {
  if (d.kind !== "network") return false;
  const type = (d.type || "").toLowerCase();
  const vendor = (d.vendor || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (type === "ap" || /access.?point|wifi|wireless/.test(type)) return true;
  if (/cambium|omada|tplink|ubiquiti|unifi/.test(vendor)) return true;
  return false;
}

async function avgQuery(query: string): Promise<number | null> {
  try {
    const data = await promQuery(query);
    const value = parseFirstVectorValue(data);
    return value != null && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function sumMatrix(data: PromQueryResult, windowStart: number, nowSec: number): Map<string, number> {
  const totals = new Map<string, number>();
  if (data.resultType !== "matrix" || !Array.isArray(data.result)) return totals;
  for (const row of data.result) {
    const device = row.metric?.device;
    if (!device) continue;
    let sum = 0;
    let seen = false;
    for (const point of row.values ?? []) {
      const ts = Number(point[0]);
      const value = Number(point[1]);
      if (!Number.isFinite(ts) || ts <= windowStart || ts > nowSec + 1) continue;
      if (!Number.isFinite(value) || value < 0) continue;
      sum += value;
      seen = true;
    }
    if (seen) totals.set(device, (totals.get(device) ?? 0) + sum);
  }
  return totals;
}

async function accessPointBytes(
  site: Site,
  windowStart: number,
  nowSec: number
): Promise<ReportAccessPoint[]> {
  const aps = site.devices.filter((d) => isApLike(d));
  if (aps.length === 0) return [];
  const s = escapePromLabel(site.id);
  const query = (metric: string) =>
    `sum by (device) (max by (device, ifIndex) (increase(${metric}{site="${s}"}[1h])))`;
  let inbound = new Map<string, number>();
  let outbound = new Map<string, number>();
  try {
    const [inn, out] = await Promise.all([
      promQueryRange(query("ifHCInOctets"), windowStart, nowSec, "3600"),
      promQueryRange(query("ifHCOutOctets"), windowStart, nowSec, "3600")
    ]);
    inbound = sumMatrix(inn, windowStart, nowSec);
    outbound = sumMatrix(out, windowStart, nowSec);
  } catch {
    inbound = new Map();
    outbound = new Map();
  }
  return aps.map((ap) => {
    const down = inbound.has(ap.id) ? inbound.get(ap.id)! : null;
    const up = outbound.has(ap.id) ? outbound.get(ap.id)! : null;
    if (down == null && up == null) {
      return { name: ap.nickname || ap.name, inBytes: null, outBytes: null, note: "No byte counters" };
    }
    return { name: ap.nickname || ap.name, inBytes: down ?? 0, outBytes: up ?? 0 };
  });
}

function mapIncident(i: Incident): ReportIncident {
  return {
    id: i.id,
    title: i.title,
    siteId: i.siteId,
    siteName: i.siteName,
    kind: String(i.kind),
    detail: i.detail,
    openedAt: i.openedAt,
    resolvedAt: i.resolvedAt,
    acknowledgedAt: i.acknowledgedAt,
    acknowledgedBy: i.acknowledgedBy
  };
}

function incidentsBetween(startSec: number, endSec: number, siteId?: string): ReportIncident[] {
  return listIncidents()
    .filter((i) => {
      if (siteId && i.siteId !== siteId) return false;
      const opened = new Date(i.openedAt).getTime();
      return Number.isFinite(opened) && opened >= startSec * 1000 && opened <= endSec * 1000;
    })
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    .map(mapIncident);
}

function incidentSummary(rows: ReportIncident[]): ExportReportPayload["incidents"] {
  return {
    opened: rows.length,
    recovered: rows.filter((i) => Boolean(i.resolvedAt)).length,
    stillFailing: rows.filter((i) => !i.resolvedAt).length,
    acknowledged: rows.filter((i) => Boolean(i.acknowledgedAt)).length,
    timeline: rows
  };
}

function rangeLabel(slots: DaySlot[]): string {
  const first = slots[0]?.date;
  const last = slots[slots.length - 1]?.date;
  const fmt = (ymd?: string) => {
    if (!ymd) return "";
    const [y, m, d] = ymd.split("-").map(Number);
    return new Intl.DateTimeFormat("en-MY", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(new Date(Date.UTC(y, (m || 1) - 1, d || 1)));
  };
  if (!first) return "";
  if (!last || first === last) return fmt(first);
  return `${fmt(first)} – ${fmt(last)}`;
}

async function locationFacts(
  site: Site,
  period: ExportPeriod,
  windowStart: number,
  nowSec: number,
  rangeSec: number
): Promise<{ location: ReportLocation; hasData: boolean; incidents: ReportIncident[] }> {
  const siteLabel = escapePromLabel(site.id);
  const range = `${rangeSec}s`;
  const [probe, internet, line, accessPoints, incidents] = await Promise.all([
    avgQuery(
      `avg_over_time((max(up{site="${siteLabel}",job=~"site_host|integrations/unix"}))[${range}:5m])`
    ),
    avgQuery(
      `avg_over_time((max(probe_success{site="${siteLabel}",check=~"wan_dns|wan_dns2"}) * max(probe_success{site="${siteLabel}",check="wan_vps"}))[${range}:5m])`
    ),
    (async (): Promise<LineUseDay[]> => {
      const wan = site.wanUplink;
      if (!wan?.deviceId || !wan.ifName) return [];
      const collected = await collectLineUseDays(site.id, wan.deviceId, wan.ifName);
      return period === "weekly" ? collected.weekDays : collected.monthDays;
    })(),
    accessPointBytes(site, windowStart, nowSec),
    Promise.resolve(incidentsBetween(windowStart, nowSec, site.id))
  ]);

  const totals = sumLineUseDays(line);
  const lineSeen = line.some((d) => d.inBytes != null || d.outBytes != null);
  const apSeen = accessPoints.some((ap) => ap.inBytes != null || ap.outBytes != null);
  const hasData = lineSeen || apSeen || probe != null || internet != null || incidents.length > 0;
  return {
    hasData,
    incidents,
    location: {
      siteId: site.id,
      name: site.name,
      address: site.address ?? "",
      probeUptimePct: probe == null ? null : probe * 100,
      internetUptimePct: internet == null ? null : internet * 100,
      lineInBytes: lineSeen ? totals.inBytes : null,
      lineOutBytes: lineSeen ? totals.outBytes : null,
      lineDays: line.map((d) => ({ date: d.date, inBytes: d.inBytes, outBytes: d.outBytes })),
      accessPoints
    }
  };
}

function writeReport(dir: string, file: string, payload: ExportReportPayload) {
  fs.writeFileSync(path.join(dir, file.replace(/\.html$/, ".json")), JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, file), renderExportReportHtml(payload), "utf8");
}

export async function runExport(period: ExportPeriod): Promise<ExportRecord> {
  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const slots = period === "weekly" ? calendarWeekSlots(env.NOC_TZ, now) : calendarMonthSlots(env.NOC_TZ, now);
  const windowStart = slots[0]?.start ?? nowSec;
  const rangeSec = Math.max(3600, nowSec - windowStart);
  const label = rangeLabel(slots);
  const stamp = now.toISOString().slice(0, 10);
  const dirName = `${stamp}-${nowSec}`;
  const dir = path.join(exportsRoot(), period, dirName);
  fs.mkdirSync(dir, { recursive: true });

  const facts = [];
  for (const site of siteList) {
    facts.push(await locationFacts(site, period, windowStart, nowSec, rangeSec));
  }

  const included = facts.filter((f) => f.hasData);
  const skipped = facts.filter((f) => !f.hasData).map((f) => ({ siteId: f.location.siteId, name: f.location.name }));
  const generatedAt = now.toISOString();
  const baseId = `${period}-${dirName}`;
  const reports: ExportReportFile[] = [];

  for (const fact of included) {
    const file = `site-${fact.location.siteId}.html`;
    writeReport(dir, file, {
      id: `${baseId}-${fact.location.siteId}`,
      period,
      scope: fact.location.siteId,
      scopeName: fact.location.name,
      generatedAt,
      rangeLabel: label,
      locations: [fact.location],
      skipped: [],
      incidents: incidentSummary(fact.incidents)
    });
    reports.push({ file, title: fact.location.name, scope: fact.location.siteId });
  }

  const allFile = "report.html";
  writeReport(dir, allFile, {
    id: baseId,
    period,
    scope: "all",
    scopeName: "All locations",
    generatedAt,
    rangeLabel: label,
    locations: included.map((f) => f.location),
    skipped,
    incidents: incidentSummary(incidentsBetween(windowStart, nowSec))
  });
  reports.unshift({ file: allFile, title: "All locations", scope: "all" });

  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ reports }, null, 2), "utf8");
  pruneExports(period, 12);

  return {
    id: baseId,
    period,
    createdAt: generatedAt,
    dir,
    files: reports.map((r) => r.file).concat(["manifest.json"]),
    reports
  };
}

export function listExports(): ExportRecord[] {
  const out: ExportRecord[] = [];
  for (const period of ["weekly", "monthly"] as const) {
    for (const dir of listExportDirs(period)) {
      const date = path.basename(dir);
      const files = fs.readdirSync(dir);
      const stat = fs.statSync(dir);
      out.push({
        id: `${period}-${date}`,
        period,
        createdAt: stat.mtime.toISOString(),
        dir,
        files,
        reports: readManifest(dir)
      });
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resolveExportFile(exportId: string, filename: string): string | null {
  const safe = path.basename(filename);
  for (const rec of listExports()) {
    if (rec.id === exportId || rec.id.startsWith(`${exportId}-`) || exportId.startsWith(rec.id)) {
      const full = path.join(rec.dir, safe);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

export function getExportPayload(exportId: string, filename = "report.json"): ExportReportPayload | null {
  const file = resolveExportFile(exportId, filename);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ExportReportPayload;
  } catch {
    return null;
  }
}

export function ensureExportHtml(exportId: string, filename = "report.html"): string | null {
  const existing = resolveExportFile(exportId, filename);
  if (existing) return existing;
  const jsonName = filename.replace(/\.html$/, ".json");
  const payload = getExportPayload(exportId, jsonName);
  if (!payload?.locations) return null;
  const rec = listExports().find((r) => r.id === exportId || exportId.startsWith(r.id));
  if (!rec) return null;
  const full = path.join(rec.dir, path.basename(filename));
  fs.writeFileSync(full, renderExportReportHtml(payload), "utf8");
  return full;
}

export function getLatestMonthlyReport(): ExportReportPayload | null {
  const latest = listExports().find((e) => e.period === "monthly");
  if (!latest) return null;
  return getExportPayload(latest.id, "report.json");
}
