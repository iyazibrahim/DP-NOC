import { promQuery, promQueryRange } from "./prometheus";
import { dualHostMetric, dualHostUp } from "./promLabels";

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
    label: "Local device online",
    kind: "network",
    query: `snmp_up{site="{{site}}",device="{{device}}"}`
  },
  {
    id: "wan_dns",
    label: "Uplink (DNS)",
    kind: "any",
    query: `probe_success{site="{{site}}",check="wan_dns"}`
  },
  {
    id: "wan_vps",
    label: "Uplink (central)",
    kind: "any",
    query: `probe_success{site="{{site}}",check="wan_vps"}`
  }
];

function buildCpuQuery(siteId: string, deviceId: string): string {
  const idleDevice = `rate(node_cpu_seconds_total{mode="idle",site="${siteId}",device="${deviceId}"}[5m])`;
  const idleInstance = `rate(node_cpu_seconds_total{mode="idle",site="${siteId}",instance="${deviceId}"}[5m])`;
  return `100 - (avg( (${idleDevice}) or (${idleInstance}) ) * 100)`;
}

function buildMemQuery(siteId: string, deviceId: string): string {
  const avail = dualHostMetric("node_memory_MemAvailable_bytes", siteId, deviceId);
  const total = dualHostMetric("node_memory_MemTotal_bytes", siteId, deviceId);
  return `(${avail} / ${total}) * 100`;
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
  return `(${avail} / ${size}) * 100`;
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
      return dualHostUp(siteId, deviceId);
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
        query:
          '100 - (avg(rate(node_cpu_seconds_total{mode="idle",site,device|instance}[5m])) * 100)'
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
        query: 'up{job=~"site_host|integrations/unix",site,device|instance}'
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
