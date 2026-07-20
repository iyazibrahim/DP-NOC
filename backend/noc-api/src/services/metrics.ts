import { promQuery, promQueryRange } from "./prometheus";

export type MetricPreset = {
  id: string;
  label: string;
  kind: "server" | "network" | "any";
  query: string;
  unit?: string;
};

export const METRIC_PRESETS: MetricPreset[] = [
  {
    id: "cpu_pct",
    label: "CPU usage %",
    kind: "server",
    unit: "%",
    query: `100 - (avg by (device) (rate(node_cpu_seconds_total{mode="idle",site="{{site}}",device="{{device}}"}[5m])) * 100)`
  },
  {
    id: "mem_pct",
    label: "Memory available %",
    kind: "server",
    unit: "%",
    query: `(node_memory_MemAvailable_bytes{site="{{site}}",device="{{device}}"} / node_memory_MemTotal_bytes{site="{{site}}",device="{{device}}"}) * 100`
  },
  {
    id: "disk_pct",
    label: "Root disk free %",
    kind: "server",
    unit: "%",
    query: `(node_filesystem_avail_bytes{site="{{site}}",device="{{device}}",mountpoint="/",fstype!="rootfs"} / node_filesystem_size_bytes{site="{{site}}",device="{{device}}",mountpoint="/",fstype!="rootfs"}) * 100`
  },
  {
    id: "host_up",
    label: "Host up",
    kind: "server",
    query: `up{job="site_host",site="{{site}}",device="{{device}}"}`
  },
  {
    id: "snmp_up",
    label: "SNMP up",
    kind: "network",
    query: `snmp_up{site="{{site}}",device="{{device}}"}`
  },
  {
    id: "wan_dns",
    label: "WAN DNS probe",
    kind: "any",
    query: `probe_success{site="{{site}}",check="wan_dns"}`
  }
];

export function buildQuery(presetId: string, siteId: string, deviceId: string): string | null {
  const preset = METRIC_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  return preset.query.replace(/\{\{site\}\}/g, siteId).replace(/\{\{device\}\}/g, deviceId);
}

export async function queryInstant(query: string) {
  return promQuery(query);
}

export async function queryRange(query: string, hours = 1, step = "60s") {
  const end = Math.floor(Date.now() / 1000);
  const start = end - hours * 3600;
  return promQueryRange(query, start, end, step);
}
