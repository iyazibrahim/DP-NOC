import { getSiteById, siteList } from "../data/sites";
import {
  getHistoryIncidents,
  getOpenIncidents,
  markResolvedIfOpen,
  upsertOpenIncident,
  type Incident
} from "../data/incidents";
import { env } from "../env";
import type { SiteStatus } from "./status";

function siteName(siteId: string): string {
  if (siteId === "global") return "Global / Central";
  return getSiteById(siteId)?.name ?? siteId;
}

/** First time each key became critical (for sustained-outage debounce). */
const criticalSinceByKey = new Map<string, number>();

/**
 * Returns true only after the condition has been continuously critical for INCIDENT_SUSTAIN_MS.
 * Clears the timer when not critical so brief blips do not accumulate.
 */
function sustainedCritical(key: string, isCritical: boolean): boolean {
  if (!isCritical) {
    criticalSinceByKey.delete(key);
    return false;
  }
  const now = Date.now();
  const since = criticalSinceByKey.get(key);
  if (since == null) {
    criticalSinceByKey.set(key, now);
    return false;
  }
  return now - since >= env.INCIDENT_SUSTAIN_MS;
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

    const uplinkKey = `uplink:${st.siteId}`;
    if (sustainedCritical(uplinkKey, up?.state === "critical")) {
      activeKeys.add(uplinkKey);
      upsertOpenIncident({
        key: uplinkKey,
        siteId: st.siteId,
        siteName: name,
        kind: "uplink",
        title: "Internet / uplink DOWN",
        detail: up.notes ?? "Uplink critical"
      });
    }

    const collectorKey = `collector:${st.siteId}`;
    if (sustainedCritical(collectorKey, col?.state === "critical")) {
      activeKeys.add(collectorKey);
      upsertOpenIncident({
        key: collectorKey,
        siteId: st.siteId,
        siteName: name,
        kind: "collector",
        title: "Collector offline",
        detail: col.notes ?? "Collector critical"
      });
    }

    const overallKey = `overall:${st.siteId}`;
    const overallCritical =
      st.overall === "critical" &&
      up?.state !== "critical" &&
      col?.state !== "critical";
    if (sustainedCritical(overallKey, overallCritical)) {
      activeKeys.add(overallKey);
      upsertOpenIncident({
        key: overallKey,
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
