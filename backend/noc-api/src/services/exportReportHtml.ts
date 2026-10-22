import fs from "fs";
import path from "path";
import type { ExportReportPayload, ReportAccessPoint, ReportLocation } from "./exports";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtBytes(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${Math.round(n)} B`;
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function fmtWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(d);
}

function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function logoDataUri(): string {
  const candidates = [
    path.join(process.cwd(), "public/digital-penang-logo.png"),
    "/app/public/digital-penang-logo.png",
    path.join(__dirname, "../../../public/digital-penang-logo.png"),
    path.join(process.cwd(), "frontend/wallboard/public/digital-penang-logo.png"),
    path.join(process.cwd(), "../frontend/wallboard/public/digital-penang-logo.png"),
    path.join(process.cwd(), "../../frontend/wallboard/public/digital-penang-logo.png"),
    path.join(__dirname, "../../../../frontend/wallboard/public/digital-penang-logo.png"),
    path.join(__dirname, "../../../../../frontend/wallboard/public/digital-penang-logo.png")
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    return `data:image/png;base64,${bytes.toString("base64")}`;
  }
  return "";
}

function apTotal(rows: ReportAccessPoint[]): { inBytes: number | null; outBytes: number | null } {
  const withBytes = rows.filter((r) => r.inBytes != null || r.outBytes != null);
  if (withBytes.length === 0) return { inBytes: null, outBytes: null };
  return {
    inBytes: withBytes.reduce((sum, r) => sum + (r.inBytes ?? 0), 0),
    outBytes: withBytes.reduce((sum, r) => sum + (r.outBytes ?? 0), 0)
  };
}

function kpis(payload: ExportReportPayload): string {
  const s = payload.incidents;
  const cells = [
    ["Incidents opened", String(s.opened)],
    ["Recovered", String(s.recovered)],
    ["Still failing", String(s.stillFailing)],
    ["Acknowledged", String(s.acknowledged)]
  ];
  return `<div class="kpis">${cells
    .map(
      ([label, value]) =>
        `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`
    )
    .join("")}</div>`;
}

function locationTable(locations: ReportLocation[]): string {
  if (locations.length === 0) {
    return `<p class="muted">No location had data in this window.</p>`;
  }
  const rows = locations
    .map((loc) => {
      const ap = apTotal(loc.accessPoints);
      const apLabel =
        loc.accessPoints.length === 0
          ? "—"
          : ap.inBytes == null && ap.outBytes == null
            ? "No byte counters"
            : fmtBytes((ap.inBytes ?? 0) + (ap.outBytes ?? 0));
      const line =
        loc.lineInBytes == null && loc.lineOutBytes == null
          ? "—"
          : fmtBytes((loc.lineInBytes ?? 0) + (loc.lineOutBytes ?? 0));
      return `<tr>
        <td>${esc(loc.name)}<div class="muted small">${esc(loc.address || "—")}</div></td>
        <td class="num">${fmtPct(loc.probeUptimePct)}</td>
        <td class="num">${fmtPct(loc.internetUptimePct)}</td>
        <td class="num">${line}</td>
        <td class="num">${esc(apLabel)}</td>
      </tr>`;
    })
    .join("");
  return `<table>
    <thead><tr><th>Location</th><th>Probe</th><th>Internet</th><th>Line use</th><th>Access points</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function lineTable(loc: ReportLocation): string {
  const total =
    loc.lineInBytes == null && loc.lineOutBytes == null
      ? "No WAN samples in this window."
      : `Download ${fmtBytes(loc.lineInBytes)} · Upload ${fmtBytes(loc.lineOutBytes)} · Total ${fmtBytes((loc.lineInBytes ?? 0) + (loc.lineOutBytes ?? 0))}`;
  if (loc.lineDays.length === 0) {
    return `<p class="lead">${esc(total)} No WAN interface is tagged for this location.</p>`;
  }
  const rows = loc.lineDays
    .map((d) => {
      const totalBytes = d.inBytes == null && d.outBytes == null ? null : (d.inBytes ?? 0) + (d.outBytes ?? 0);
      return `<tr>
        <td>${esc(fmtDay(d.date))}</td>
        <td class="num">${fmtBytes(d.inBytes)}</td>
        <td class="num">${fmtBytes(d.outBytes)}</td>
        <td class="num">${fmtBytes(totalBytes)}</td>
      </tr>`;
    })
    .join("");
  return `<p class="lead">${esc(total)}</p>
    <table>
      <thead><tr><th>Day</th><th>Download</th><th>Upload</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function apTable(loc: ReportLocation): string {
  if (loc.accessPoints.length === 0) return `<p class="muted">No access points are configured.</p>`;
  const rows = loc.accessPoints
    .map((ap) => {
      const total = ap.inBytes == null && ap.outBytes == null ? null : (ap.inBytes ?? 0) + (ap.outBytes ?? 0);
      return `<tr>
        <td>${esc(ap.name)}${ap.note ? `<div class="muted small">${esc(ap.note)}</div>` : ""}</td>
        <td class="num">${ap.note ? "—" : fmtBytes(ap.inBytes)}</td>
        <td class="num">${ap.note ? "—" : fmtBytes(ap.outBytes)}</td>
        <td class="num">${ap.note ? "—" : fmtBytes(total)}</td>
      </tr>`;
    })
    .join("");
  return `<table>
    <thead><tr><th>Access point</th><th>Download</th><th>Upload</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function bandwidthTable(locations: ReportLocation[], showLocation: boolean): string {
  const rows = locations.flatMap((loc) =>
    (loc.bandwidth ?? []).map((row) => ({ location: loc.name, ...row }))
  );
  if (rows.length === 0) return `<p class="muted">No network devices in this report.</p>`;
  const body = rows
    .map(
      (row) => `<tr>
        <td>${esc(row.name)}</td>
        ${showLocation ? `<td>${esc(row.location)}</td>` : ""}
        <td class="num">${fmtPct(row.avgInPct)}</td>
        <td class="num">${fmtPct(row.peakInPct)}</td>
        <td class="num">${fmtPct(row.avgOutPct)}</td>
        <td class="num">${fmtPct(row.peakOutPct)}</td>
      </tr>`
    )
    .join("");
  return `<p class="lead">Average and peak use of each network device’s interface capacity over this window.</p>
    <table>
      <thead><tr>
        <th>Device</th>
        ${showLocation ? "<th>Location</th>" : ""}
        <th>Avg in</th><th>Peak in</th><th>Avg out</th><th>Peak out</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function incidentTable(payload: ExportReportPayload): string {
  if (payload.incidents.timeline.length === 0) {
    return `<p class="muted">No incidents opened in this window.</p>`;
  }
  const rows = payload.incidents.timeline
    .map(
      (i) => `<tr>
        <td class="mono">${esc(fmtWhen(i.openedAt))}</td>
        <td><strong>${esc(i.title)}</strong><div class="muted small">${esc(i.detail || "")}</div></td>
        <td>${esc(i.siteName)}</td>
        <td class="mono">${esc(fmtWhen(i.resolvedAt))}</td>
        <td class="mono">${i.acknowledgedAt ? esc(fmtWhen(i.acknowledgedAt)) : "—"}</td>
      </tr>`
    )
    .join("");
  return `<table>
    <thead><tr><th>Opened</th><th>Problem</th><th>Location</th><th>Recovered</th><th>Acknowledged</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="muted small">Recovered means the check came back. Acknowledged means someone marked the incident seen.</p>`;
}

function uptimeTable(loc: ReportLocation): string {
  return `<table>
    <thead><tr><th>Probe uptime</th><th>Internet uptime</th></tr></thead>
    <tbody><tr>
      <td class="num">${fmtPct(loc.probeUptimePct)}</td>
      <td class="num">${fmtPct(loc.internetUptimePct)}</td>
    </tr></tbody>
  </table>
  <p class="muted small">Probe is the share of time the site collector was up. Internet is the share of time DNS and the path to the central server were both up.</p>`;
}

function locationDetail(loc: ReportLocation): string {
  return `<h3>${esc(loc.name)}</h3>
    ${lineTable(loc)}
    ${apTable(loc)}`;
}

function singleLocation(loc: ReportLocation, payload: ExportReportPayload): string {
  return `
    ${kpis(payload)}
    <h2>1. Uptime</h2>
    ${uptimeTable(loc)}
    <h2>2. Line use</h2>
    ${lineTable(loc)}
    <h2>3. Access points</h2>
    ${apTable(loc)}
    <h2>4. Bandwidth utilisation (network)</h2>
    ${bandwidthTable([loc], false)}
    <h2>5. Incident log</h2>
    ${incidentTable(payload)}`;
}

function combined(payload: ExportReportPayload): string {
  const skipped =
    payload.skipped.length === 0
      ? ""
      : `<p class="muted small">Not included: ${esc(payload.skipped.map((s) => s.name).join(", "))}.</p>`;
  const details = payload.locations.map((loc) => locationDetail(loc)).join("");
  return `
    ${kpis(payload)}
    <h2>1. Locations</h2>
    ${locationTable(payload.locations)}
    ${skipped}
    <h2>2. Line use and access points</h2>
    ${details || `<p class="muted">No location had data in this window.</p>`}
    <h2>3. Bandwidth utilisation (network)</h2>
    ${bandwidthTable(payload.locations, true)}
    <h2>4. Incident log</h2>
    ${incidentTable(payload)}`;
}

export function renderExportReportHtml(payload: ExportReportPayload): string {
  const logo = logoDataUri();
  const logoHtml = logo
    ? `<img class="logo" src="${logo}" alt="Digital Penang" />`
    : "";
  const periodName = payload.period === "weekly" ? "Weekly" : "Monthly";
  const title = `${periodName} operations report`;
  const loc = payload.locations[0];
  const body = payload.scope === "all" || !loc ? combined(payload) : singleLocation(loc, payload);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} · ${esc(payload.scopeName)}</title>
<style>
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #0f172a;
    background: #e8eef2;
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.45;
  }
  .sheet {
    width: 210mm;
    min-height: 297mm;
    margin: 12px auto;
    padding: 16mm 14mm 18mm;
    background: #fff;
    box-shadow: 0 8px 28px rgba(15, 23, 42, 0.12);
  }
  .brand {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    border-bottom: 3px solid #00b5e2;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .brand-id { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .logo { height: 46px; width: auto; display: block; }
  .brand h1 {
    margin: 0;
    font-size: 18pt;
    font-weight: 700;
    color: #0b1220;
    letter-spacing: -0.02em;
  }
  .brand .scope { margin: 2px 0 0; color: #334155; font-size: 10.5pt; }
  .brand-meta { text-align: right; font-size: 8.5pt; color: #64748b; }
  .brand-meta strong { color: #0f172a; display: block; font-size: 9.5pt; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 0 0 8px; }
  .kpi {
    border: 1px solid #dbe3ea;
    border-radius: 6px;
    padding: 10px 12px;
    background: linear-gradient(180deg, #f8fbfd, #fff);
  }
  .kpi .label {
    font-size: 7.5pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #64748b;
  }
  .kpi .value { margin-top: 2px; font-size: 16pt; font-weight: 700; color: #0b1220; }
  h2 {
    margin: 18px 0 8px;
    font-size: 11pt;
    font-weight: 700;
    color: #0b1220;
    border-left: 4px solid #f5c400;
    padding-left: 8px;
  }
  h3 { margin: 14px 0 6px; font-size: 10.5pt; color: #0b1220; }
  p.lead { margin: 0 0 8px; color: #475569; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 6px; font-size: 9pt; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 7px; text-align: left; vertical-align: top; }
  th {
    background: #0b1220;
    color: #f8fafc;
    font-weight: 600;
    font-size: 7.5pt;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  tr:nth-child(even) td { background: #f8fafc; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 8.5pt; }
  .muted { color: #64748b; }
  .small { font-size: 8pt; margin-top: 2px; }
  footer.doc {
    margin-top: 28px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    font-size: 8pt;
    color: #64748b;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .print-hint { max-width: 210mm; margin: 8px auto 0; text-align: center; font-size: 9pt; color: #64748b; }
  @media print {
    body { background: #fff; }
    .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
    .print-hint { display: none; }
    h2, h3 { break-after: avoid; }
    tr, .kpi { break-inside: avoid; }
  }
</style>
</head>
<body>
  <p class="print-hint">Use Print and save as PDF. Paper size A4.</p>
  <article class="sheet">
    <header class="brand">
      <div class="brand-id">
        ${logoHtml}
        <div>
          <h1>${esc(title)}</h1>
          <p class="scope">${esc(payload.scopeName)}</p>
        </div>
      </div>
      <div class="brand-meta">
        <strong>${esc(payload.rangeLabel)}</strong>
        Malaysia time
        <div style="margin-top:8px"><strong>Generated</strong>${esc(fmtWhen(payload.generatedAt))}</div>
      </div>
    </header>
    ${body}
    <footer class="doc">
      <span>Digital Penang Network Operations Centre</span>
      <span>${esc(payload.scopeName)} · ${esc(payload.rangeLabel)}</span>
    </footer>
  </article>
</body>
</html>`;
}
