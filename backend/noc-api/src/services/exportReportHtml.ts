import type { ExportReportPayload } from "./exports";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtPct(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
}

function fmtWhen(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      dateStyle: "medium",
      timeStyle: "short"
    });
  } catch {
    return iso;
  }
}

function periodTitle(period: string, rangeDays: number): string {
  if (period === "weekly") return `Weekly Operations Report (${rangeDays} days)`;
  return `Monthly Operations Report (${rangeDays} days)`;
}

/** Self-contained A4 formal HTML report (print → PDF). */
export function renderExportReportHtml(payload: ExportReportPayload): string {
  const title = periodTitle(payload.period, payload.rangeDays);
  const networkDevices = payload.devices.filter((d) => d.kind === "network");
  const timeline = payload.incidents.timeline.slice(0, 80);
  const generated = fmtWhen(payload.generatedAt);

  const siteRows = payload.sites
    .map(
      (s) => `<tr>
      <td>${esc(s.name)}</td>
      <td class="mono">${esc(s.overall)}</td>
      <td>${fmtPct(s.wanUptimePct)}</td>
      <td class="num">${s.deviceCount}</td>
      <td class="muted">${esc(s.address || "—")}</td>
    </tr>`
    )
    .join("\n");

  const utilRows =
    networkDevices.length === 0
      ? `<tr><td colspan="6" class="muted">No network devices in this period.</td></tr>`
      : networkDevices
          .map(
            (d) => `<tr>
      <td>${esc(d.name)}</td>
      <td>${esc(d.siteName)}</td>
      <td class="num">${fmtPct(d.avgUtilInPct)}</td>
      <td class="num">${fmtPct(d.peakUtilInPct)}</td>
      <td class="num">${fmtPct(d.avgUtilOutPct)}</td>
      <td class="num">${fmtPct(d.peakUtilOutPct)}</td>
    </tr>`
          )
          .join("\n");

  const incidentRows =
    timeline.length === 0
      ? `<tr><td colspan="5" class="muted">No incidents in this period.</td></tr>`
      : timeline
          .map(
            (i) => `<tr>
      <td class="mono">${esc(fmtWhen(i.openedAt))}</td>
      <td><strong>${esc(i.title)}</strong><div class="muted small">${esc(i.detail || "")}</div></td>
      <td>${esc(i.siteName)}</td>
      <td class="mono">${esc(fmtWhen(i.resolvedAt))}</td>
      <td class="mono">${esc(fmtWhen(i.acknowledgedAt))}</td>
    </tr>`
          )
          .join("\n");

  const alertRows =
    payload.alerts.topAlertnames.length === 0
      ? `<tr><td colspan="2" class="muted">No alerts recorded.</td></tr>`
      : payload.alerts.topAlertnames
          .map(
            (a) =>
              `<tr><td>${esc(a.alertname)}</td><td class="num">${a.count}</td></tr>`
          )
          .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} · Digital Penang NOC</title>
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
    padding: 16mm 14mm;
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
    margin-bottom: 18px;
  }
  .brand-mark {
    font-size: 11pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #00b5e2;
  }
  .brand h1 {
    margin: 4px 0 0;
    font-size: 18pt;
    font-weight: 700;
    color: #0b1220;
    letter-spacing: -0.02em;
  }
  .brand-meta {
    text-align: right;
    font-size: 8.5pt;
    color: #64748b;
    white-space: nowrap;
  }
  .brand-meta strong { color: #0f172a; display: block; font-size: 9.5pt; }
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin: 0 0 18px;
  }
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
  .kpi .value {
    margin-top: 2px;
    font-size: 16pt;
    font-weight: 700;
    color: #0b1220;
  }
  h2 {
    margin: 20px 0 8px;
    font-size: 11pt;
    font-weight: 700;
    color: #0b1220;
    border-left: 4px solid #f5c400;
    padding-left: 8px;
  }
  p.lead {
    margin: 0 0 14px;
    color: #475569;
    font-size: 9.5pt;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4px;
    font-size: 9pt;
  }
  th, td {
    border-bottom: 1px solid #e2e8f0;
    padding: 6px 7px;
    text-align: left;
    vertical-align: top;
  }
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
  footer {
    margin-top: 28px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    font-size: 8pt;
    color: #64748b;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .print-hint {
    max-width: 210mm;
    margin: 8px auto 0;
    text-align: center;
    font-size: 9pt;
    color: #64748b;
  }
  @media print {
    body { background: #fff; }
    .sheet {
      width: auto;
      min-height: 0;
      margin: 0;
      padding: 0;
      box-shadow: none;
    }
    .print-hint { display: none; }
    h2 { break-after: avoid; }
    table { break-inside: auto; }
    tr { break-inside: avoid; }
  }
</style>
</head>
<body>
  <p class="print-hint">Formal A4 report — use Print → Save as PDF (paper size A4).</p>
  <article class="sheet">
    <header class="brand">
      <div>
        <div class="brand-mark">Digital Penang · NOC</div>
        <h1>${esc(title)}</h1>
      </div>
      <div class="brand-meta">
        <strong>Report ID</strong>
        ${esc(payload.id)}
        <div style="margin-top:8px"><strong>Generated</strong>${esc(generated)} (MYT)</div>
      </div>
    </header>

    <p class="lead">
      Summary of site availability, network utilisation, alert activity, and incidents
      for the selected reporting window. Figures are derived from NOC telemetry
      (Prometheus / Alertmanager / incident log).
    </p>

    <div class="kpis">
      <div class="kpi"><div class="label">Incidents opened</div><div class="value">${payload.incidents.summary.openedInRange}</div></div>
      <div class="kpi"><div class="label">Resolved</div><div class="value">${payload.incidents.summary.resolvedInRange}</div></div>
      <div class="kpi"><div class="label">Still open</div><div class="value">${payload.incidents.summary.stillOpen}</div></div>
      <div class="kpi"><div class="label">Acknowledged</div><div class="value">${payload.incidents.summary.acknowledgedInRange}</div></div>
    </div>

    <h2>1. Site uptime (WAN)</h2>
    <table>
      <thead>
        <tr><th>Site</th><th>Overall</th><th>WAN uptime</th><th>Devices</th><th>Address</th></tr>
      </thead>
      <tbody>
        ${siteRows || `<tr><td colspan="5" class="muted">No sites.</td></tr>`}
      </tbody>
    </table>

    <h2>2. Bandwidth utilisation (network)</h2>
    <p class="lead">Approximate utilisation from SNMP ifSpeed (nominal link). Peak/avg over the report window.</p>
    <table>
      <thead>
        <tr><th>Device</th><th>Site</th><th>Avg in</th><th>Peak in</th><th>Avg out</th><th>Peak out</th></tr>
      </thead>
      <tbody>${utilRows}</tbody>
    </table>

    <h2>3. Alert activity</h2>
    <p class="lead">Firing: <strong>${payload.alerts.firing}</strong> · Resolved snapshots: <strong>${payload.alerts.resolved}</strong></p>
    <table>
      <thead><tr><th>Alert name</th><th>Count</th></tr></thead>
      <tbody>${alertRows}</tbody>
    </table>

    <h2>4. Incident timeline</h2>
    <table>
      <thead>
        <tr><th>Opened</th><th>Problem</th><th>Site</th><th>Resolved</th><th>Acked</th></tr>
      </thead>
      <tbody>${incidentRows}</tbody>
    </table>

    <footer>
      <span>Digital Penang Network Operations Centre · Confidential</span>
      <span>${esc(payload.period.toUpperCase())} · ${payload.rangeDays}d window · ${esc(payload.id)}</span>
    </footer>
  </article>
</body>
</html>`;
}
