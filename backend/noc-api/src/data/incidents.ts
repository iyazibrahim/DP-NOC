import fs from "fs";
import path from "path";
import crypto from "crypto";

export type IncidentKind = "collector" | "uplink" | "overall" | string;

export type Incident = {
  id: string;
  key: string;
  siteId: string;
  siteName: string;
  kind: IncidentKind;
  title: string;
  detail: string;
  source: "status" | "alertmanager";
  openedAt: string;
  resolvedAt?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
};

const MAX_HISTORY = 200;
const HISTORY_DAYS = 30;

function runtimePathCandidates(): string[] {
  return [
    path.join(process.cwd(), "data/runtime/incidents.json"),
    path.join(__dirname, "../../data/runtime/incidents.json"),
    "/app/data/runtime/incidents.json"
  ];
}

function resolveIncidentsPath(): string {
  for (const file of runtimePathCandidates()) {
    if (fs.existsSync(file)) return file;
  }
  const preferred = path.join(process.cwd(), "data/runtime/incidents.json");
  const dir = path.dirname(preferred);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return preferred;
}

let incidents: Incident[] = [];
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  const file = resolveIncidentsPath();
  if (!fs.existsSync(file)) {
    incidents = [];
    return;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { incidents?: Incident[] };
    incidents = Array.isArray(raw.incidents) ? raw.incidents : [];
  } catch {
    incidents = [];
  }
}

function persist() {
  load();
  const file = resolveIncidentsPath();
  fs.writeFileSync(file, JSON.stringify({ incidents }, null, 2) + "\n", "utf8");
}

export function listIncidents(): Incident[] {
  load();
  return incidents;
}

export function getOpenIncidents(): Incident[] {
  return listIncidents().filter((i) => !i.acknowledgedAt);
}

export function getHistoryIncidents(): Incident[] {
  const cutoff = Date.now() - HISTORY_DAYS * 24 * 3600 * 1000;
  return listIncidents()
    .filter((i) => i.acknowledgedAt)
    .filter((i) => new Date(i.acknowledgedAt!).getTime() >= cutoff)
    .sort((a, b) => (b.acknowledgedAt ?? "").localeCompare(a.acknowledgedAt ?? ""))
    .slice(0, MAX_HISTORY);
}

export function upsertOpenIncident(input: {
  key: string;
  siteId: string;
  siteName: string;
  kind: IncidentKind;
  title: string;
  detail: string;
  source?: "status" | "alertmanager";
}): Incident {
  load();
  const existing = incidents.find((i) => i.key === input.key && !i.acknowledgedAt);
  if (existing) {
    existing.detail = input.detail;
    existing.title = input.title;
    existing.siteName = input.siteName;
    if (existing.resolvedAt) delete existing.resolvedAt;
    persist();
    return existing;
  }
  const created: Incident = {
    id: crypto.randomUUID(),
    key: input.key,
    siteId: input.siteId,
    siteName: input.siteName,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    source: input.source ?? "status",
    openedAt: new Date().toISOString()
  };
  incidents.unshift(created);
  prune();
  persist();
  return created;
}

export function markResolvedIfOpen(key: string): void {
  load();
  const open = incidents.find((i) => i.key === key && !i.acknowledgedAt);
  if (!open) return;
  if (!open.resolvedAt) {
    open.resolvedAt = new Date().toISOString();
    persist();
  }
}

export function acknowledgeIncident(id: string, by: string): Incident | null {
  load();
  const row = incidents.find((i) => i.id === id);
  if (!row) return null;
  if (!row.acknowledgedAt) {
    row.acknowledgedAt = new Date().toISOString();
    row.acknowledgedBy = by;
    if (!row.resolvedAt) {
      // Ack while still firing — keep resolvedAt unset until recover, or set now for history clarity
    }
    prune();
    persist();
  }
  return row;
}

function prune() {
  const cutoff = Date.now() - HISTORY_DAYS * 24 * 3600 * 1000;
  const open = incidents.filter((i) => !i.acknowledgedAt);
  const history = incidents
    .filter((i) => i.acknowledgedAt)
    .filter((i) => new Date(i.acknowledgedAt!).getTime() >= cutoff)
    .sort((a, b) => (b.acknowledgedAt ?? "").localeCompare(a.acknowledgedAt ?? ""))
    .slice(0, MAX_HISTORY);
  incidents = [...open, ...history];
}
