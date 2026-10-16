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
 * Keys acked while still firing. Stay suppressed until the condition recovers;
 * otherwise every status poll would reopen a new open incident immediately.
 */
const suppressedUntilRecovered = new Set<string>();

/**
 * After operator ack of an active (unresolved) incident, do not reopen until
 * this key has left critical and a later outage sustains again.
 */
export function suppressIncidentUntilRecovered(key: string): void {
  suppressedUntilRecovered.add(key);
  criticalSinceByKey.delete(key);
}

/**
 * Returns true only after the condition has been continuously critical for INCIDENT_SUSTAIN_MS.
 * Clears the timer when not critical so brief blips do not accumulate.
 * Honors ack-suppression until recovery.
 */
function sustainedCritical(key: string, isCritical: boolean): boolean {
  if (!isCritical) {
    criticalSinceByKey.delete(key);
    suppressedUntilRecovered.delete(key);
    return false;
  }
  if (suppressedUntilRecovered.has(key)) {
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

/** Website-only critical (no local-device / residual location issue). */
function isWebsitesOnlyCritical(st: SiteStatus): boolean {
  if (st.websites.state !== "critical") return false;
  const ld = st.localDevices?.state ?? st.lan?.state;
  return ld !== "critical";
}

function websiteIncidentKey(siteId: string, url: string): string {
  return `website:${siteId}:${url}`;
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
        title: `Internet DOWN — ${name}`,
        detail: up.notes ?? "Both internet checks failed. Check the uplink and the collector."
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
        title: `Collector offline — ${name}`,
        detail: col.notes ?? "Device checks are paused so they are not marked down. Check power and the network on the collector, then open Collector Console."
      });
    }

    for (const w of st.websiteStates ?? []) {
      const wKey = websiteIncidentKey(st.siteId, w.url);
      if (sustainedCritical(wKey, w.state === "critical")) {
        activeKeys.add(wKey);
        upsertOpenIncident({
          key: wKey,
          siteId: st.siteId,
          siteName: name,
          kind: "website",
          title: `Website DOWN — ${w.name}`,
          detail: w.notes
          ? `${w.name} at ${name} is not responding. ${w.notes}`
          : `${w.name} at ${name} is not responding. Check that the address is correct and the site is up.`
        });
      }
    }

    for (const d of st.localDeviceStates ?? []) {
      const downKey = `device:${st.siteId}:${d.deviceId}`;
      if (sustainedCritical(downKey, d.state === "critical")) {
        activeKeys.add(downKey);
        upsertOpenIncident({
          key: downKey,
          siteId: st.siteId,
          siteName: name,
          kind: "device",
          title: `Device unreachable — ${d.name}`,
          detail:
            d.notes ??
            `${d.name} is not answering ping or SNMP. Check power and the network cable.`
        });
      }
      const snmpKey = `snmp:${st.siteId}:${d.deviceId}`;
      if (sustainedCritical(snmpKey, d.state === "warning")) {
        activeKeys.add(snmpKey);
        upsertOpenIncident({
          key: snmpKey,
          siteId: st.siteId,
          siteName: name,
          kind: "snmp",
          title: `SNMP not answering — ${d.name}`,
          detail:
            d.notes ??
            `${d.name} is online, but SNMP is not answering. Check the SNMP community and that UDP port 161 is allowed, then use Force apply on the collector.`
        });
      }
    }

    // Location residual only when the outage is not already covered by uplink, collector,
    // website, or per-device incidents.
    const locationKey = `overall:${st.siteId}`;
    const localCritical = (st.localDevices ?? st.lan)?.state === "critical";
    const locationCritical =
      st.overall === "critical" &&
      up?.state !== "critical" &&
      col?.state !== "critical" &&
      !isWebsitesOnlyCritical(st) &&
      !localCritical;

    if (sustainedCritical(locationKey, locationCritical)) {
      activeKeys.add(locationKey);
      const causes: string[] = [];
      if (st.websites.state === "critical") {
        causes.push(st.websites.notes ?? "One or more websites are not responding.");
      }
      if (st.alerts?.firing > 0) {
        causes.push(
          st.alerts.firing === 1
            ? "1 alert is still firing."
            : `${st.alerts.firing} alerts are still firing.`
        );
      }
      upsertOpenIncident({
        key: locationKey,
        siteId: st.siteId,
        siteName: name,
        kind: "location",
        title: `Location health critical — ${name}`,
        detail: causes.join(" ") || "This location needs attention. Open the dashboard for the failing check."
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

  for (const st of statuses) {
    for (const w of st.websiteStates ?? []) {
      candidates.add(websiteIncidentKey(st.siteId, w.url));
    }
  }
  // Resolve open website incidents whose URL was removed from config
  for (const i of getOpenIncidents()) {
    if (
      i.kind === "website" ||
      i.kind === "device" ||
      i.kind === "snmp" ||
      i.key.startsWith("website:") ||
      i.key.startsWith("device:") ||
      i.key.startsWith("snmp:")
    ) {
      candidates.add(i.key);
    }
  }

  for (const key of candidates) {
    if (!activeKeys.has(key)) markResolvedIfOpen(key);
  }

  return { open: getOpenIncidents(), history: getHistoryIncidents() };
}

export function listSyncedIncidents(statuses: SiteStatus[]) {
  return syncIncidentsFromStatuses(statuses);
}
