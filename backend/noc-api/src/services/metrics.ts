import { promQuery, promQueryRange } from "./prometheus";
import { calendarTodayPromRange } from "./siteNetwork";
import {
  dualHostMetric,
  dualHostUpFresh,
  dualSnmpUpFresh,
  hostFreshGuard,
  METRIC_FRESH_WINDOW,
  probeSuccessFresh
} from "./promLabels";

export type MetricGroup = "health" | "traffic" | "ports" | "signal" | "storage";

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
  group?: MetricGroup;
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
    group: "health",
    unit: "%",
    query: `CPU_PLACEHOLDER`
  },
  {
    id: "mem_pct",
    label: "Memory free",
    kind: "server",
    group: "health",
    unit: "%",
    query: `MEM_PLACEHOLDER`
  },
  {
    id: "disk_pct",
    label: "Disk free",
    kind: "server",
    group: "health",
    unit: "%",
    query: `DISK_PLACEHOLDER`
  },
  {
    id: "host_up",
    label: "Collector online",
    kind: "server",
    group: "health",
    query: `UP_PLACEHOLDER`
  },
  {
    id: "snmp_up",
    label: "Device online",
    kind: "network",
    group: "health",
    query: `snmp_up{site="{{site}}",device="{{device}}"}`
  },
  {
    id: "if_in_bps",
    label: "Busiest port in",
    kind: "network",
    group: "traffic",
    unit: "bps",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_IN_PLACEHOLDER`
  },
  {
    id: "if_out_bps",
    label: "Busiest port out",
    kind: "network",
    group: "traffic",
    unit: "bps",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_OUT_PLACEHOLDER`
  },
  {
    id: "if_util_in_pct",
    label: "Utilization in",
    kind: "network",
    group: "traffic",
    unit: "%",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_UTIL_IN_PLACEHOLDER`
  },
  {
    id: "if_util_out_pct",
    label: "Utilization out",
    kind: "network",
    group: "traffic",
    unit: "%",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_UTIL_OUT_PLACEHOLDER`
  },
  {
    id: "if_util_max_pct",
    label: "Bandwidth (overall)",
    kind: "network",
    unit: "bps",
    query: `IF_UTIL_MAX_PLACEHOLDER`
  },
  {
    id: "if_capacity_bps",
    label: "Link capacity",
    kind: "network",
    group: "traffic",
    unit: "bps",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_CAPACITY_PLACEHOLDER`
  },
  {
    id: "if_up_count",
    label: "Ports up",
    kind: "network",
    group: "ports",
    unit: "count",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_UP_COUNT_PLACEHOLDER`
  },
  {
    id: "if_down_count",
    label: "Ports down",
    kind: "network",
    group: "ports",
    unit: "count",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_DOWN_COUNT_PLACEHOLDER`
  },
  {
    id: "if_errors_in_rate",
    label: "Errors in",
    kind: "network",
    group: "ports",
    unit: "count",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_ERR_IN_PLACEHOLDER`
  },
  {
    id: "if_errors_out_rate",
    label: "Errors out",
    kind: "network",
    group: "ports",
    unit: "count",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_ERR_OUT_PLACEHOLDER`
  },
  {
    id: "if_discards_in_rate",
    label: "Discards in",
    kind: "network",
    group: "ports",
    unit: "count",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_DISC_IN_PLACEHOLDER`
  },
  {
    id: "if_discards_out_rate",
    label: "Discards out",
    kind: "network",
    group: "ports",
    unit: "count",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_DISC_OUT_PLACEHOLDER`
  },
  {
    id: "fw_cpu_pct",
    label: "Firewall CPU",
    kind: "network",
    group: "health",
    unit: "%",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_CPU_PLACEHOLDER`
  },
  {
    id: "fw_mem_pct",
    label: "Firewall memory",
    kind: "network",
    group: "health",
    unit: "%",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_MEM_PLACEHOLDER`
  },
  {
    id: "fw_sessions",
    label: "Firewall sessions",
    kind: "network",
    group: "health",
    unit: "count",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_SES_PLACEHOLDER`
  },
  {
    id: "sw_cpu_pct",
    label: "Switch CPU",
    kind: "network",
    group: "health",
    unit: "%",
    deviceTypes: ["switch"],
    vendors: ["maipu"],
    query: `SW_CPU_PLACEHOLDER`
  },
  {
    id: "sw_mem_pct",
    label: "Switch memory",
    kind: "network",
    group: "health",
    unit: "%",
    deviceTypes: ["switch"],
    vendors: ["maipu"],
    query: `SW_MEM_PLACEHOLDER`
  },
  {
    id: "ap_cpu_pct",
    label: "AP CPU",
    kind: "network",
    group: "health",
    unit: "%",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_CPU_PLACEHOLDER`
  },
  {
    id: "ap_clients",
    label: "AP clients",
    kind: "network",
    group: "health",
    unit: "count",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_CLIENTS_PLACEHOLDER`
  },
  {
    id: "ap_clients_omada",
    label: "AP clients",
    kind: "network",
    group: "health",
    unit: "count",
    deviceTypes: ["ap"],
    vendors: ["omada", "tplink", "tp-link"],
    query: `OMADA_CLIENTS_PLACEHOLDER`
  },
  {
    id: "ap_snr_avg",
    label: "Average client SNR",
    kind: "network",
    group: "signal",
    unit: "dB",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_SNR_AVG_PLACEHOLDER`
  },
  {
    id: "ap_snr_min",
    label: "Lowest client SNR",
    kind: "network",
    group: "signal",
    unit: "dB",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_SNR_MIN_PLACEHOLDER`
  },
  {
    id: "ap_radio_in_bps",
    label: "Radio traffic in",
    kind: "network",
    group: "traffic",
    unit: "bps",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_RADIO_IN_PLACEHOLDER`
  },
  {
    id: "ap_radio_out_bps",
    label: "Radio traffic out",
    kind: "network",
    group: "traffic",
    unit: "bps",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_RADIO_OUT_PLACEHOLDER`
  },
  {
    id: "nas_cpu_pct",
    label: "NAS CPU",
    kind: "network",
    group: "health",
    unit: "%",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_CPU_PLACEHOLDER`
  },
  {
    id: "nas_mem_pct",
    label: "NAS memory %",
    kind: "network",
    group: "health",
    unit: "%",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_MEM_PLACEHOLDER`
  },
  {
    id: "nas_vol_free_pct",
    label: "Volume free",
    kind: "network",
    group: "storage",
    unit: "%",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_VOL_PLACEHOLDER`
  },
  {
    id: "nas_mem_used_gb",
    label: "Memory used",
    kind: "network",
    group: "health",
    unit: "GB",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_MEM_GB_PLACEHOLDER`
  },
  {
    id: "nas_vol_free_gb",
    label: "Volume free",
    kind: "network",
    group: "storage",
    unit: "GB",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_VOL_GB_PLACEHOLDER`
  },
  {
    id: "nas_temp_c",
    label: "NAS temperature",
    kind: "network",
    group: "health",
    unit: "C",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_TEMP_PLACEHOLDER`
  },
  {
    id: "nas_disk_temp_max_c",
    label: "NAS hottest disk",
    kind: "network",
    group: "health",
    unit: "C",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_DISK_TEMP_PLACEHOLDER`
  },
  {
    id: "nas_raid_ok",
    label: "NAS RAID",
    kind: "network",
    group: "health",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_RAID_PLACEHOLDER`
  },
  {
    id: "nas_disk_failed",
    label: "NAS disks failed",
    kind: "network",
    group: "health",
    unit: "count",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_DISK_FAIL_PLACEHOLDER`
  },
  {
    id: "if_sum_in_bps",
    label: "Total throughput in",
    kind: "network",
    group: "traffic",
    unit: "bps",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_SUM_IN_PLACEHOLDER`
  },
  {
    id: "if_sum_out_bps",
    label: "Total throughput out",
    kind: "network",
    group: "traffic",
    unit: "bps",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_SUM_OUT_PLACEHOLDER`
  },
  {
    id: "if_bytes_in_today",
    label: "Bytes in today",
    kind: "network",
    group: "traffic",
    unit: "bytes",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_BYTES_IN_TODAY_PLACEHOLDER`
  },
  {
    id: "if_bytes_out_today",
    label: "Bytes out today",
    kind: "network",
    group: "traffic",
    unit: "bytes",
    deviceTypes: ["firewall", "switch", "ap", "router", "nas"],
    query: `IF_BYTES_OUT_TODAY_PLACEHOLDER`
  },
  {
    id: "host_load1",
    label: "Load 1 minute",
    kind: "server",
    group: "health",
    unit: "count",
    query: `HOST_LOAD1_PLACEHOLDER`
  },
  {
    id: "host_load5",
    label: "Load 5 minutes",
    kind: "server",
    group: "health",
    unit: "count",
    query: `HOST_LOAD5_PLACEHOLDER`
  },
  {
    id: "host_load15",
    label: "Load 15 minutes",
    kind: "server",
    group: "health",
    unit: "count",
    query: `HOST_LOAD15_PLACEHOLDER`
  },
  {
    id: "host_mem_used_pct",
    label: "Memory used",
    kind: "server",
    group: "health",
    unit: "%",
    query: `HOST_MEM_USED_PCT_PLACEHOLDER`
  },
  {
    id: "host_mem_used_bytes",
    label: "Memory used",
    kind: "server",
    group: "health",
    unit: "bytes",
    query: `HOST_MEM_USED_BYTES_PLACEHOLDER`
  },
  {
    id: "host_swap_used_pct",
    label: "Swap used",
    kind: "server",
    group: "health",
    unit: "%",
    query: `HOST_SWAP_PLACEHOLDER`
  },
  {
    id: "host_disk_used_pct",
    label: "Disk used",
    kind: "server",
    group: "storage",
    unit: "%",
    query: `HOST_DISK_USED_PLACEHOLDER`
  },
  {
    id: "host_disk_free_bytes",
    label: "Disk free",
    kind: "server",
    group: "storage",
    unit: "bytes",
    query: `HOST_DISK_FREE_PLACEHOLDER`
  },
  {
    id: "host_net_in_bps",
    label: "Network in",
    kind: "server",
    group: "traffic",
    unit: "bps",
    query: `HOST_NET_IN_PLACEHOLDER`
  },
  {
    id: "host_net_out_bps",
    label: "Network out",
    kind: "server",
    group: "traffic",
    unit: "bps",
    query: `HOST_NET_OUT_PLACEHOLDER`
  },
  {
    id: "host_net_errors",
    label: "Network errors",
    kind: "server",
    group: "ports",
    unit: "count",
    query: `HOST_NET_ERR_PLACEHOLDER`
  },
  {
    id: "host_net_drops",
    label: "Network drops",
    kind: "server",
    group: "ports",
    unit: "count",
    query: `HOST_NET_DROP_PLACEHOLDER`
  },
  {
    id: "host_disk_read_bps",
    label: "Disk read",
    kind: "server",
    group: "storage",
    unit: "Bps",
    query: `HOST_DISK_READ_PLACEHOLDER`
  },
  {
    id: "host_disk_write_bps",
    label: "Disk write",
    kind: "server",
    group: "storage",
    unit: "Bps",
    query: `HOST_DISK_WRITE_PLACEHOLDER`
  },
  {
    id: "host_uptime_s",
    label: "Uptime",
    kind: "server",
    group: "health",
    unit: "s",
    query: `HOST_UPTIME_PLACEHOLDER`
  },
  {
    id: "host_open_files",
    label: "Open files",
    kind: "server",
    group: "health",
    unit: "count",
    query: `HOST_FD_PLACEHOLDER`
  },
  {
    id: "host_tcp_conns",
    label: "TCP connections",
    kind: "server",
    group: "health",
    unit: "count",
    query: `HOST_TCP_PLACEHOLDER`
  },
  {
    id: "fw_cpu_max_pct",
    label: "Hottest CPU core",
    kind: "network",
    group: "health",
    unit: "%",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_CPU_MAX_PLACEHOLDER`
  },
  {
    id: "fw_mem_bytes",
    label: "Memory size",
    kind: "network",
    group: "health",
    unit: "bytes",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_MEM_BYTES_PLACEHOLDER`
  },
  {
    id: "fw_lowmem_pct",
    label: "Low memory",
    kind: "network",
    group: "health",
    unit: "%",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_LOWMEM_PLACEHOLDER`
  },
  {
    id: "fw_disk_pct",
    label: "Disk used",
    kind: "network",
    group: "storage",
    unit: "%",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_DISK_PCT_PLACEHOLDER`
  },
  {
    id: "fw_disk_bytes",
    label: "Disk size",
    kind: "network",
    group: "storage",
    unit: "bytes",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_DISK_BYTES_PLACEHOLDER`
  },
  {
    id: "fw_session_rate",
    label: "Session rate",
    kind: "network",
    group: "health",
    unit: "count",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_SES_RATE_PLACEHOLDER`
  },
  {
    id: "fw_uptime_s",
    label: "Uptime",
    kind: "network",
    group: "health",
    unit: "s",
    deviceTypes: ["firewall"],
    vendors: ["fortinet", "fortigate"],
    query: `FW_UPTIME_PLACEHOLDER`
  },
  {
    id: "ap_weak_clients",
    label: "Weak clients",
    kind: "network",
    group: "signal",
    unit: "count",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_WEAK_PLACEHOLDER`
  },
  {
    id: "ap_busiest_client_bps",
    label: "Busiest client",
    kind: "network",
    group: "traffic",
    unit: "bps",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_BUSIEST_PLACEHOLDER`
  },
  {
    id: "ap_client_rx_today",
    label: "Client download today",
    kind: "network",
    group: "traffic",
    unit: "bytes",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_CLIENT_RX_TODAY_PLACEHOLDER`
  },
  {
    id: "ap_client_tx_today",
    label: "Client upload today",
    kind: "network",
    group: "traffic",
    unit: "bytes",
    deviceTypes: ["ap"],
    vendors: ["cambium"],
    query: `AP_CLIENT_TX_TODAY_PLACEHOLDER`
  },
  {
    id: "omada_cpu_pct",
    label: "CPU",
    kind: "network",
    group: "health",
    unit: "%",
    deviceTypes: ["ap"],
    vendors: ["omada", "tplink", "tp-link"],
    query: `OMADA_CPU_PLACEHOLDER`
  },
  {
    id: "omada_mem_pct",
    label: "Memory",
    kind: "network",
    group: "health",
    unit: "%",
    deviceTypes: ["ap"],
    vendors: ["omada", "tplink", "tp-link"],
    query: `OMADA_MEM_PLACEHOLDER`
  },
  {
    id: "omada_uptime_s",
    label: "Uptime",
    kind: "network",
    group: "health",
    unit: "s",
    deviceTypes: ["ap"],
    vendors: ["omada", "tplink", "tp-link"],
    query: `OMADA_UPTIME_PLACEHOLDER`
  },
  {
    id: "nas_vol_used_pct",
    label: "Volume used",
    kind: "network",
    group: "storage",
    unit: "%",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_VOL_USED_PCT_PLACEHOLDER`
  },
  {
    id: "nas_vol_used_gb",
    label: "Volume used",
    kind: "network",
    group: "storage",
    unit: "GB",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_VOL_USED_GB_PLACEHOLDER`
  },
  {
    id: "nas_system_status",
    label: "System status",
    kind: "network",
    group: "health",
    unit: "count",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_STATUS_PLACEHOLDER`
  },
  {
    id: "nas_disk_count",
    label: "Disk count",
    kind: "network",
    group: "storage",
    unit: "count",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_DISK_COUNT_PLACEHOLDER`
  },
  {
    id: "nas_raid_degraded",
    label: "Degraded volumes",
    kind: "network",
    group: "storage",
    unit: "count",
    deviceTypes: ["nas"],
    vendors: ["synology", "syno"],
    query: `NAS_RAID_DEG_PLACEHOLDER`
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

function octetRateExpr(direction: "in" | "out", siteId: string, deviceId: string): string {
  const hc = direction === "in" ? "ifHCInOctets" : "ifHCOutOctets";
  const plain = direction === "in" ? "ifInOctets" : "ifOutOctets";
  const sel = `site="${siteId}",device="${deviceId}"`;
  return `(rate(${hc}{${sel}}[5m]) or rate(${plain}{${sel}}[5m]))`;
}

/** Device-summed interface utilization % (prefers ifHighSpeed for capacity). */
export function buildIfUtilQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string
): string {
  return `(
  sum(${octetRateExpr(direction, siteId, deviceId)} * 8)
  /
  ${buildCapacityDenom(siteId, deviceId)}
) * 100`;
}

/** Busiest single interface, so VLANs are not added on top of the physical port. */
export function buildBusiestIfQuery(
  direction: "in" | "out",
  siteId: string,
  deviceId: string
): string {
  return `max(${octetRateExpr(direction, siteId, deviceId)} * 8)`;
}

function buildRadioQuery(direction: "in" | "out", siteId: string, deviceId: string): string {
  const metric = direction === "in" ? "cambiumClientRxDataBytes" : "cambiumClientTxDataBytes";
  return `sum(rate(${metric}{site="${siteId}",device="${deviceId}"}[5m]) * 8)`;
}

function buildNasMemUsedGbQuery(siteId: string, deviceId: string): string {
  const sel = nasSel(siteId, deviceId);
  // UCD mem*Real is kilobytes.
  return `(memTotalReal{${sel}} - memAvailReal{${sel}}) / 1048576`;
}

function buildNasVolFreeGbQuery(siteId: string, deviceId: string): string {
  return `sum(synoRaidFreeSize{${nasSel(siteId, deviceId)}}) / 1073741824`;
}

/** Peak of device-summed in/out bitrates (Mbps-scale chart), not % of capacity. */
export function buildIfUtilMaxQuery(siteId: string, deviceId: string): string {
  const inQ = `sum(${octetRateExpr("in", siteId, deviceId)} * 8)`;
  const outQ = `sum(${octetRateExpr("out", siteId, deviceId)} * 8)`;
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

function nasSel(siteId: string, deviceId: string): string {
  return `site="${siteId}",device="${deviceId}"`;
}

function buildNasCpuQuery(siteId: string, deviceId: string): string {
  return `avg(hrProcessorLoad{${nasSel(siteId, deviceId)}})`;
}

function buildNasMemQuery(siteId: string, deviceId: string): string {
  return `(
  (memTotalReal{${nasSel(siteId, deviceId)}} - memAvailReal{${nasSel(siteId, deviceId)}})
  /
  clamp_min(memTotalReal{${nasSel(siteId, deviceId)}}, 1)
) * 100`;
}

function buildNasVolFreeQuery(siteId: string, deviceId: string): string {
  const sel = nasSel(siteId, deviceId);
  // Prefer HOST-RESOURCES /volume* (filesystem free). RAID leftover space is often ~0
  // on a fully allocated pool, so it is only a fallback.
  const vol = `(
  (
    clamp_min(sum(hrStorageSize{${sel},hrStorageDescr=~"/volume.*"}), 1)
    -
    sum(hrStorageUsed{${sel},hrStorageDescr=~"/volume.*"})
  )
  /
  clamp_min(sum(hrStorageSize{${sel},hrStorageDescr=~"/volume.*"}), 1)
) * 100`;
  const raid = `(
  sum(synoRaidFreeSize{${sel}})
  /
  clamp_min(sum(synoRaidTotalSize{${sel}}), 1)
) * 100`;
  return `(${vol})\nor\n(${raid})`;
}

function buildNasRaidOkQuery(siteId: string, deviceId: string): string {
  // 1 when RAID series exist and none are degrade(11) or crashed(12); else empty (gauge = DOWN).
  return `(count(synoRaidStatus{${nasSel(siteId, deviceId)}}) > 0)
unless
(count(synoRaidStatus{${nasSel(siteId, deviceId)}} == 11 or synoRaidStatus{${nasSel(siteId, deviceId)}} == 12) > 0)`;
}

function buildSumIfQuery(direction: "in" | "out", siteId: string, deviceId: string): string {
  return `sum(${octetRateExpr(direction, siteId, deviceId)} * 8)`;
}

function buildIfBytesTodayQuery(direction: "in" | "out", siteId: string, deviceId: string): string {
  const hc = direction === "in" ? "ifHCInOctets" : "ifHCOutOctets";
  const plain = direction === "in" ? "ifInOctets" : "ifOutOctets";
  const sel = `site="${siteId}",device="${deviceId}"`;
  const range = calendarTodayPromRange();
  return `sum(max by (ifIndex) (increase(${hc}{${sel}}[${range}]) or increase(${plain}{${sel}}[${range}])))`;
}

function dualHostSumRate(metric: string, siteId: string, deviceId: string, extra = ""): string {
  const labels = extra ? `,${extra}` : "";
  const a = `sum(rate(${metric}{site="${siteId}",device="${deviceId}"${labels}}[5m]))`;
  const b = `sum(rate(${metric}{site="${siteId}",instance="${deviceId}"${labels}}[5m]))`;
  return `(${a} or ${b})`;
}

function hostGuarded(expr: string, siteId: string, deviceId: string): string {
  const guard = hostFreshGuard(siteId, deviceId, METRIC_FRESH_WINDOW);
  return `(${expr}) and on() (${guard})`;
}

function buildHostMemUsedPct(siteId: string, deviceId: string): string {
  const avail = dualHostMetric("node_memory_MemAvailable_bytes", siteId, deviceId);
  const total = dualHostMetric("node_memory_MemTotal_bytes", siteId, deviceId);
  return hostGuarded(`(1 - (${avail}) / (${total})) * 100`, siteId, deviceId);
}

function buildHostMemUsedBytes(siteId: string, deviceId: string): string {
  const avail = dualHostMetric("node_memory_MemAvailable_bytes", siteId, deviceId);
  const total = dualHostMetric("node_memory_MemTotal_bytes", siteId, deviceId);
  return hostGuarded(`(${total}) - (${avail})`, siteId, deviceId);
}

function buildHostSwapUsedPct(siteId: string, deviceId: string): string {
  const free = dualHostMetric("node_memory_SwapFree_bytes", siteId, deviceId);
  const total = dualHostMetric("node_memory_SwapTotal_bytes", siteId, deviceId);
  return hostGuarded(`((${total}) - (${free})) / clamp_min(${total}, 1) * 100`, siteId, deviceId);
}

function buildHostDiskUsedPct(siteId: string, deviceId: string): string {
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
  return hostGuarded(`((${size}) - (${avail})) / clamp_min(${size}, 1) * 100`, siteId, deviceId);
}

function buildHostDiskFreeBytes(siteId: string, deviceId: string): string {
  const avail = dualHostMetric(
    "node_filesystem_avail_bytes",
    siteId,
    deviceId,
    'mountpoint="/",fstype!="rootfs"'
  );
  return hostGuarded(avail, siteId, deviceId);
}

function buildHostNetBps(direction: "in" | "out", siteId: string, deviceId: string): string {
  const metric =
    direction === "in" ? "node_network_receive_bytes_total" : "node_network_transmit_bytes_total";
  return hostGuarded(`${dualHostSumRate(metric, siteId, deviceId, 'exported_device!="lo"')} * 8`, siteId, deviceId);
}

function buildHostNetProblem(kind: "errs" | "drop", siteId: string, deviceId: string): string {
  const rx = kind === "errs" ? "node_network_receive_errs_total" : "node_network_receive_drop_total";
  const tx = kind === "errs" ? "node_network_transmit_errs_total" : "node_network_transmit_drop_total";
  const extra = 'exported_device!="lo"';
  return hostGuarded(
    `${dualHostSumRate(rx, siteId, deviceId, extra)} + ${dualHostSumRate(tx, siteId, deviceId, extra)}`,
    siteId,
    deviceId
  );
}

function buildHostDiskIo(direction: "read" | "write", siteId: string, deviceId: string): string {
  const metric = direction === "read" ? "node_disk_read_bytes_total" : "node_disk_written_bytes_total";
  return hostGuarded(dualHostSumRate(metric, siteId, deviceId), siteId, deviceId);
}

function buildHostUptime(siteId: string, deviceId: string): string {
  return hostGuarded(`time() - ${dualHostMetric("node_boot_time_seconds", siteId, deviceId)}`, siteId, deviceId);
}

function snmpSel(siteId: string, deviceId: string): string {
  return `site="${siteId}",device="${deviceId}"`;
}

function buildBusiestClientBps(siteId: string, deviceId: string): string {
  const sel = snmpSel(siteId, deviceId);
  const rx = `sum by (clientIndex) (rate(cambiumClientRxDataBytes{${sel}}[5m]))`;
  const tx = `sum by (clientIndex) (rate(cambiumClientTxDataBytes{${sel}}[5m]))`;
  return `max((${rx} or ${tx} * 0) * 8 + (${tx} or ${rx} * 0) * 8)`;
}

function buildClientBytesToday(direction: "rx" | "tx", siteId: string, deviceId: string): string {
  const metric = direction === "rx" ? "cambiumClientRxDataBytes" : "cambiumClientTxDataBytes";
  const range = calendarTodayPromRange();
  return `sum(max by (clientIndex) (increase(${metric}{${snmpSel(siteId, deviceId)}}[${range}])))`;
}

function buildOmadaMemQuery(siteId: string, deviceId: string): string {
  const sel = snmpSel(siteId, deviceId);
  return `(
  sum(hrStorageUsed{${sel}})
  /
  clamp_min(sum(hrStorageSize{${sel}}), 1)
) * 100`;
}

function buildSnmpUptime(siteId: string, deviceId: string): string {
  return `sysUpTime{${snmpSel(siteId, deviceId)}} / 100`;
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
      return buildBusiestIfQuery("in", siteId, deviceId);
    case "if_out_bps":
      return buildBusiestIfQuery("out", siteId, deviceId);
    case "if_util_in_pct":
      return buildIfUtilQuery("in", siteId, deviceId);
    case "if_util_out_pct":
      return buildIfUtilQuery("out", siteId, deviceId);
    case "if_sum_in_bps":
      return buildSumIfQuery("in", siteId, deviceId);
    case "if_sum_out_bps":
      return buildSumIfQuery("out", siteId, deviceId);
    case "if_bytes_in_today":
      return buildIfBytesTodayQuery("in", siteId, deviceId);
    case "if_bytes_out_today":
      return buildIfBytesTodayQuery("out", siteId, deviceId);
    case "ap_snr_avg":
      return `avg(cambiumClientSNR{site="${siteId}",device="${deviceId}"})`;
    case "ap_snr_min":
      return `min(cambiumClientSNR{site="${siteId}",device="${deviceId}"})`;
    case "ap_radio_in_bps":
      return buildRadioQuery("in", siteId, deviceId);
    case "ap_radio_out_bps":
      return buildRadioQuery("out", siteId, deviceId);
    case "nas_mem_used_gb":
      return buildNasMemUsedGbQuery(siteId, deviceId);
    case "nas_vol_free_gb":
      return buildNasVolFreeGbQuery(siteId, deviceId);
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
    case "nas_cpu_pct":
      return buildNasCpuQuery(siteId, deviceId);
    case "nas_mem_pct":
      return buildNasMemQuery(siteId, deviceId);
    case "nas_vol_free_pct":
      return buildNasVolFreeQuery(siteId, deviceId);
    case "nas_temp_c":
      return `synoTemperature{site="${siteId}",device="${deviceId}"}`;
    case "nas_disk_temp_max_c":
      return `max(synoDiskTemperature{site="${siteId}",device="${deviceId}"})`;
    case "nas_raid_ok":
      return buildNasRaidOkQuery(siteId, deviceId);
    case "nas_disk_failed":
      return `count(synoDiskStatus{site="${siteId}",device="${deviceId}"} >= 4) or vector(0)`;
    case "host_load1":
      return hostGuarded(dualHostMetric("node_load1", siteId, deviceId), siteId, deviceId);
    case "host_load5":
      return hostGuarded(dualHostMetric("node_load5", siteId, deviceId), siteId, deviceId);
    case "host_load15":
      return hostGuarded(dualHostMetric("node_load15", siteId, deviceId), siteId, deviceId);
    case "host_mem_used_pct":
      return buildHostMemUsedPct(siteId, deviceId);
    case "host_mem_used_bytes":
      return buildHostMemUsedBytes(siteId, deviceId);
    case "host_swap_used_pct":
      return buildHostSwapUsedPct(siteId, deviceId);
    case "host_disk_used_pct":
      return buildHostDiskUsedPct(siteId, deviceId);
    case "host_disk_free_bytes":
      return buildHostDiskFreeBytes(siteId, deviceId);
    case "host_net_in_bps":
      return buildHostNetBps("in", siteId, deviceId);
    case "host_net_out_bps":
      return buildHostNetBps("out", siteId, deviceId);
    case "host_net_errors":
      return buildHostNetProblem("errs", siteId, deviceId);
    case "host_net_drops":
      return buildHostNetProblem("drop", siteId, deviceId);
    case "host_disk_read_bps":
      return buildHostDiskIo("read", siteId, deviceId);
    case "host_disk_write_bps":
      return buildHostDiskIo("write", siteId, deviceId);
    case "host_uptime_s":
      return buildHostUptime(siteId, deviceId);
    case "host_open_files":
      return hostGuarded(dualHostMetric("node_filefd_allocated", siteId, deviceId), siteId, deviceId);
    case "host_tcp_conns":
      return hostGuarded(dualHostMetric("node_netstat_Tcp_CurrEstab", siteId, deviceId), siteId, deviceId);
    case "fw_cpu_max_pct":
      return `max(fgProcessorUsage{${snmpSel(siteId, deviceId)}})`;
    case "fw_mem_bytes":
      return `fgSysMemCapacity{${snmpSel(siteId, deviceId)}} * 1024`;
    case "fw_lowmem_pct":
      return `fgSysLowMemUsage{${snmpSel(siteId, deviceId)}}`;
    case "fw_disk_pct":
      return `fgSysDiskUsage{${snmpSel(siteId, deviceId)}}`;
    case "fw_disk_bytes":
      return `fgSysDiskCapacity{${snmpSel(siteId, deviceId)}} * 1048576`;
    case "fw_session_rate":
      return `fgSysSesRate{${snmpSel(siteId, deviceId)}}`;
    case "fw_uptime_s":
      return buildSnmpUptime(siteId, deviceId);
    case "ap_weak_clients":
      return `count(cambiumClientSNR{${snmpSel(siteId, deviceId)}} < 20) or vector(0)`;
    case "ap_busiest_client_bps":
      return buildBusiestClientBps(siteId, deviceId);
    case "ap_client_rx_today":
      return buildClientBytesToday("rx", siteId, deviceId);
    case "ap_client_tx_today":
      return buildClientBytesToday("tx", siteId, deviceId);
    case "omada_cpu_pct":
      return buildSwitchCpuQuery(siteId, deviceId);
    case "omada_mem_pct":
      return buildOmadaMemQuery(siteId, deviceId);
    case "omada_uptime_s":
      return buildSnmpUptime(siteId, deviceId);
    case "nas_vol_used_pct":
      return `100 - (${buildNasVolFreeQuery(siteId, deviceId)})`;
    case "nas_vol_used_gb":
      return `(sum(synoRaidTotalSize{${snmpSel(siteId, deviceId)}}) - sum(synoRaidFreeSize{${snmpSel(siteId, deviceId)}})) / 1073741824`;
    case "nas_system_status":
      return `synoSystemStatus{${snmpSel(siteId, deviceId)}}`;
    case "nas_disk_count":
      return `count(synoDiskStatus{${snmpSel(siteId, deviceId)}}) or vector(0)`;
    case "nas_raid_degraded":
      return `count(synoRaidStatus{${snmpSel(siteId, deviceId)}} == 11 or synoRaidStatus{${snmpSel(siteId, deviceId)}} == 12) or vector(0)`;
    default:
      return preset.query.replace(/\{\{site\}\}/g, siteId).replace(/\{\{device\}\}/g, deviceId);
  }
}

const HIDDEN_FROM_PICKER = new Set(["if_util_max_pct", "wan_dns", "wan_vps"]);

/** Public preset list with illustrative query templates (for UI display). */
export function listPresetsForApi(): MetricPreset[] {
  return METRIC_PRESETS.filter((p) => !HIDDEN_FROM_PICKER.has(p.id)).map((p) => {
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
    if (p.id === "if_in_bps" || p.id === "if_out_bps") {
      return { ...p, query: "max(rate(ifHC*Octets[5m])*8)" };
    }
    if (p.id === "if_util_in_pct" || p.id === "if_util_out_pct") {
      return {
        ...p,
        query: `(sum(rate(ifHC*Octets[5m])*8) / capacity) * 100 — prefers ifHighSpeed`
      };
    }
    if (p.id === "if_util_max_pct") {
      return {
        ...p,
        query: `max(sum(rate(ifHCInOctets[5m])*8), sum(rate(ifHCOutOctets[5m])*8))`
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
    if (p.id === "ap_snr_avg" || p.id === "ap_snr_min") {
      return { ...p, query: "cambiumClientSNR" };
    }
    if (p.id === "ap_radio_in_bps" || p.id === "ap_radio_out_bps") {
      return { ...p, query: "sum(rate(cambiumClient*DataBytes[5m])*8)" };
    }
    if (p.id === "nas_mem_used_gb") {
      return { ...p, query: "(memTotalReal - memAvailReal) / 1048576" };
    }
    if (p.id === "nas_vol_free_gb") {
      return { ...p, query: "sum(synoRaidFreeSize) / 1073741824" };
    }
    if (
      p.id === "nas_cpu_pct" ||
      p.id === "nas_mem_pct" ||
      p.id === "nas_vol_free_pct" ||
      p.id === "nas_temp_c" ||
      p.id === "nas_disk_temp_max_c" ||
      p.id === "nas_raid_ok" ||
      p.id === "nas_disk_failed"
    ) {
      return {
        ...p,
        query: "Synology syno* / hrProcessorLoad / mem* (synology_health module)"
      };
    }
    return p;
  });
}

export async function queryInstant(query: string) {
  return promQuery(query);
}

function normDeviceType(type: string): string {
  const t = type.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (t === "ap" || t === "accesspoint" || t === "wifi" || t === "wireless") return "ap";
  if (t === "nas" || t === "storage") return "nas";
  return t;
}

function normVendor(vendor: string): string {
  return vendor.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The few numbers a health card shows for this device. Online is separate. */
export function healthCardPresetIds(device: {
  kind?: string;
  type?: string;
  vendor?: string;
}): string[] {
  if ((device.kind ?? "network") === "server") return ["cpu_pct", "mem_pct", "disk_pct"];
  const type = normDeviceType(device.type ?? "");
  const vendor = normVendor(device.vendor ?? "");
  if (type === "firewall" || vendor.includes("fortinet") || vendor.includes("fortigate")) {
    return ["fw_cpu_pct", "fw_sessions", "if_in_bps"];
  }
  if (type === "switch" || vendor.includes("maipu")) return ["if_up_count", "if_in_bps"];
  if (type === "nas" || vendor.includes("synology") || vendor.includes("syno")) {
    return ["nas_vol_free_gb", "nas_temp_c", "nas_raid_ok"];
  }
  if (vendor.includes("omada") || vendor.includes("tplink")) return ["ap_clients_omada", "if_in_bps"];
  if (type === "ap" || vendor.includes("cambium")) return ["ap_clients", "ap_snr_avg", "ap_radio_in_bps"];
  return ["snmp_up"];
}

export function onlinePresetId(device: { kind?: string }): string {
  return (device.kind ?? "network") === "server" ? "host_up" : "snmp_up";
}

export async function queryRange(query: string, hours = 1, step = "60s") {
  const end = Math.floor(Date.now() / 1000);
  const start = end - hours * 3600;
  return promQueryRange(query, start, end, step);
}
