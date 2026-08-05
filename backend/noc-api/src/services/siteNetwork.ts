import {
  promQuery,
  promQueryRange,
  parseFirstVectorValue,
  type PromQueryResult
} from "./prometheus";
import { getSiteById, type Site } from "../data/sites";
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

  const aps = await collectApRows(siteId, site);
  let totalClients = 0;
  let anyClient = false;
  for (const row of aps) {
    if (row.clients != null) {
      anyClient = true;
      totalClients += row.clients;
    }
  }

  const speedtest = await collectSpeedtest(siteId, start, end, step);

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
    speedtest
  };
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
