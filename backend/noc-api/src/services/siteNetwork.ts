import {
  promQuery,
  promQueryRange,
  parseFirstVectorValue,
  type PromQueryResult
} from "./prometheus";
import { getSiteById, type Site } from "../data/sites";
import { loadSiteStations } from "../data/siteStations";
import { dualSnmpUpFresh, probeSuccessFresh, METRIC_FRESH_WINDOW } from "./promLabels";

function escapePromLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export type SnmpInterfaceInfo = {
  ifName: string;
  ifDescr?: string;
  ifIndex?: string;
};

export type SiteNetworkSeriesPoint = { ts: number; value: number };

export type SiteNetworkApRow = {
  deviceId: string;
  name: string;
  nickname: string | null;
  /** nickname if set, else inventory name — use for charts/table */
  label: string;
  vendor: string;
  clients: number | null;
  inBps: number | null;
  outBps: number | null;
  snmpUp: number | null;
};

export type SiteNetworkStation = {
  deviceId: string;
  apLabel: string;
  vendor: string;
  mac: string | null;
  hostname: string | null;
  ip: string | null;
  ssid: string | null;
  snr: number | null;
  txRate: string | null;
  inBps: number | null;
  outBps: number | null;
  clientOs: string | null;
  hwMode: string | null;
};

export type SiteNetworkSummary = {
  siteId: string;
  wanUplink: Site["wanUplink"] | null;
  wanDeviceName: string | null;
  uplink: {
    dns: number | null;
    vps: number | null;
  };
  traffic: {
    inBps: number | null;
    outBps: number | null;
    utilInPct: number | null;
    utilOutPct: number | null;
    capacityBps: number | null;
  };
  trafficSeries: {
    inBps: SiteNetworkSeriesPoint[];
    outBps: SiteNetworkSeriesPoint[];
  };
  /** @deprecated prefer `aps` */
  clients: {
    total: number | null;
    byDevice: Array<{ deviceId: string; name: string; clients: number | null; vendor: string }>;
  };
  aps: SiteNetworkApRow[];
  /** Per-station Wi‑Fi clients (Cambium rich; Omada MAC-only when table walks). */
  stations: SiteNetworkStation[];
  speedtest: {
    available: boolean;
    downloadBps: number | null;
    uploadBps: number | null;
    pingMs: number | null;
    lastSuccessAt: number | null;
    downloadSeries: SiteNetworkSeriesPoint[];
    uploadSeries: SiteNetworkSeriesPoint[];
    message?: string;
  };
  /** Period averages / peaks for the Total bandwidth card (Today / 7d / 30d). */
  utilWindows?: {
    "1d": SiteNetworkUtilWindow;
    "7d": SiteNetworkUtilWindow;
    "30d": SiteNetworkUtilWindow;
  };
};

export type SiteNetworkUtilWindow = {
  avgInPct: number | null;
  avgOutPct: number | null;
  peakInPct: number | null;
  peakOutPct: number | null;
  /** Total octets downloaded (in) over the window. */
  inBytes: number | null;
  /** Total octets uploaded (out) over the window. */
  outBytes: number | null;
};

function parseSeries(data: PromQueryResult): SiteNetworkSeriesPoint[] {
  if (data.resultType !== "matrix" || !Array.isArray(data.result) || data.result.length === 0) {
    return [];
  }
  const row = data.result[0] as { values?: [number, string][] };
  if (!row.values?.length) return [];
  return row.values
    .map(([ts, v]) => {
      const n = Number(v);
      return { ts, value: Number.isFinite(n) ? n : 0 };
    })
    .filter((p) => Number.isFinite(p.ts));
}

function escapePromRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ifNameJoinMatcher(siteId: string, deviceId: string, ifName: string): string {
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  const indexOnly = /^ifIndex:(\d+)$/i.exec(ifName.trim());
  if (indexOnly) {
    return `ifHCInOctets{site="${s}",device="${d}",ifIndex="${indexOnly[1]}"}`;
  }
  const n = escapePromLabel(ifName);
  const nRe = escapePromRegex(ifName);
  return `(
  ifName{site="${s}",device="${d}",ifName="${n}"}
  or ifDescr{site="${s}",device="${d}",ifDescr="${n}"}
  or ifName{site="${s}",device="${d}",ifName=~"(?i)^${nRe}$"}
  or ifDescr{site="${s}",device="${d}",ifDescr=~"(?i)^${nRe}$"}
)`;
}

function buildIfTrafficQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string,
  ifName: string
): string {
  const octets = direction === "in" ? "ifHCInOctets" : "ifHCOutOctets";
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  const join = ifNameJoinMatcher(siteId, deviceId, ifName);
  const indexOnly = /^ifIndex:(\d+)$/i.test(ifName.trim());
  if (indexOnly) {
    const idx = /^ifIndex:(\d+)$/i.exec(ifName.trim())![1];
    return `sum(rate(${octets}{site="${s}",device="${d}",ifIndex="${idx}"}[5m]) * 8)`;
  }
  return `sum(
  rate(${octets}{site="${s}",device="${d}"}[5m]) * 8
  and on(ifIndex) ${join}
)`;
}

function buildDeviceTrafficQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string
): string {
  const octets = direction === "in" ? "ifHCInOctets" : "ifHCOutOctets";
  return `sum(rate(${octets}{site="${escapePromLabel(siteId)}",device="${escapePromLabel(deviceId)}"}[5m]) * 8)`;
}

function buildIfCapacityQuery(siteId: string, deviceId: string, ifName: string): string {
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  const indexOnly = /^ifIndex:(\d+)$/i.exec(ifName.trim());
  if (indexOnly) {
    const idx = indexOnly[1];
    return `(sum(ifHighSpeed{site="${s}",device="${d}",ifIndex="${idx}"} * 1000000) > 0)
  or sum(ifSpeed{site="${s}",device="${d}",ifIndex="${idx}"} > 0)`;
  }
  const join = ifNameJoinMatcher(siteId, deviceId, ifName);
  return `(sum(ifHighSpeed{site="${s}",device="${d}"} * 1000000 and on(ifIndex) ${join}) > 0)
  or sum(ifSpeed{site="${s}",device="${d}"} and on(ifIndex) ${join})`;
}

function buildIfUtilQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string,
  ifName: string
): string {
  const cap = `clamp_min((${buildIfCapacityQuery(siteId, deviceId, ifName)}), 1)`;
  return `(${buildIfTrafficQuery(direction, siteId, deviceId, ifName)} / ${cap}) * 100`;
}

/** Total octets transferred over `range` (e.g. 24h, 7d, 30d) on the tagged WAN if. */
function buildIfVolumeQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string,
  ifName: string,
  range: string
): string {
  const octets = direction === "in" ? "ifHCInOctets" : "ifHCOutOctets";
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  const indexOnly = /^ifIndex:(\d+)$/i.exec(ifName.trim());
  if (indexOnly) {
    return `sum(increase(${octets}{site="${s}",device="${d}",ifIndex="${indexOnly[1]}"}[${range}]))`;
  }
  const join = ifNameJoinMatcher(siteId, deviceId, ifName);
  return `sum(
  increase(${octets}{site="${s}",device="${d}"}[${range}])
  and on(ifIndex) ${join}
)`;
}

function collectInterfacesFromProm(
  data: PromQueryResult,
  labelKeys: string[]
): Map<string, SnmpInterfaceInfo> {
  const seen = new Map<string, SnmpInterfaceInfo>();
  if (data.resultType !== "vector" || !Array.isArray(data.result)) return seen;
  for (const row of data.result as Array<{ metric?: Record<string, string> }>) {
    const m = row.metric ?? {};
    let name = "";
    for (const key of labelKeys) {
      if (m[key]?.trim()) {
        name = m[key].trim();
        break;
      }
    }
    if (!name && m.ifIndex) name = `ifIndex:${m.ifIndex}`;
    if (!name) continue;
    if (!seen.has(name)) {
      seen.set(name, {
        ifName: name,
        ifDescr: m.ifDescr,
        ifIndex: m.ifIndex
      });
    }
  }
  return seen;
}

export async function listDeviceInterfaces(
  siteId: string,
  deviceId: string
): Promise<SnmpInterfaceInfo[]> {
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  const seen = new Map<string, SnmpInterfaceInfo>();
  try {
    const [byName, byDescr, byOper, byOctets] = await Promise.all([
      promQuery(`ifName{site="${s}",device="${d}"}`).catch(() => null),
      promQuery(`ifDescr{site="${s}",device="${d}"}`).catch(() => null),
      promQuery(`ifOperStatus{site="${s}",device="${d}"}`).catch(() => null),
      promQuery(`ifHCInOctets{site="${s}",device="${d}"}`).catch(() => null)
    ]);
    if (byName) {
      for (const [k, v] of collectInterfacesFromProm(byName, ["ifName"])) seen.set(k, v);
    }
    if (byDescr) {
      for (const [k, v] of collectInterfacesFromProm(byDescr, ["ifDescr", "ifName"])) {
        if (!seen.has(k)) seen.set(k, v);
      }
    }
    if (seen.size === 0 && byOper) {
      for (const [k, v] of collectInterfacesFromProm(byOper, ["ifName", "ifDescr"])) seen.set(k, v);
    }
    if (seen.size === 0 && byOctets) {
      for (const [k, v] of collectInterfacesFromProm(byOctets, ["ifName", "ifDescr"])) seen.set(k, v);
    }
  } catch {
    return [];
  }
  return [...seen.values()].sort((a, b) => a.ifName.localeCompare(b.ifName));
}

export async function getSiteNetworkSummary(
  siteId: string,
  hours = 24
): Promise<SiteNetworkSummary | null> {
  const site = getSiteById(siteId);
  if (!site) return null;

  const wanUplink = site.wanUplink ?? null;
  const wanDevice = wanUplink
    ? site.devices.find((d) => d.id === wanUplink.deviceId) ?? null
    : null;

  let dns: number | null = null;
  let vps: number | null = null;
  try {
    dns = parseFirstVectorValue(await promQuery(probeSuccessFresh(siteId, "wan_dns", METRIC_FRESH_WINDOW)));
    vps = parseFirstVectorValue(await promQuery(probeSuccessFresh(siteId, "wan_vps", METRIC_FRESH_WINDOW)));
  } catch {
    /* ignore */
  }

  const traffic = {
    inBps: null as number | null,
    outBps: null as number | null,
    utilInPct: null as number | null,
    utilOutPct: null as number | null,
    capacityBps: null as number | null
  };
  let inSeries: SiteNetworkSeriesPoint[] = [];
  let outSeries: SiteNetworkSeriesPoint[] = [];

  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.max(1, hours) * 3600;
  const step = hours >= 720 ? "1h" : hours > 48 ? "15m" : hours > 6 ? "5m" : "60s";

  if (wanUplink) {
    try {
      const [inBps, outBps, utilIn, utilOut, cap] = await Promise.all([
        parseFirstVectorValue(
          await promQuery(buildIfTrafficQuery("in", siteId, wanUplink.deviceId, wanUplink.ifName))
        ),
        parseFirstVectorValue(
          await promQuery(buildIfTrafficQuery("out", siteId, wanUplink.deviceId, wanUplink.ifName))
        ),
        parseFirstVectorValue(
          await promQuery(buildIfUtilQuery("in", siteId, wanUplink.deviceId, wanUplink.ifName))
        ),
        parseFirstVectorValue(
          await promQuery(buildIfUtilQuery("out", siteId, wanUplink.deviceId, wanUplink.ifName))
        ),
        parseFirstVectorValue(
          await promQuery(buildIfCapacityQuery(siteId, wanUplink.deviceId, wanUplink.ifName))
        )
      ]);
      traffic.inBps = inBps;
      traffic.outBps = outBps;
      traffic.utilInPct = utilIn != null ? Math.round(utilIn * 10) / 10 : null;
      traffic.utilOutPct = utilOut != null ? Math.round(utilOut * 10) / 10 : null;
      traffic.capacityBps = cap;

      const [inRange, outRange] = await Promise.all([
        promQueryRange(
          buildIfTrafficQuery("in", siteId, wanUplink.deviceId, wanUplink.ifName),
          start,
          end,
          step
        ),
        promQueryRange(
          buildIfTrafficQuery("out", siteId, wanUplink.deviceId, wanUplink.ifName),
          start,
          end,
          step
        )
      ]);
      inSeries = parseSeries(inRange);
      outSeries = parseSeries(outRange);
    } catch {
      /* keep nulls */
    }
  }

  const [aps, stations] = await Promise.all([
    collectApRows(siteId, site),
    collectStations(siteId, site)
  ]);
  let totalClients = 0;
  let anyClient = false;
  for (const row of aps) {
    if (row.clients != null) {
      anyClient = true;
      totalClients += row.clients;
    }
  }

  const speedtest = await collectSpeedtest(siteId, start, end, step);

  const utilWindows = wanUplink
    ? await collectUtilWindows(siteId, wanUplink.deviceId, wanUplink.ifName)
    : undefined;

  return {
    siteId,
    wanUplink,
    wanDeviceName: wanDevice?.name ?? null,
    uplink: { dns, vps },
    traffic,
    trafficSeries: { inBps: inSeries, outBps: outSeries },
    clients: {
      total: anyClient ? totalClients : null,
      byDevice: aps.map((a) => ({
        deviceId: a.deviceId,
        name: a.label,
        clients: a.clients,
        vendor: a.vendor
      }))
    },
    aps,
    stations,
    speedtest,
    utilWindows
  };
}

async function collectUtilWindows(
  siteId: string,
  deviceId: string,
  ifName: string
): Promise<NonNullable<SiteNetworkSummary["utilWindows"]>> {
  const utilIn = buildIfUtilQuery("in", siteId, deviceId, ifName);
  const utilOut = buildIfUtilQuery("out", siteId, deviceId, ifName);

  const roundPct = (v: number | null) =>
    v != null && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;

  const roundBytes = (v: number | null) =>
    v != null && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

  const emptyWindow = (): SiteNetworkUtilWindow => ({
    avgInPct: null,
    avgOutPct: null,
    peakInPct: null,
    peakOutPct: null,
    inBytes: null,
    outBytes: null
  });

  /** Prom range for util avg/peak vs volume increase (24h reads better than 1d for “Today”). */
  const queryWindow = async (
    utilRange: string,
    volumeRange: string
  ): Promise<SiteNetworkUtilWindow> => {
    try {
      const [avgIn, avgOut, peakIn, peakOut, inBytes, outBytes] = await Promise.all([
        parseFirstVectorValue(await promQuery(`avg_over_time((${utilIn})[${utilRange}:1h])`)),
        parseFirstVectorValue(await promQuery(`avg_over_time((${utilOut})[${utilRange}:1h])`)),
        parseFirstVectorValue(await promQuery(`max_over_time((${utilIn})[${utilRange}:1h])`)),
        parseFirstVectorValue(await promQuery(`max_over_time((${utilOut})[${utilRange}:1h])`)),
        parseFirstVectorValue(
          await promQuery(buildIfVolumeQuery("in", siteId, deviceId, ifName, volumeRange))
        ),
        parseFirstVectorValue(
          await promQuery(buildIfVolumeQuery("out", siteId, deviceId, ifName, volumeRange))
        )
      ]);
      return {
        avgInPct: roundPct(avgIn),
        avgOutPct: roundPct(avgOut),
        peakInPct: roundPct(peakIn),
        peakOutPct: roundPct(peakOut),
        inBytes: roundBytes(inBytes),
        outBytes: roundBytes(outBytes)
      };
    } catch {
      return emptyWindow();
    }
  };

  const [d1, d7, d30] = await Promise.all([
    queryWindow("24h", "24h"),
    queryWindow("7d", "7d"),
    queryWindow("30d", "30d")
  ]);
  return { "1d": d1, "7d": d7, "30d": d30 };
}

function isApLikeDevice(d: { type: string; kind: string; vendor: string }): boolean {
  if (d.kind !== "network") return false;
  const type = (d.type || "").toLowerCase();
  const vendor = (d.vendor || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (type === "ap" || /access.?point|wifi|wireless/.test(type)) return true;
  if (/cambium|omada|tplink|ubiquiti|unifi/.test(vendor)) return true;
  return false;
}

function normalizeVendorKey(vendor: string): string {
  return (vendor || "generic").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function readPromDeviceValues(
  query: string
): Promise<Array<{ deviceId: string; value: number }>> {
  try {
    const data = await promQuery(query);
    if (data.resultType !== "vector" || !Array.isArray(data.result)) return [];
    const out: Array<{ deviceId: string; value: number }> = [];
    for (const row of data.result as Array<{
      metric?: Record<string, string>;
      value?: [number, string];
    }>) {
      const deviceId = (row.metric?.device || "").trim();
      const n = Number(row.value?.[1]);
      if (!deviceId || !Number.isFinite(n)) continue;
      out.push({ deviceId, value: n });
    }
    return out;
  } catch {
    return [];
  }
}

function deviceLabel(d: { name: string; nickname?: string } | undefined, fallback: string): {
  name: string;
  nickname: string | null;
  label: string;
} {
  const name = d?.name?.trim() || fallback;
  const nickname = d?.nickname?.trim() ? d.nickname.trim() : null;
  return { name, nickname, label: nickname || name };
}

async function collectApRows(siteId: string, site: Site): Promise<SiteNetworkApRow[]> {
  const s = escapePromLabel(siteId);
  const inventoryAps = site.devices.filter(isApLikeDevice);
  const byId = new Map<string, SiteNetworkApRow>();

  for (const ap of inventoryAps) {
    const labels = deviceLabel(ap, ap.id);
    byId.set(ap.id, {
      deviceId: ap.id,
      name: labels.name,
      nickname: labels.nickname,
      label: labels.label,
      vendor: ap.vendor || "generic",
      clients: null,
      inBps: null,
      outBps: null,
      snmpUp: null
    });
  }

  const [cambiumRows, omadaRows] = await Promise.all([
    readPromDeviceValues(`cambiumAPTotalClients{site="${s}"}`),
    readPromDeviceValues(`omadaClientCount{site="${s}"}`)
  ]);

  for (const row of cambiumRows) {
    const existing = byId.get(row.deviceId);
    if (existing) {
      existing.clients = (existing.clients ?? 0) + row.value;
      if (normalizeVendorKey(existing.vendor) === "generic") existing.vendor = "cambium";
    } else {
      const inv = site.devices.find((d) => d.id === row.deviceId);
      const labels = deviceLabel(inv, row.deviceId);
      byId.set(row.deviceId, {
        deviceId: row.deviceId,
        name: labels.name,
        nickname: labels.nickname,
        label: labels.label,
        vendor: inv?.vendor || "cambium",
        clients: row.value,
        inBps: null,
        outBps: null,
        snmpUp: null
      });
    }
  }

  for (const row of omadaRows) {
    const existing = byId.get(row.deviceId);
    if (existing) {
      existing.clients = (existing.clients ?? 0) + row.value;
      if (normalizeVendorKey(existing.vendor) === "generic") existing.vendor = "omada";
    } else {
      const inv = site.devices.find((d) => d.id === row.deviceId);
      const labels = deviceLabel(inv, row.deviceId);
      byId.set(row.deviceId, {
        deviceId: row.deviceId,
        name: labels.name,
        nickname: labels.nickname,
        label: labels.label,
        vendor: inv?.vendor || "omada",
        clients: row.value,
        inBps: null,
        outBps: null,
        snmpUp: null
      });
    }
  }

  for (const ap of inventoryAps) {
    const row = byId.get(ap.id);
    if (!row || row.clients != null) continue;
    const vendor = normalizeVendorKey(ap.vendor);
    try {
      if (vendor === "cambium") {
        row.clients = parseFirstVectorValue(
          await promQuery(
            `sum(cambiumAPTotalClients{site="${s}",device="${escapePromLabel(ap.id)}"})`
          )
        );
      } else if (vendor === "omada" || vendor === "tplink") {
        row.clients = parseFirstVectorValue(
          await promQuery(`omadaClientCount{site="${s}",device="${escapePromLabel(ap.id)}"}`)
        );
      }
    } catch {
      /* leave null */
    }
  }

  await Promise.all(
    [...byId.values()].map(async (row) => {
      try {
        const [inBps, outBps, snmpUp] = await Promise.all([
          parseFirstVectorValue(await promQuery(buildDeviceTrafficQuery("in", siteId, row.deviceId))),
          parseFirstVectorValue(await promQuery(buildDeviceTrafficQuery("out", siteId, row.deviceId))),
          parseFirstVectorValue(await promQuery(dualSnmpUpFresh(siteId, row.deviceId, METRIC_FRESH_WINDOW)))
        ]);
        row.inBps = inBps;
        row.outBps = outBps;
        row.snmpUp = snmpUp;
      } catch {
        /* leave nulls */
      }
    })
  );

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

type PromLabeledRow = {
  metric: Record<string, string>;
  value: number;
};

async function readPromLabeledValues(query: string): Promise<PromLabeledRow[]> {
  try {
    const data = await promQuery(query);
    if (data.resultType !== "vector" || !Array.isArray(data.result)) return [];
    const out: PromLabeledRow[] = [];
    for (const row of data.result as Array<{
      metric?: Record<string, string>;
      value?: [number, string];
    }>) {
      const n = Number(row.value?.[1]);
      if (!Number.isFinite(n) || !row.metric) continue;
      out.push({ metric: row.metric, value: n });
    }
    return out;
  } catch {
    return [];
  }
}

function stationKey(deviceId: string, clientIndex: string, mac: string | null): string {
  if (mac) return `${deviceId}|mac:${mac.toLowerCase()}`;
  return `${deviceId}|idx:${clientIndex}`;
}

function cleanLabel(v: string | undefined | null): string | null {
  const t = (v || "").trim();
  if (!t || t === "<nil>" || t === "0.0.0.0") return null;
  return t;
}

/** Normalize MAC from Prom SNMP labels (binary PhysAddress or Omada ASCII Hex-STRING). */
function formatMacLabel(v: string | undefined | null): string | null {
  let t = cleanLabel(v);
  if (!t) return null;
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }

  // Spaced Hex-STRING: 6 bytes = binary MAC; longer = Omada ASCII "AA-BB-CC-DD-EE-FF"
  if (/^[0-9A-Fa-f]{2}( [0-9A-Fa-f]{2})+$/.test(t)) {
    const parts = t.split(/\s+/);
    if (parts.length === 6) {
      return parts.map((h) => h.toLowerCase()).join(":");
    }
    t = parts
      .map((h) => String.fromCharCode(parseInt(h, 16)))
      .join("")
      .replace(/\0/g, "")
      .trim();
  }

  const extract12 = (s: string): string | null => {
    const hex = s.replace(/[^0-9a-fA-F]/g, "");
    if (hex.length === 12) {
      return hex.toLowerCase().match(/.{2}/g)!.join(":");
    }
    return null;
  };

  const direct = extract12(t);
  if (direct) return direct;

  const onlyHex = t.replace(/[^0-9a-fA-F]/g, "");
  if (onlyHex.length > 12 && onlyHex.length % 2 === 0 && !/[:\-]/.test(t)) {
    const ascii = onlyHex
      .match(/.{2}/g)!
      .map((h) => String.fromCharCode(parseInt(h, 16)))
      .join("")
      .replace(/[^\x20-\x7E]/g, "")
      .trim();
    return extract12(ascii);
  }

  return null;
}

async function collectStations(siteId: string, site: Site): Promise<SiteNetworkStation[]> {
  const s = escapePromLabel(siteId);
  const apLabelById = new Map<string, { label: string; vendor: string }>();
  for (const d of site.devices.filter(isApLikeDevice)) {
    const labels = deviceLabel(d, d.id);
    apLabelById.set(d.id, { label: labels.label, vendor: d.vendor || "generic" });
  }

  const byKey = new Map<string, SiteNetworkStation & { clientIndex?: string }>();

  const ensureRow = (
    deviceId: string,
    clientIndex: string,
    macRaw: string | undefined,
    vendorFallback: string
  ): SiteNetworkStation & { clientIndex?: string } => {
    const mac = formatMacLabel(macRaw);
    const key = stationKey(deviceId, clientIndex, mac);
    let row = byKey.get(key);
    if (!row) {
      const inv = apLabelById.get(deviceId);
      row = {
        deviceId,
        apLabel: inv?.label || deviceId,
        vendor: inv?.vendor || vendorFallback,
        mac,
        hostname: null,
        ip: null,
        ssid: null,
        snr: null,
        txRate: null,
        inBps: null,
        outBps: null,
        clientOs: null,
        hwMode: null,
        clientIndex
      };
      byKey.set(key, row);
    } else if (mac && !row.mac) {
      row.mac = mac;
    }
    return row;
  };

  const [infoRows, snrRows, txBpsRows, rxBpsRows, omadaRows] = await Promise.all([
    readPromLabeledValues(`cambiumClientInfo{site="${s}"}`),
    readPromLabeledValues(`cambiumClientSNR{site="${s}"}`),
    readPromLabeledValues(`rate(cambiumClientTxDataBytes{site="${s}"}[5m]) * 8`),
    readPromLabeledValues(`rate(cambiumClientRxDataBytes{site="${s}"}[5m]) * 8`),
    readPromLabeledValues(`omadaClientInfo{site="${s}"}`)
  ]);

  for (const row of infoRows) {
    const deviceId = (row.metric.device || "").trim();
    const clientIndex = (row.metric.clientIndex || "").trim();
    if (!deviceId || !clientIndex) continue;
    const st = ensureRow(deviceId, clientIndex, row.metric.mac, "cambium");
    st.hostname = cleanLabel(row.metric.client_name) ?? st.hostname;
    st.ip = cleanLabel(row.metric.client_ip) ?? st.ip;
    st.ssid = cleanLabel(row.metric.ssid) ?? st.ssid;
    st.txRate = cleanLabel(row.metric.tx_rate) ?? st.txRate;
    st.clientOs = cleanLabel(row.metric.client_os) ?? st.clientOs;
    st.hwMode = cleanLabel(row.metric.hw_mode) ?? st.hwMode;
    if (normalizeVendorKey(st.vendor) === "generic") st.vendor = "cambium";
  }

  for (const row of snrRows) {
    const deviceId = (row.metric.device || "").trim();
    const clientIndex = (row.metric.clientIndex || "").trim();
    if (!deviceId || !clientIndex) continue;
    const st = ensureRow(deviceId, clientIndex, row.metric.mac, "cambium");
    st.snr = Number.isFinite(row.value) ? Math.round(row.value) : st.snr;
  }

  // Cambium TxDataBytes = bytes transmitted by the client (uplink from client → AP).
  // RxDataBytes = bytes received by the client (downlink AP → client).
  // UI "In" = download to client (rx), "Out" = upload from client (tx).
  for (const row of rxBpsRows) {
    const deviceId = (row.metric.device || "").trim();
    const clientIndex = (row.metric.clientIndex || "").trim();
    if (!deviceId || !clientIndex) continue;
    const st = ensureRow(deviceId, clientIndex, row.metric.mac, "cambium");
    st.inBps = Number.isFinite(row.value) && row.value >= 0 ? row.value : st.inBps;
  }
  for (const row of txBpsRows) {
    const deviceId = (row.metric.device || "").trim();
    const clientIndex = (row.metric.clientIndex || "").trim();
    if (!deviceId || !clientIndex) continue;
    const st = ensureRow(deviceId, clientIndex, row.metric.mac, "cambium");
    st.outBps = Number.isFinite(row.value) && row.value >= 0 ? row.value : st.outBps;
  }

  for (const row of omadaRows) {
    const deviceId = (row.metric.device || "").trim();
    const clientIndex = (row.metric.clientIndex || "").trim();
    if (!deviceId || !clientIndex) continue;
    const st = ensureRow(deviceId, clientIndex, row.metric.mac, "omada");
    if (normalizeVendorKey(st.vendor) === "generic") st.vendor = "omada";
  }

  let stations: SiteNetworkStation[] = [...byKey.values()].map(({ clientIndex: _ci, ...rest }) => rest);

  // Fallback: collector-console snmpwalk push (Prom station series often empty on E-series).
  if (stations.length === 0) {
    const stored = loadSiteStations(siteId);
    if (stored?.stations?.length) {
      // Overlay live Prom rates by MAC when available.
      const rateByMac = new Map<string, { inBps: number | null; outBps: number | null }>();
      for (const row of rxBpsRows) {
        const mac = formatMacLabel(row.metric.mac);
        if (!mac) continue;
        const cur = rateByMac.get(mac) ?? { inBps: null, outBps: null };
        cur.inBps = Number.isFinite(row.value) ? row.value : cur.inBps;
        rateByMac.set(mac, cur);
      }
      for (const row of txBpsRows) {
        const mac = formatMacLabel(row.metric.mac);
        if (!mac) continue;
        const cur = rateByMac.get(mac) ?? { inBps: null, outBps: null };
        cur.outBps = Number.isFinite(row.value) ? row.value : cur.outBps;
        rateByMac.set(mac, cur);
      }

      stations = stored.stations.map((st) => {
        const rates = st.mac ? rateByMac.get(st.mac.toLowerCase()) : undefined;
        return {
          deviceId: st.deviceId,
          apLabel: st.apLabel || apLabelById.get(st.deviceId)?.label || st.deviceId,
          vendor: st.vendor || apLabelById.get(st.deviceId)?.vendor || "generic",
          mac: st.mac,
          hostname: st.hostname,
          ip: st.ip,
          ssid: st.ssid,
          snr: st.snr,
          txRate: st.txRate,
          inBps: rates?.inBps ?? st.inBps,
          outBps: rates?.outBps ?? st.outBps,
          clientOs: st.clientOs,
          hwMode: st.hwMode
        };
      });
    }
  }

  stations.sort((a, b) => {
    const ta = (a.inBps ?? 0) + (a.outBps ?? 0);
    const tb = (b.inBps ?? 0) + (b.outBps ?? 0);
    if (tb !== ta) return tb - ta;
    const na = (a.hostname || a.mac || "").toLowerCase();
    const nb = (b.hostname || b.mac || "").toLowerCase();
    return na.localeCompare(nb);
  });

  return stations;
}

async function collectSpeedtest(
  siteId: string,
  start: number,
  end: number,
  step: string
): Promise<SiteNetworkSummary["speedtest"]> {
  const s = escapePromLabel(siteId);
  const empty: SiteNetworkSummary["speedtest"] = {
    available: false,
    downloadBps: null,
    uploadBps: null,
    pingMs: null,
    lastSuccessAt: null,
    downloadSeries: [],
    uploadSeries: [],
    message:
      "No speedtest data yet. Deploy the site-box speedtest service (every 15m) and Force-apply collectors."
  };
  try {
    const [downloadBps, uploadBps, pingMs, lastSuccessAt] = await Promise.all([
      parseFirstVectorValue(
        await promQuery(`last_over_time(noc_speedtest_download_bps{site="${s}"}[30m])`)
      ),
      parseFirstVectorValue(
        await promQuery(`last_over_time(noc_speedtest_upload_bps{site="${s}"}[30m])`)
      ),
      parseFirstVectorValue(
        await promQuery(`last_over_time(noc_speedtest_ping_ms{site="${s}"}[30m])`)
      ),
      parseFirstVectorValue(
        await promQuery(`last_over_time(noc_speedtest_last_success_timestamp{site="${s}"}[30m])`)
      )
    ]);

    if (downloadBps == null && uploadBps == null && pingMs == null) {
      return empty;
    }

    const [downloadSeries, uploadSeries] = await Promise.all([
      promQueryRange(`noc_speedtest_download_bps{site="${s}"}`, start, end, step)
        .then(parseSeries)
        .catch(() => [] as SiteNetworkSeriesPoint[]),
      promQueryRange(`noc_speedtest_upload_bps{site="${s}"}`, start, end, step)
        .then(parseSeries)
        .catch(() => [] as SiteNetworkSeriesPoint[])
    ]);

    return {
      available: true,
      downloadBps,
      uploadBps,
      pingMs: pingMs != null ? Math.round(pingMs * 10) / 10 : null,
      lastSuccessAt: lastSuccessAt != null ? Math.floor(lastSuccessAt) : null,
      downloadSeries,
      uploadSeries
    };
  } catch {
    return empty;
  }
}
