import fs from "fs";
import path from "path";
import { getSiteById } from "../data/sites";
import { env } from "../env";
import { clientDayRows, knownSsids, ledgerSiteIds, type ClientDayRow } from "./clientLedger";
import { ymdInZone, zonedDayStartUnix } from "./lineUseWindow";

export const DEFAULT_GUEST_DOWNLOAD_BYTES = 5_000_000_000;
export const DEFAULT_CLIENT_TOTAL_BYTES = 20_000_000_000;
export const DEFAULT_UPLOAD_BYTES = 10_000_000_000;
export const DEFAULT_UPLOAD_RATIO = 0.7;

export type ClientWatchPolicy = {
  guestSsids: string[];
  guestDownloadBytes: number;
  clientTotalBytes: number;
  uploadBytes: number;
  /** Upload must be at least this fraction of that client's download. */
  uploadRatio: number;
};

export type WatchHit = {
  mac: string;
  hostname: string | null;
  ssid: string | null;
  apLabel: string | null;
  inBytes: number;
  outBytes: number;
  apps: string[];
  reasons: string[];
};

type WatchFile = { sites: Record<string, ClientWatchPolicy> };

export function defaultClientWatch(): ClientWatchPolicy {
  return {
    guestSsids: [],
    guestDownloadBytes: DEFAULT_GUEST_DOWNLOAD_BYTES,
    clientTotalBytes: DEFAULT_CLIENT_TOTAL_BYTES,
    uploadBytes: DEFAULT_UPLOAD_BYTES,
    uploadRatio: DEFAULT_UPLOAD_RATIO
  };
}

function watchPath(): string {
  const dir = path.join(process.cwd(), "data/runtime");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "client-watch.json");
}

function loadFile(): WatchFile {
  const file = watchPath();
  if (!fs.existsSync(file)) return { sites: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as WatchFile;
    return parsed?.sites ? parsed : { sites: {} };
  } catch {
    return { sites: {} };
  }
}

function positive(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function normalizePolicy(raw: Partial<ClientWatchPolicy> | undefined): ClientWatchPolicy {
  const base = defaultClientWatch();
  const ssids = Array.isArray(raw?.guestSsids)
    ? [...new Set(raw.guestSsids.map((s) => String(s).trim()).filter(Boolean))]
    : base.guestSsids;
  const ratio = positive(raw?.uploadRatio, base.uploadRatio);
  return {
    guestSsids: ssids,
    guestDownloadBytes: positive(raw?.guestDownloadBytes, base.guestDownloadBytes),
    clientTotalBytes: positive(raw?.clientTotalBytes, base.clientTotalBytes),
    uploadBytes: positive(raw?.uploadBytes, base.uploadBytes),
    uploadRatio: Math.min(1, ratio)
  };
}

export function getClientWatch(siteId: string): ClientWatchPolicy {
  return normalizePolicy(loadFile().sites[siteId]);
}

export function saveClientWatch(siteId: string, policy: Partial<ClientWatchPolicy>): ClientWatchPolicy {
  const file = loadFile();
  const next = normalizePolicy(policy);
  file.sites[siteId] = next;
  fs.writeFileSync(watchPath(), JSON.stringify(file, null, 2) + "\n", "utf8");
  return next;
}

export function formatBytes(bytes: number): string {
  const gb = 1_000_000_000;
  const mb = 1_000_000;
  if (bytes >= gb) return `${(bytes / gb).toFixed(bytes >= 10 * gb ? 1 : 2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${Math.round(bytes)} B`;
}

function guestMatch(ssid: string | null, guests: string[]): boolean {
  if (!ssid) return false;
  const want = ssid.trim().toLowerCase();
  return guests.some((guest) => guest.trim().toLowerCase() === want);
}

export function hitsForDay(rows: ClientDayRow[], policy: ClientWatchPolicy): WatchHit[] {
  const hits: WatchHit[] = [];
  for (const row of rows) {
    const reasons: string[] = [];
    const total = row.inBytes + row.outBytes;
    if (guestMatch(row.ssid, policy.guestSsids) && row.inBytes >= policy.guestDownloadBytes) {
      reasons.push(
        `Guest download ${formatBytes(row.inBytes)} is over the ${formatBytes(policy.guestDownloadBytes)} cap.`
      );
    }
    if (total >= policy.clientTotalBytes) {
      reasons.push(`Combined use ${formatBytes(total)} is over the ${formatBytes(policy.clientTotalBytes)} cap.`);
    }
    const ratio = row.inBytes > 0 ? row.outBytes / row.inBytes : row.outBytes > 0 ? 1 : 0;
    if (row.outBytes >= policy.uploadBytes && ratio >= policy.uploadRatio) {
      reasons.push(
        `Upload ${formatBytes(row.outBytes)} is at least ${Math.round(policy.uploadRatio * 100)}% of download.`
      );
    }
    if (reasons.length === 0) continue;
    hits.push({
      mac: row.mac,
      hostname: row.hostname,
      ssid: row.ssid,
      apLabel: row.apLabel,
      inBytes: row.inBytes,
      outBytes: row.outBytes,
      apps: row.apps,
      reasons
    });
  }
  return hits;
}

export type BandwidthIncidentDraft = {
  key: string;
  siteId: string;
  siteName: string;
  title: string;
  detail: string;
};

export function bandwidthIncidentKey(siteId: string, mac: string, date: string): string {
  return `bandwidth:${siteId}:${mac}:${date}`;
}

export function macFromBandwidthKey(key: string, siteId: string): string | null {
  const prefix = `bandwidth:${siteId}:`;
  if (!key.startsWith(prefix)) return null;
  const match = key.slice(prefix.length).match(/^([0-9a-f]{2}(?::[0-9a-f]{2}){5}):(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : null;
}

export function listBandwidthIncidents(now = new Date()): BandwidthIncidentDraft[] {
  const date = ymdInZone(env.NOC_TZ, zonedDayStartUnix(env.NOC_TZ, now, 0));
  const drafts: BandwidthIncidentDraft[] = [];
  for (const siteId of ledgerSiteIds()) {
    const site = getSiteById(siteId);
    if (!site) continue;
    const policy = getClientWatch(siteId);
    for (const hit of hitsForDay(clientDayRows(siteId, date), policy)) {
      const who = hit.hostname || hit.mac;
      const services = hit.apps.length > 0 ? hit.apps.join(", ") : "not logged";
      drafts.push({
        key: bandwidthIncidentKey(siteId, hit.mac, date),
        siteId,
        siteName: site.name,
        title: `High use — ${who}`,
        detail: `${who} (${hit.mac}) on ${hit.ssid || "unknown SSID"} via ${hit.apLabel || "unknown AP"}. Download ${formatBytes(hit.inBytes)}. Upload ${formatBytes(hit.outBytes)}. ${hit.reasons.join(" ")} Services: ${services}.`
      });
    }
  }
  return drafts;
}

export function watchContext(siteId: string): { policy: ClientWatchPolicy; ssids: string[] } {
  return { policy: getClientWatch(siteId), ssids: knownSsids(siteId) };
}
