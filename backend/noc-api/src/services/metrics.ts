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
  /** When set, only offer this preset for matching device.type values. */
  deviceTypes?: string[];
  /** When set, only offer when device.vendor normalizes to one of these. */
  vendors?: string[];
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
    label: "Device online (SNMP)",
    kind: "network",
    query: `snmp_up{site="{{site}}",device="{{device}}"}`
  },
  {
    id: "if_in_bps",
    label: "Traffic in (rate)",
    kind: "network",
    unit: "bps",
    query: `IF_IN_PLACEHOLDER`
  },
  {
    id: "if_out_bps",
    label: "Traffic out (rate)",
    kind: "network",
    unit: "bps",
    query: `IF_OUT_PLACEHOLDER`
  },
  {
    id: "if_util_in_pct",
    label: "Bandwidth utilization in (%)",
    kind: "network",
    unit: "%",
    query: `IF_UTIL_IN_PLACEHOLDER`
  },
  {
    id: "if_util_out_pct",
    label: "Bandwidth utilization out (%)",
    kind: "network",
    unit: "%",
    query: `IF_UTIL_OUT_PLACEHOLDER`
  },
  {
    id: "if_util_max_pct",
    label: "Bandwidth utilization (overall)",
    kind: "network",
    unit: "%",
    query: `IF_UTIL_MAX_PLACEHOLDER`
  },
  {
    id: "if_capacity_bps",
    label: "Link capacity",
    kind: "network",
    unit: "bps",
    query: `IF_CAPACITY_PLACEHOLDER`
  },
  {
    id: "if_up_count",
    label: "Interfaces up",
    kind: "network",
    unit: "count",
    query: `IF_UP_COUNT_PLACEHOLDER`
  },
  {
    id: "if_down_count",
    label: "Interfaces down",
    kind: "network",
    unit: "count",
    query: `IF_DOWN_COUNT_PLACEHOLDER`
  },
  {
    id: "if_errors_in_rate",
    label: "Errors in (per sec)",
    kind: "network",
    unit: "count",
    query: `IF_ERR_IN_PLACEHOLDER`
  },
  {
    id: "if_errors_out_rate",
    label: "Errors out (per sec)",
    kind: "network",
    unit: "count",
    query: `IF_ERR_OUT_PLACEHOLDER`
  },
  {
    id: "if_discards_in_rate",
    label: "Discards in (per sec)",
    kind: "network",
    unit: "count",
    query: `IF_DISC_IN_PLACEHOLDER`
  },
  {
    id: "if_discards_out_rate",
    label: "Discards out (per sec)",
    kind: "network",
    unit: "count",
    query: `IF_DISC_OUT_PLACEHOLDER`
  },
  {
    id: "fw_cpu_pct",
    label: "Firewall CPU %",
    kind: "network",
    unit: "%",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_CPU_PLACEHOLDER`
  },
  {
    id: "fw_mem_pct",
    label: "Firewall memory %",
    kind: "network",
    unit: "%",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_MEM_PLACEHOLDER`
  },
  {
    id: "fw_sessions",
    label: "Firewall sessions",
    kind: "network",
    unit: "count",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_SES_PLACEHOLDER`
  },
  {
    id: "sw_cpu_pct",
    label: "Switch CPU %",
    kind: "network",
    unit: "%",
    deviceTypes: ["switch"],
    vendors: ["maipu"],
    query: `SW_CPU_PLACEHOLDER`
  },
  {
    id: "sw_mem_pct",
    label: "Switch memory %",
    kind: "network",
    unit: "%",
    deviceTypes: ["switch"],
    vendors: ["maipu"],
    query: `SW_MEM_PLACEHOLDER`
  },
  {
    id: "ap_cpu_pct",
    label: "AP CPU %",
    kind: "network",
    unit: "%",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_CPU_PLACEHOLDER`
  },
  {
    id: "ap_clients",
    label: "AP clients",
    kind: "network",
    unit: "count",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_CLIENTS_PLACEHOLDER`
  },
  {
    id: "ap_clients_omada",
    label: "AP clients (Omada)",
    kind: "network",
    unit: "count",
    deviceTypes: ["ap"],
    vendors: ["omada", "tplink", "tp-link"],
    query: `OMADA_CLIENTS_PLACEHOLDER`
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

/** Prefer ifHighSpeed (Mb → bps) when present; else ifSpeed (bps). */
export function buildIfCapacityQuery(siteId: string, deviceId: string): string {
  return `(sum(ifHighSpeed{site="${siteId}",device="${deviceId}"} * 1000000) > 0)
  or sum(ifSpeed{site="${siteId}",device="${deviceId}"} > 0)`;
}

function buildCapacityDenom(siteId: string, deviceId: string): string {
  return `clamp_min(
  ((sum(ifHighSpeed{site="${siteId}",device="${deviceId}"} * 1000000) > 0)
    or sum(ifSpeed{site="${siteId}",device="${deviceId}"} > 0)),
  1)`;
}

/** Device-summed interface utilization % (prefers ifHighSpeed for capacity). */
export function buildIfUtilQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string
): string {
  const octets = direction === "in" ? "ifHCInOctets" : "ifHCOutOctets";
  return `(
  sum(rate(${octets}{site="${siteId}",device="${deviceId}"}[5m]) * 8)
  /
  ${buildCapacityDenom(siteId, deviceId)}
) * 100`;
}

export function buildIfUtilMaxQuery(siteId: string, deviceId: string): string {
  const cap = buildCapacityDenom(siteId, deviceId);
  const inQ = `(sum(rate(ifHCInOctets{site="${siteId}",device="${deviceId}"}[5m]) * 8) / ${cap}) * 100`;
  const outQ = `(sum(rate(ifHCOutOctets{site="${siteId}",device="${deviceId}"}[5m]) * 8) / ${cap}) * 100`;
  return `max(
  label_replace(${inQ}, "side", "in", "", "")
  or
  label_replace(${outQ}, "side", "out", "", "")
)`;
}

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

/** HOST-RESOURCES: average processor load; memory = used/size for hrStorageType=.2 (RAM) when present. */
function buildSwitchCpuQuery(siteId: string, deviceId: string): string {
  return `avg(hrProcessorLoad{site="${siteId}",device="${deviceId}"})`;
}

function buildSwitchMemQuery(siteId: string, deviceId: string): string {
  // Prefer RAM storage type OID suffix when labeled; else best-effort used/size across storages.
  return `(
  sum(hrStorageUsed{site="${siteId}",device="${deviceId}",hrStorageType="1.3.6.1.2.1.25.2.1.2"})
  /
  clamp_min(sum(hrStorageSize{site="${siteId}",device="${deviceId}",hrStorageType="1.3.6.1.2.1.25.2.1.2"}), 1)
) * 100
or
(
  sum(hrStorageUsed{site="${siteId}",device="${deviceId}"})
  /
  clamp_min(sum(hrStorageSize{site="${siteId}",device="${deviceId}"}), 1)
) * 100`;
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
    case "if_util_in_pct":
      return buildIfUtilQuery("in", siteId, deviceId);
    case "if_util_out_pct":
      return buildIfUtilQuery("out", siteId, deviceId);
    case "if_util_max_pct":
      return buildIfUtilMaxQuery(siteId, deviceId);
    case "if_capacity_bps":
      return buildIfCapacityQuery(siteId, deviceId);
    case "if_up_count":
      return `count(ifOperStatus{site="${siteId}",device="${deviceId}"} == 1)`;
    case "if_down_count":
      return `count(ifOperStatus{site="${siteId}",device="${deviceId}"} == 2)`;
    case "if_errors_in_rate":
      return `sum(rate(ifInErrors{site="${siteId}",device="${deviceId}"}[5m]))`;
    case "if_errors_out_rate":
      return `sum(rate(ifOutErrors{site="${siteId}",device="${deviceId}"}[5m]))`;
    case "if_discards_in_rate":
      return `sum(rate(ifInDiscards{site="${siteId}",device="${deviceId}"}[5m]))`;
    case "if_discards_out_rate":
      return `sum(rate(ifOutDiscards{site="${siteId}",device="${deviceId}"}[5m]))`;
    case "fw_cpu_pct":
      return `fgSysCpuUsage{site="${siteId}",device="${deviceId}"}`;
    case "fw_mem_pct":
      return `fgSysMemUsage{site="${siteId}",device="${deviceId}"}`;
    case "fw_sessions":
      return `fgSysSesCount{site="${siteId}",device="${deviceId}"}`;
    case "sw_cpu_pct":
      return buildSwitchCpuQuery(siteId, deviceId);
    case "sw_mem_pct":
      return buildSwitchMemQuery(siteId, deviceId);
    case "ap_cpu_pct":
      return `avg(cambiumAPCPUUtilization{site="${siteId}",device="${deviceId}"})`;
    case "ap_clients":
      return `sum(cambiumAPTotalClients{site="${siteId}",device="${deviceId}"})`;
    case "ap_clients_omada":
      return `omadaClientCount{site="${siteId}",device="${deviceId}"}`;
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
    if (p.id === "if_util_in_pct" || p.id === "if_util_out_pct" || p.id === "if_util_max_pct") {
      return {
        ...p,
        query: `(sum(rate(ifHC*Octets[5m])*8) / capacity) * 100 — prefers ifHighSpeed`
      };
    }
    if (p.id === "if_capacity_bps") {
      return {
        ...p,
        query: `sum(ifHighSpeed*1e6) or sum(ifSpeed>0)`
      };
    }
    if (p.id === "fw_cpu_pct" || p.id === "fw_mem_pct" || p.id === "fw_sessions") {
      return {
        ...p,
        query: "FortiGate fgSys* (fortigate_health module)"
      };
    }
    if (p.id === "sw_cpu_pct" || p.id === "sw_mem_pct") {
      return {
        ...p,
        query: "HOST-RESOURCES hrProcessorLoad / hrStorage (maipu_health)"
      };
    }
    if (p.id === "ap_cpu_pct" || p.id === "ap_clients") {
      return {
        ...p,
        query: "Cambium cnPilot cambiumAP* (cambium_ap_health)"
      };
    }
    if (p.id === "ap_clients_omada") {
      return {
        ...p,
        query: "Omada/TP-Link EAP client count (verify OID on model/firmware)"
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
