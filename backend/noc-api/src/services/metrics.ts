import { promQuery, promQueryRange } from "./prometheus";
import {
  dualHostMetric,
  dualHostUpFresh,
  dualSnmpUpFresh,
  hostFreshGuard,
  METRIC_FRESH_WINDOW,
  probeSuccessFresh
} from "./promLabels";

export type MetricPreset = {
  id: string;
  label: string;
  kind: "server" | "network" | "any";
  query: string;
  unit?: string;
};

/**
 * Presets use {{site}} / {{device}}. buildQuery expands them and rewrites
 * host series to match either `device` or `instance` (legacy Alloy).
 */
export const METRIC_PRESETS: MetricPreset[] = [
  {
    id: "cpu_pct",
    label: "CPU usage",
    kind: "server",
    unit: "%",
    query: `CPU_PLACEHOLDER`
  },
  {
    id: "mem_pct",
    label: "Memory free",
    kind: "server",
    unit: "%",
    query: `MEM_PLACEHOLDER`
  },
  {
    id: "disk_pct",
    label: "Disk free",
    kind: "server",
    unit: "%",
    query: `DISK_PLACEHOLDER`
  },
  {
    id: "host_up",
    label: "Collector online",
    kind: "server",
    query: `UP_PLACEHOLDER`
  },
  {
    id: "snmp_up",
    label: "SNMP device online",
    kind: "network",
    query: `snmp_up{site="{{site}}",device="{{device}}"}`
  },
  {
    id: "if_in_bps",
    label: "SNMP traffic in",
    kind: "network",
    unit: "bps",
    query: `IF_IN_PLACEHOLDER`
  },
  {
    id: "if_out_bps",
    label: "SNMP traffic out",
    kind: "network",
    unit: "bps",
    query: `IF_OUT_PLACEHOLDER`
  },
  {
    id: "wan_dns",
    label: "Uplink (DNS)",
    kind: "any",
    query: `WAN_DNS_PLACEHOLDER`
  },
  {
    id: "wan_vps",
    label: "Uplink (central)",
    kind: "any",
    query: `WAN_VPS_PLACEHOLDER`
  }
];

function buildCpuQuery(siteId: string, deviceId: string): string {
  // Only emit CPU when host metrics are still fresh — avoids end-of-series rate() spikes on stop.
  const idleDevice = `rate(node_cpu_seconds_total{mode="idle",site="${siteId}",device="${deviceId}"}[2m])`;
  const idleInstance = `rate(node_cpu_seconds_total{mode="idle",site="${siteId}",instance="${deviceId}"}[2m])`;
  const cpu = `clamp_min(clamp_max(100 - (avg( (${idleDevice}) or (${idleInstance}) ) * 100), 100), 0)`;
  const guard = hostFreshGuard(siteId, deviceId, METRIC_FRESH_WINDOW);
  return `${cpu} and on() (${guard})`;
}

function buildMemQuery(siteId: string, deviceId: string): string {
  const avail = dualHostMetric("node_memory_MemAvailable_bytes", siteId, deviceId);
  const total = dualHostMetric("node_memory_MemTotal_bytes", siteId, deviceId);
  const pct = `(${avail} / ${total}) * 100`;
  const guard = hostFreshGuard(siteId, deviceId, METRIC_FRESH_WINDOW);
  return `${pct} and on() (${guard})`;
}

function buildDiskQuery(siteId: string, deviceId: string): string {
  const avail = dualHostMetric(
    "node_filesystem_avail_bytes",
    siteId,
    deviceId,
    'mountpoint="/",fstype!="rootfs"'
  );
  const size = dualHostMetric(
    "node_filesystem_size_bytes",
    siteId,
    deviceId,
    'mountpoint="/",fstype!="rootfs"'
  );
  const pct = `(${avail} / ${size}) * 100`;
  const guard = hostFreshGuard(siteId, deviceId, METRIC_FRESH_WINDOW);
  return `${pct} and on() (${guard})`;
}

export function buildQuery(presetId: string, siteId: string, deviceId: string): string | null {
  const preset = METRIC_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;

  switch (presetId) {
    case "cpu_pct":
      return buildCpuQuery(siteId, deviceId);
    case "mem_pct":
      return buildMemQuery(siteId, deviceId);
    case "disk_pct":
      return buildDiskQuery(siteId, deviceId);
    case "host_up":
      return dualHostUpFresh(siteId, deviceId, METRIC_FRESH_WINDOW);
    case "wan_dns":
      return probeSuccessFresh(siteId, "wan_dns", METRIC_FRESH_WINDOW);
    case "wan_vps":
      return probeSuccessFresh(siteId, "wan_vps", METRIC_FRESH_WINDOW);
    case "snmp_up":
      return dualSnmpUpFresh(siteId, deviceId, METRIC_FRESH_WINDOW);
    case "if_in_bps":
      return `sum(rate(ifHCInOctets{site="${siteId}",device="${deviceId}"}[5m]) * 8)`;
    case "if_out_bps":
      return `sum(rate(ifHCOutOctets{site="${siteId}",device="${deviceId}"}[5m]) * 8)`;
    default:
      return preset.query.replace(/\{\{site\}\}/g, siteId).replace(/\{\{device\}\}/g, deviceId);
  }
}

/** Public preset list with illustrative query templates (for UI display). */
export function listPresetsForApi(): MetricPreset[] {
  return METRIC_PRESETS.map((p) => {
    if (p.id === "cpu_pct") {
      return {
        ...p,
        query: `CPU % only while host metrics fresh (${METRIC_FRESH_WINDOW})`
      };
    }
    if (p.id === "mem_pct") {
      return {
        ...p,
        query: "(node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100"
      };
    }
    if (p.id === "disk_pct") {
      return {
        ...p,
        query: "(node_filesystem_avail_bytes / node_filesystem_size_bytes) * 100"
      };
    }
    if (p.id === "host_up") {
      return {
        ...p,
        query: `last_over_time(up{job=~"site_host|integrations/unix"}[${METRIC_FRESH_WINDOW}])`
      };
    }
    if (p.id === "wan_dns" || p.id === "wan_vps") {
      return {
        ...p,
        query: `last_over_time(probe_success{check}[${METRIC_FRESH_WINDOW}])`
      };
    }
    if (p.id === "if_in_bps") {
      return {
        ...p,
        query: `sum(rate(ifHCInOctets{site,device}[5m]) * 8)`
      };
    }
    if (p.id === "if_out_bps") {
      return {
        ...p,
        query: `sum(rate(ifHCOutOctets{site,device}[5m]) * 8)`
      };
    }
    return p;
  });
}

export async function queryInstant(query: string) {
  return promQuery(query);
}

export async function queryRange(query: string, hours = 1, step = "60s") {
  const end = Math.floor(Date.now() / 1000);
  const start = end - hours * 3600;
  return promQueryRange(query, start, end, step);
}
