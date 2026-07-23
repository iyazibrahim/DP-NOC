import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { env } from "../env";
import { promQuery, promTsdbStatus } from "./prometheus";

const execAsync = promisify(exec);

export type RetentionConfig = {
  retentionTime: string;
  retentionSizeGB: number;
  hostScrapeIntervalSec: number;
  icmpScrapeIntervalSec: number;
  snmpScrapeIntervalSec: number;
  scheduledExportsEnabled: boolean;
};

const DEFAULT: RetentionConfig = {
  retentionTime: "30d",
  retentionSizeGB: 10,
  hostScrapeIntervalSec: 60,
  icmpScrapeIntervalSec: 60,
  snmpScrapeIntervalSec: 60,
  scheduledExportsEnabled: true
};

function retentionPath(): string {
  const candidates = [
    path.join(process.cwd(), "data/runtime/retention.json"),
    path.join(__dirname, "../../data/runtime/retention.json"),
    "/app/data/runtime/retention.json"
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  const preferred = path.join(process.cwd(), "data/runtime/retention.json");
  const dir = path.dirname(preferred);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return preferred;
}

function flagsPath(): string {
  const dir = path.dirname(retentionPath());
  return path.join(dir, "prometheus-retention.flags");
}

export function loadRetentionConfig(): RetentionConfig {
  const file = retentionPath();
  if (!fs.existsSync(file)) {
    saveRetentionConfig(DEFAULT);
    return { ...DEFAULT };
  }
  return { ...DEFAULT, ...JSON.parse(fs.readFileSync(file, "utf8")) };
}

export function saveRetentionConfig(config: RetentionConfig): RetentionConfig {
  const file = retentionPath();
  const merged = { ...DEFAULT, ...config };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n", "utf8");
  writePrometheusFlags(merged);
  return merged;
}

export function writePrometheusFlags(config: RetentionConfig) {
  const lines = [
    `--storage.tsdb.retention.time=${config.retentionTime}`,
    `--storage.tsdb.retention.size=${config.retentionSizeGB}GB`,
    "--storage.tsdb.wal-compression"
  ];
  fs.writeFileSync(flagsPath(), lines.join("\n") + "\n", "utf8");
}

export async function getStorageStats() {
  const config = loadRetentionConfig();
  let tsdb: unknown = null;
  let storageBytes: number | null = null;
  try {
    tsdb = await promTsdbStatus();
  } catch {
    /* optional */
  }
  try {
    const data = await promQuery("prometheus_tsdb_storage_blocks_bytes");
    if (data.resultType === "vector" && Array.isArray(data.result) && data.result[0]) {
      storageBytes = Number((data.result[0] as { value: [number, string] }).value[1]);
    }
  } catch {
    /* optional metric name varies by version */
  }
  return {
    config,
    tsdb,
    storageBytes,
    flagsFile: flagsPath()
  };
}

export async function applyRetentionToPrometheus(): Promise<{ ok: boolean; message: string }> {
  const config = loadRetentionConfig();
  writePrometheusFlags(config);
  const cmd = env.PROMETHEUS_APPLY_CMD?.trim();
  if (!cmd) {
    return {
      ok: false,
      message:
        "Retention saved. Set PROMETHEUS_APPLY_CMD (e.g. docker restart noc_prometheus) and restart Prometheus, or use Dokploy to restart the prometheus service."
    };
  }
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120_000 });
    return {
      ok: true,
      message: `Prometheus apply command completed. ${stdout || stderr || ""}`.trim()
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Apply command failed"
    };
  }
}

export async function enforceStorageCap() {
  const config = loadRetentionConfig();
  const stats = await getStorageStats();
  if (stats.storageBytes == null) return;
  const capBytes = config.retentionSizeGB * 1024 * 1024 * 1024;
  if (stats.storageBytes > capBytes * 0.95) {
    // eslint-disable-next-line no-console
    console.warn(
      `[retention] TSDB size ${stats.storageBytes} approaching cap ${capBytes}. Consider lowering retention or restarting Prometheus with smaller limits.`
    );
  }
}
