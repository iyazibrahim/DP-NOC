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
  return `${n.toFixed(1)}%`;
}

function fmtWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
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
    path.join(process.cwd(), "frontend/wallboard/public/digital-penang-logo.png"),
    path.join(process.cwd(), "../frontend/wallboard/public/digital-penang-logo.png"),
    path.join(__dirname, "../../../../frontend/wallboard/public/digital-penang-logo.png"),
    path.join(__dirname, "../../../frontend/wallboard/public/digital-penang-logo.png"),
    "/app/frontend/wallboard/public/digital-penang-logo.png"
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

function locationTable(locations: ReportLocation[]): string {
  if (locations.length === 0) {
    return `<p class="empty">No location had line use, access-point bytes, a probe sample, or an incident in this window.</p>`;
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
        <td>${esc(loc.name)}</td>
        <td class="num">${fmtPct(loc.probeUptimePct)}</td>
        <td class="num">${fmtPct(loc.internetUptimePct)}</td>
        <td class="num">${line}</td>
        <td class="num">${apLabel}</td>
      </tr>`;
    })
    .join("");
  return `<table>
    <thead><tr><th>Location</th><th>Probe uptime</th><th>Internet uptime</th><th>Line use</th><th>Access points</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function lineTable(loc: ReportLocation): string {
  const total =
    loc.lineInBytes == null && loc.lineOutBytes == null
      ? "No WAN samples in this window."
      : `Download ${fmtBytes(loc.lineInBytes)} · Upload ${fmtBytes(loc.lineOutBytes)} · Total ${fmtBytes((loc.lineInBytes ?? 0) + (loc.lineOutBytes ?? 0))}`;
  if (loc.lineDays.length === 0) {
    return `<p>${esc(total)}</p><p class="empty">No WAN interface is tagged for this location.</p>`;
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
  if (loc.accessPoints.length === 0) return `<p class="empty">No access points are configured.</p>`;
  const rows = loc.accessPoints
    .map((ap) => {
      const total = ap.inBytes == null && ap.outBytes == null ? null : (ap.inBytes ?? 0) + (ap.outBytes ?? 0);
      return `<tr>
        <td>${esc(ap.name)}${ap.note ? ` <span class="note">${esc(ap.note)}</span>` : ""}</td>
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

function incidentTable(payload: ExportReportPayload): string {
  const s = payload.incidents;
  const chips = `<p class="lead">Opened ${s.opened} · Recovered ${s.recovered} · Still failing ${s.stillFailing} · Acknowledged ${s.acknowledged}</p>`;
  if (s.timeline.length === 0) return `${chips}<p class="empty">No incidents opened in this window.</p>`;
  const rows = s.timeline
    .map(
      (i) => `<tr>
        <td>${esc(fmtWhen(i.openedAt))}</td>
        <td>${esc(i.title)}<div class="note">${esc(i.detail)}</div></td>
        <td>${esc(i.siteName)}</td>
        <td>${esc(fmtWhen(i.resolvedAt))}</td>
        <td>${i.acknowledgedAt ? esc(fmtWhen(i.acknowledgedAt)) : "—"}</td>
      </tr>`
    )
    .join("");
  return `${chips}<table>
    <thead><tr><th>Opened</th><th>Problem</th><th>Location</th><th>Recovered</th><th>Acknowledged</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">Recovered means the check came back. Acknowledged means someone marked the incident seen. A still-failing row has not recovered.</p>`;
}

function singleLocation(loc: ReportLocation, payload: ExportReportPayload): string {
  return `
    <section><h2>1. Uptime</h2>
      <table>
        <thead><tr><th>Probe</th><th>Internet</th></tr></thead>
        <tbody><tr><td class="num">${fmtPct(loc.probeUptimePct)}</td><td class="num">${fmtPct(loc.internetUptimePct)}</td></tr></tbody>
      </table>
      <p class="note">Probe is the share of time the site collector was up. Internet is the share of time DNS and the path to the central server were both up.</p>
    </section>
    <section><h2>2. Line use</h2>${lineTable(loc)}</section>
    <section><h2>3. Access points</h2>${apTable(loc)}</section>
    <section><h2>4. Incidents</h2>${incidentTable(payload)}</section>`;
}

function combined(payload: ExportReportPayload): string {
  const skipped =
    payload.skipped.length === 0
      ? ""
      : `<p class="note">Not included, because this window had no line use, access-point bytes, probe or internet sample, or incident: ${esc(payload.skipped.map((s) => s.name).join(", "))}.</p>`;
  return `
    <section><h2>1. Locations</h2>${locationTable(payload.locations)}${skipped}</section>
    <section><h2>2. Incidents</h2>${incidentTable(payload)}</section>`;
}

export function renderExportReportHtml(payload: ExportReportPayload): string {
  const logo = logoDataUri();
  const logoHtml = logo
    ? `<img class="logo" src="${logo}" alt="Digital Penang" />`
    : `<div class="logoFallback">Digital Penang</div>`;
  const periodName = payload.period === "weekly" ? "Weekly" : "Monthly";
  const title = `${periodName} operations report`;
  const loc = payload.locations[0];
  const body = payload.scope === "all" || !loc ? combined(payload) : singleLocation(loc, payload);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)} — ${esc(payload.scopeName)}</title>
  <style>
    @page { size: A4; margin: 18mm 14mm 20mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1a1a1a; font: 11pt "Segoe UI", Calibri, sans-serif; background: #fff; }
    .sheet { max-width: 210mm; margin: 0 auto; }
    header.letter { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; border-bottom: 2px solid #0b3a66; padding-bottom: 10px; margin-bottom: 16px; }
    .logo { height: 52px; width: auto; }
    .logoFallback { font-weight: 700; letter-spacing: 0.04em; color: #0b3a66; }
    h1 { margin: 0; font-size: 18pt; color: #0b3a66; }
    .meta { margin: 4px 0 0; color: #333; font-size: 10.5pt; }
    h2 { font-size: 13pt; color: #0b3a66; margin: 18px 0 8px; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 8px; page-break-inside: auto; }
    th, td { border: 1px solid #cfd6de; padding: 5px 7px; text-align: left; vertical-align: top; font-size: 9.5pt; }
    th { background: #f3f6f9; font-weight: 650; }
    td.num { text-align: right; }
    tr { page-break-inside: avoid; }
    .lead { margin: 0 0 8px; }
    .note, .empty { color: #444; font-size: 9.5pt; }
    footer.foot { position: fixed; left: 0; right: 0; bottom: 0; border-top: 1px solid #cfd6de; padding: 6px 14mm 0; font-size: 8.5pt; color: #444; display: flex; justify-content: space-between; }
    footer.foot .pages::after { content: counter(page); }
  </style>
</head>
<body>
  <footer class="foot"><span>${esc(title)} · ${esc(payload.scopeName)}</span><span>Page <span class="pages"></span></span></footer>
  <div class="sheet">
    <header class="letter">
      ${logoHtml}
      <div>
        <h1>${esc(title)}</h1>
        <p class="meta">${esc(payload.scopeName)}</p>
        <p class="meta">${esc(payload.rangeLabel)} · Malaysia time</p>
        <p class="meta">Generated ${esc(fmtWhen(payload.generatedAt))}</p>
      </div>
    </header>
    ${body}
  </div>
</body>
</html>`;
}
