import fs from "fs";
import path from "path";
import { siteList } from "../data/sites";
import { computeAllSitesStatus } from "./status";
import { promQuery, parseFirstVectorValue } from "./prometheus";
import { getActiveAlerts } from "./alertmanager";

export type ExportPeriod = "weekly" | "monthly";

export type ExportRecord = {
  id: string;
  period: ExportPeriod;
  createdAt: string;
  dir: string;
  files: string[];
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

async function avgQuery(query: string): Promise<number | null> {
  try {
    const data = await promQuery(query);
    return parseFirstVectorValue(data);
  } catch {
    return null;
  }
}

export async function runExport(period: ExportPeriod): Promise<ExportRecord> {
  const date = new Date().toISOString().slice(0, 10);
  const id = `${period}-${date}-${Date.now()}`;
  const dir = path.join(exportsRoot(), period, date);
  fs.mkdirSync(dir, { recursive: true });

  const { statuses } = await computeAllSitesStatus();
  const alerts = await getActiveAlerts();
  const rangeDays = period === "weekly" ? 7 : 30;

  const siteRows = [];
  for (const site of siteList) {
    const st = statuses.find((s) => s.siteId === site.id);
    const wanUp = await avgQuery(`avg_over_time(probe_success{site="${site.id}",check="wan_vps"}[${rangeDays}d])`);
    siteRows.push({
      siteId: site.id,
      name: site.name,
      address: site.address ?? "",
      overall: st?.overall ?? "unknown",
      wan: st?.wan.state ?? "unknown",
      lan: st?.lan.state ?? "unknown",
      wanUptimePct: wanUp != null ? (wanUp * 100).toFixed(2) : null,
      deviceCount: site.devices?.length ?? 0
    });
  }

  const deviceRows = [];
  for (const site of siteList) {
    for (const d of site.devices ?? []) {
      const metricId = d.kind === "server" ? d.hostMetricId || d.id : d.id;
      let cpu: number | null = null;
      let mem: number | null = null;
      let up: number | null = null;
      if (d.kind === "server") {
        cpu = await avgQuery(
          `avg_over_time((100 - avg(rate(node_cpu_seconds_total{mode="idle",site="${site.id}",device="${metricId}"}[5m])) * 100)[${rangeDays}d:1h])`
        );
        mem = await avgQuery(
          `avg_over_time((node_memory_MemAvailable_bytes{site="${site.id}",device="${metricId}"} / node_memory_MemTotal_bytes{site="${site.id}",device="${metricId}"}) * 100)[${rangeDays}d:1h])`
        );
        up = await avgQuery(`avg_over_time(up{job="site_host",site="${site.id}",device="${metricId}"}[${rangeDays}d])`);
      } else {
        up = await avgQuery(`avg_over_time(snmp_up{site="${site.id}",device="${metricId}"}[${rangeDays}d])`);
      }
      deviceRows.push({
        siteId: site.id,
        siteName: site.name,
        deviceId: d.id,
        name: d.name,
        kind: d.kind,
        avgCpuPct: cpu,
        avgMemAvailPct: mem,
        uptimePct: up != null ? up * 100 : null
      });
    }
  }

  const alertSummary = {
    firing: alerts.filter((a) => a.status === "firing").length,
    resolved: alerts.filter((a) => a.status === "resolved").length,
    topAlertnames: Object.entries(
      alerts.reduce<Record<string, number>>((acc, a) => {
        const n = a.labels?.alertname ?? "unknown";
        acc[n] = (acc[n] ?? 0) + 1;
        return acc;
      }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([alertname, count]) => ({ alertname, count }))
  };

  const payload = {
    id,
    period,
    generatedAt: new Date().toISOString(),
    rangeDays,
    sites: siteRows,
    devices: deviceRows,
    alerts: alertSummary
  };

  const jsonPath = path.join(dir, "report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  const csvLines = [
    "section,siteId,deviceId,name,metric,value",
    ...siteRows.map(
      (r) =>
        `site,${r.siteId},,${JSON.stringify(r.name)},overall,${r.overall}`
    ),
    ...deviceRows.map(
      (r) =>
        `device,${r.siteId},${r.deviceId},${JSON.stringify(r.name)},uptime_pct,${r.uptimePct ?? ""}`
    )
  ];
  const csvPath = path.join(dir, "report.csv");
  fs.writeFileSync(csvPath, csvLines.join("\n") + "\n", "utf8");

  pruneExports(period, 12);

  return {
    id,
    period,
    createdAt: payload.generatedAt,
    dir,
    files: ["report.json", "report.csv"]
  };
}

export function listExports(): ExportRecord[] {
  const out: ExportRecord[] = [];
  for (const period of ["weekly", "monthly"] as ExportPeriod[]) {
    for (const dir of listExportDirs(period)) {
      const date = path.basename(dir);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") || f.endsWith(".csv"));
      out.push({
        id: `${period}-${date}`,
        period,
        createdAt: fs.statSync(path.join(dir, files[0] ?? "report.json")).mtime.toISOString(),
        dir,
        files
      });
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resolveExportFile(id: string, filename: string): string | null {
  for (const rec of listExports()) {
    if (rec.id === id || rec.id.startsWith(id)) {
      const full = path.join(rec.dir, filename);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}
