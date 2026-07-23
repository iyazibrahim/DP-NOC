import { getSiteById, siteList } from "../data/sites";
import {
  getHistoryIncidents,
  getOpenIncidents,
  markResolvedIfOpen,
  upsertOpenIncident,
  type Incident
} from "../data/incidents";
import type { SiteStatus } from "./status";

function siteName(siteId: string): string {
  if (siteId === "global") return "Global / Central";
  return getSiteById(siteId)?.name ?? siteId;
}

/** Open/resolve status-derived incidents from current site statuses. */
export function syncIncidentsFromStatuses(statuses: SiteStatus[]): {
  open: Incident[];
  history: Incident[];
} {
  const activeKeys = new Set<string>();

  for (const st of statuses) {
    const name = siteName(st.siteId);
    const up = st.uplink ?? st.wan;
    const col = st.collector;

    if (up?.state === "critical") {
      const key = `uplink:${st.siteId}`;
      activeKeys.add(key);
      upsertOpenIncident({
        key,
        siteId: st.siteId,
        siteName: name,
        kind: "uplink",
        title: "Internet / uplink DOWN",
        detail: up.notes ?? "Uplink critical"
      });
    }

    if (col?.state === "critical") {
      const key = `collector:${st.siteId}`;
      activeKeys.add(key);
      upsertOpenIncident({
        key,
        siteId: st.siteId,
        siteName: name,
        kind: "collector",
        title: "Collector offline",
        detail: col.notes ?? "Collector critical"
      });
    }

    if (
      st.overall === "critical" &&
      up?.state !== "critical" &&
      col?.state !== "critical"
    ) {
      const key = `overall:${st.siteId}`;
      activeKeys.add(key);
      upsertOpenIncident({
        key,
        siteId: st.siteId,
        siteName: name,
        kind: "overall",
        title: "Site DOWN",
        detail: "Overall site health critical"
      });
    }
  }

  const candidates = new Set<string>();
  for (const s of siteList) {
    candidates.add(`uplink:${s.id}`);
    candidates.add(`collector:${s.id}`);
    candidates.add(`overall:${s.id}`);
  }
  candidates.add("uplink:global");
  candidates.add("collector:global");
  candidates.add("overall:global");

  for (const key of candidates) {
    if (!activeKeys.has(key)) markResolvedIfOpen(key);
  }

  return { open: getOpenIncidents(), history: getHistoryIncidents() };
}

export function listSyncedIncidents(statuses: SiteStatus[]) {
  return syncIncidentsFromStatuses(statuses);
}
