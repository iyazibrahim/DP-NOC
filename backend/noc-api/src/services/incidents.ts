import { getSiteById, siteList } from "../data/sites";
import {
  getHistoryIncidents,
  getOpenIncidents,
  markResolvedIfOpen,
  upsertOpenIncident,
  type Incident
} from "../data/incidents";
import { env } from "../env";
import { alertTypeByKind, type AlertTypeId } from "./alertCatalog";
import { postAlerts, type PostedAlert } from "./alertmanager";
import { listBandwidthIncidents } from "./clientWatch";
import { loadNotificationsConfig } from "./notifications";
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

function websiteIncidentKey(siteId: string, url: string): string {
  return `website:${siteId}:${url}`;
}

function siteMuted(siteId: string): boolean {
  if (siteId === "global") return false;
  return getSiteById(siteId)?.alertsMuted === true;
}

function typeEnabled(id: AlertTypeId): boolean {
  return loadNotificationsConfig().alertTypes[id] === true;
}

/**
 * A muted location opens nothing. A disabled type opens nothing.
 * While the probe is critical, Internet and device checks are explained by that
 * outage, so they stay closed. Websites are checked from the central server.
 */
function alertReady(
  siteId: string,
  type: AlertTypeId,
  key: string,
  isCritical: boolean,
  probeDown: boolean
): boolean {
  if (siteMuted(siteId) || !typeEnabled(type)) {
    sustainedCritical(key, false);
    return false;
  }
  const coveredByProbe = probeDown && (type === "uplink" || type === "device" || type === "snmp");
  if (coveredByProbe) {
    if (!isCritical) sustainedCritical(key, false);
    return false;
  }
  return sustainedCritical(key, isCritical);
}

function toPostedAlert(row: Incident, resolved: boolean): PostedAlert | null {
  const def = alertTypeByKind(row.kind);
  if (!def) return null;
  return {
    labels: {
      alertname: def.alertname,
      site: row.siteId,
      severity: def.severity,
      noc_key: row.key
    },
    annotations: {
      summary: row.title,
      description: row.detail
    },
    startsAt: row.openedAt,
    endsAt: resolved ? (row.resolvedAt ?? new Date().toISOString()) : undefined
  };
}

function remember(pages: PostedAlert[], row: Incident, resolved: boolean) {
  const posted = toPostedAlert(row, resolved);
  if (posted) pages.push(posted);
}

/** Open/resolve status-derived incidents from current site statuses. */
export function syncIncidentsFromStatuses(statuses: SiteStatus[]): {
  open: Incident[];
  history: Incident[];
} {
  const activeKeys = new Set<string>();
  const pages: PostedAlert[] = [];

  const track = (input: {
    key: string;
    siteId: string;
    siteName: string;
    kind: AlertTypeId;
    title: string;
    detail: string;
  }) => {
    activeKeys.add(input.key);
    const { incident } = upsertOpenIncident(input);
    remember(pages, incident, false);
  };

  for (const st of statuses) {
    const name = siteName(st.siteId);
    const up = st.uplink ?? st.wan;
    const col = st.collector;
    const probeDown = col?.state === "critical";

    const uplinkKey = `uplink:${st.siteId}`;
    if (alertReady(st.siteId, "uplink", uplinkKey, up?.state === "critical", probeDown)) {
      track({
        key: uplinkKey,
        siteId: st.siteId,
        siteName: name,
        kind: "uplink",
        title: `Internet DOWN — ${name}`,
        detail: up.notes ?? "Both internet checks failed. Check the uplink and the collector."
      });
    }

    const collectorKey = `collector:${st.siteId}`;
    if (alertReady(st.siteId, "collector", collectorKey, col?.state === "critical", probeDown)) {
      track({
        key: collectorKey,
        siteId: st.siteId,
        siteName: name,
        kind: "collector",
        title: `Collector offline — ${name}`,
        detail:
          col.notes ??
          "The monitoring box at this location is not reporting. Check power and the network, then open Collector Console."
      });
    }

    for (const w of st.websiteStates ?? []) {
      const wKey = websiteIncidentKey(st.siteId, w.url);
      if (alertReady(st.siteId, "website", wKey, w.state === "critical", probeDown)) {
        track({
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
      if (alertReady(st.siteId, "device", downKey, d.state === "critical", probeDown)) {
        track({
          key: downKey,
          siteId: st.siteId,
          siteName: name,
          kind: "device",
          title: `Device unreachable — ${d.name}`,
          detail: d.notes ?? `${d.name} is not answering ping or SNMP. Check power and the network cable.`
        });
      }
      const snmpKey = `snmp:${st.siteId}:${d.deviceId}`;
      if (alertReady(st.siteId, "snmp", snmpKey, d.state === "warning", probeDown)) {
        track({
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
  }

  for (const row of listBandwidthIncidents()) {
    if (alertReady(row.siteId, "bandwidth", row.key, true, false)) {
      track({
        key: row.key,
        siteId: row.siteId,
        siteName: row.siteName,
        kind: "bandwidth",
        title: row.title,
        detail: row.detail
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
  for (const i of getOpenIncidents()) candidates.add(i.key);

  for (const key of candidates) {
    if (!activeKeys.has(key)) {
      const resolved = markResolvedIfOpen(key);
      if (resolved) remember(pages, resolved, true);
    }
  }

  if (pages.length > 0) void postAlerts(pages);

  return { open: getOpenIncidents(), history: getHistoryIncidents() };
}

/** Stop paging an incident the operator has acknowledged. Health is unchanged. */
export function deliverResolvedIncident(row: Incident): void {
  const posted = toPostedAlert(row, true);
  if (posted) void postAlerts([posted]);
}

export function listSyncedIncidents(statuses: SiteStatus[]) {
  return syncIncidentsFromStatuses(statuses);
}
