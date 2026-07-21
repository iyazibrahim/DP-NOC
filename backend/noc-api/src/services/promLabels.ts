/**
 * Shared Prometheus label helpers.
 *
 * Live collectors may use either:
 * - NOC template: job=site_host, device=<HOST_DEVICE_ID>
 * - Legacy Alloy integrations: job=integrations/unix, instance=<hostname>
 */

export const HOST_UP_JOB_SELECTOR = 'job=~"site_host|integrations/unix"';

/**
 * Shared freshness for status + gauges (30–60s detection).
 * Requires ICMP scrape ≤30s (template uses 15s). A 60s ICMP default will false-down.
 */
export const METRIC_FRESH_WINDOW = "45s";
export const METRIC_HISTORY_WINDOW = "30m";

/** Dual-selector: device label OR instance label (legacy integrations Alloy). */
export function dualHostMetric(
  metric: string,
  siteId: string,
  deviceId: string,
  extraLabels = ""
): string {
  const extra = extraLabels ? `,${extraLabels}` : "";
  const a = `${metric}{site="${siteId}",device="${deviceId}"${extra}}`;
  const b = `${metric}{site="${siteId}",instance="${deviceId}"${extra}}`;
  return `(${a} or ${b})`;
}

export function dualHostUp(siteId: string, deviceId: string): string {
  const a = `up{${HOST_UP_JOB_SELECTOR},site="${siteId}",device="${deviceId}"}`;
  const b = `up{${HOST_UP_JOB_SELECTOR},site="${siteId}",instance="${deviceId}"}`;
  return `(${a} or ${b})`;
}

/** last_over_time cannot wrap `(a or b)` cleanly — expand both sides. */
export function dualHostUpFresh(siteId: string, deviceId: string, window = METRIC_FRESH_WINDOW): string {
  const a = `last_over_time(up{${HOST_UP_JOB_SELECTOR},site="${siteId}",device="${deviceId}"}[${window}])`;
  const b = `last_over_time(up{${HOST_UP_JOB_SELECTOR},site="${siteId}",instance="${deviceId}"}[${window}])`;
  return `(${a} or ${b})`;
}

export function dualHostMemFresh(siteId: string, deviceId: string, window = METRIC_FRESH_WINDOW): string {
  const a = `last_over_time(node_memory_MemAvailable_bytes{site="${siteId}",device="${deviceId}"}[${window}])`;
  const b = `last_over_time(node_memory_MemAvailable_bytes{site="${siteId}",instance="${deviceId}"}[${window}])`;
  return `(${a} or ${b})`;
}

/** Fresh probe_success for uplink gauges (silence → empty vector). */
export function probeSuccessFresh(siteId: string, check: string, window = METRIC_FRESH_WINDOW): string {
  return `last_over_time(probe_success{site="${siteId}",check="${check}"}[${window}])`;
}

/** Host still reporting recently — used to suppress CPU end-of-series spikes. */
export function hostFreshGuard(siteId: string, deviceId: string, window = METRIC_FRESH_WINDOW): string {
  return `(${dualHostMemFresh(siteId, deviceId, window)} or ${dualHostUpFresh(siteId, deviceId, window)})`;
}

export function resolveCollectorId(metric: Record<string, string>): string {
  const device = (metric.device ?? "").trim();
  if (device) return device;
  return (metric.instance ?? "").trim();
}
