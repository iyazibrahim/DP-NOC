import {
  promQuery,
  promQueryRange,
  parseFirstVectorValue,
  type PromQueryResult
} from "./prometheus";
import { getSiteById, type Site } from "../data/sites";
import { getHistoryIncidents, getOpenIncidents } from "../data/incidents";
import { probeSuccessFresh, METRIC_FRESH_WINDOW } from "./promLabels";

function escapePromLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export type SnmpInterfaceInfo = {
  ifName: string;
  ifDescr?: string;
  ifIndex?: string;
};

export type SiteNetworkSeriesPoint = { ts: number; value: number };

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
  clients: {
    total: number | null;
    byDevice: Array<{ deviceId: string; name: string; clients: number | null; vendor: string }>;
  };
  incidents: Array<{
    id: string;
    title: string;
    detail: string;
    openedAt: string;
    resolvedAt?: string;
    acknowledgedAt?: string;
  }>;
  speedtest: { available: false; message: string };
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

function ifMatcher(ifName: string): string {
  const e = escapePromLabel(ifName);
  return `ifName="${e}"`;
}

function buildIfTrafficQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string,
  ifName: string
): string {
  const octets = direction === "in" ? "ifHCInOctets" : "ifHCOutOctets";
  return `sum(rate(${octets}{site="${escapePromLabel(siteId)}",device="${escapePromLabel(deviceId)}",${ifMatcher(ifName)}}[5m]) * 8)`;
}

function buildIfCapacityQuery(siteId: string, deviceId: string, ifName: string): string {
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  const m = ifMatcher(ifName);
  return `(sum(ifHighSpeed{site="${s}",device="${d}",${m}} * 1000000) > 0)
  or sum(ifSpeed{site="${s}",device="${d}",${m}} > 0)`;
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

export async function listDeviceInterfaces(
  siteId: string,
  deviceId: string
): Promise<SnmpInterfaceInfo[]> {
  const s = escapePromLabel(siteId);
  const d = escapePromLabel(deviceId);
  try {
    const data = await promQuery(`ifOperStatus{site="${s}",device="${d}"}`);
    if (data.resultType !== "vector" || !Array.isArray(data.result)) return [];
    const seen = new Map<string, SnmpInterfaceInfo>();
    for (const row of data.result as Array<{ metric?: Record<string, string> }>) {
      const m = row.metric ?? {};
      const ifName = (m.ifName || m.ifDescr || "").trim();
      if (!ifName) continue;
      if (!seen.has(ifName)) {
        seen.set(ifName, {
          ifName,
          ifDescr: m.ifDescr,
          ifIndex: m.ifIndex
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.ifName.localeCompare(b.ifName));
  } catch {
    return [];
  }
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

      const end = Math.floor(Date.now() / 1000);
      const start = end - Math.max(1, hours) * 3600;
      const step = hours > 48 ? "15m" : hours > 6 ? "5m" : "60s";
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

  const aps = site.devices.filter((d) => d.type === "ap" && d.kind === "network");
  const byDevice: SiteNetworkSummary["clients"]["byDevice"] = [];
  let total = 0;
  let anyClient = false;

  for (const ap of aps) {
    const vendor = (ap.vendor || "generic").toLowerCase();
    let clients: number | null = null;
    try {
      if (vendor === "cambium") {
        clients = parseFirstVectorValue(
          await promQuery(
            `sum(cambiumAPTotalClients{site="${escapePromLabel(siteId)}",device="${escapePromLabel(ap.id)}"})`
          )
        );
      } else if (vendor === "omada" || vendor === "tplink" || vendor === "tp-link") {
        clients = parseFirstVectorValue(
          await promQuery(
            `omadaClientCount{site="${escapePromLabel(siteId)}",device="${escapePromLabel(ap.id)}"}`
          )
        );
      }
    } catch {
      clients = null;
    }
    if (clients != null) {
      anyClient = true;
      total += clients;
    }
    byDevice.push({ deviceId: ap.id, name: ap.name, clients, vendor: ap.vendor });
  }

  const incidents = [...getOpenIncidents(), ...getHistoryIncidents()]
    .filter((i) => i.siteId === siteId)
    .slice(0, 20)
    .map((i) => ({
      id: i.id,
      title: i.title,
      detail: i.detail,
      openedAt: i.openedAt,
      resolvedAt: i.resolvedAt,
      acknowledgedAt: i.acknowledgedAt
    }));

  return {
    siteId,
    wanUplink,
    wanDeviceName: wanDevice?.name ?? null,
    uplink: { dns, vps },
    traffic,
    trafficSeries: { inBps: inSeries, outBps: outSeries },
    clients: {
      total: anyClient ? total : null,
      byDevice
    },
    incidents,
    speedtest: {
      available: false,
      message: "ISP speedtest coming later — bandwidth above is live link usage."
    }
  };
}
