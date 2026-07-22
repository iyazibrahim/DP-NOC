import fs from "fs";
import path from "path";

export type CollectorConfig = {
  centralRemoteWriteUrl: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  siteName: string;
  hostDeviceId: string;
  pingTarget1: string;
  pingTarget2: string;
  nocApiUrl: string;
  collectorToken: string;
  scrapeIntervalSec: string;
  syncIntervalSec: string;
  snmpCommunity: string;
};

const CONFIG_TO_ENV: Record<keyof Omit<CollectorConfig, "snmpCommunity">, string> = {
  centralRemoteWriteUrl: "CENTRAL_REMOTE_WRITE_URL",
  cfAccessClientId: "CF_ACCESS_CLIENT_ID",
  cfAccessClientSecret: "CF_ACCESS_CLIENT_SECRET",
  siteName: "SITE_NAME",
  hostDeviceId: "HOST_DEVICE_ID",
  pingTarget1: "PING_TARGET_1",
  pingTarget2: "PING_TARGET_2",
  nocApiUrl: "NOC_API_URL",
  collectorToken: "COLLECTOR_TOKEN",
  scrapeIntervalSec: "SCRAPE_INTERVAL_SEC",
  syncIntervalSec: "SYNC_INTERVAL_SEC"
};

/** Keys that Alloy needs for remote_write — never blank these out. */
const SECRET_ENV_KEYS = new Set(["CF_ACCESS_CLIENT_SECRET", "COLLECTOR_TOKEN"]);

export function dataDir(): string {
  return process.env.DATA_DIR || "/data";
}

function envPath(): string {
  return path.join(dataDir(), ".env");
}

function snmpPath(): string {
  return path.join(dataDir(), "snmp.yml");
}

export function readEnvFile(): Record<string, string> {
  const file = envPath();
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

export function readSnmpCommunity(): string {
  const file = snmpPath();
  if (!fs.existsSync(file)) return "public";
  const match = fs.readFileSync(file, "utf8").match(/^\s*community:\s*(.+)\s*$/m);
  return match?.[1]?.trim() || "public";
}

export function readConfig(): CollectorConfig {
  const env = readEnvFile();
  const siteName = env.SITE_NAME || "";
  return {
    centralRemoteWriteUrl: env.CENTRAL_REMOTE_WRITE_URL || "",
    cfAccessClientId: env.CF_ACCESS_CLIENT_ID || "",
    cfAccessClientSecret: env.CF_ACCESS_CLIENT_SECRET || "",
    siteName,
    hostDeviceId: env.HOST_DEVICE_ID || (siteName ? `${siteName}-nuc` : ""),
    pingTarget1: env.PING_TARGET_1 || "1.1.1.1",
    pingTarget2: env.PING_TARGET_2 || "139.99.88.174",
    nocApiUrl: env.NOC_API_URL || "",
    collectorToken: env.COLLECTOR_TOKEN || "",
    scrapeIntervalSec: env.SCRAPE_INTERVAL_SEC || "15",
    syncIntervalSec: env.SYNC_INTERVAL_SEC || "90",
    snmpCommunity: readSnmpCommunity()
  };
}

export function maskConfig(config: CollectorConfig): CollectorConfig & { configured: boolean } {
  const mask = (v: string) => (v ? `${v.slice(0, 8)}…` : "");
  return {
    ...config,
    cfAccessClientSecret: config.cfAccessClientSecret ? "***" : "",
    collectorToken: config.collectorToken ? mask(config.collectorToken) : "",
    configured: Boolean(
      config.siteName &&
        config.nocApiUrl &&
        config.collectorToken &&
        config.centralRemoteWriteUrl
    ),
    // CF secrets may live only in Dokploy env — not required for "configured" if remote write URL set
  };
}

/**
 * Merge updates into existing .env without wiping Dokploy / unknown keys.
 * Never writes empty values for secrets (would override Dokploy-injected env on recreate).
 */
export function writeConfig(input: Partial<CollectorConfig>): CollectorConfig {
  const existing = readEnvFile();
  const current = readConfig();

  if (input.hostDeviceId === undefined && input.siteName) {
    input = { ...input, hostDeviceId: `${input.siteName}-nuc` };
  }

  const next: Record<string, string> = { ...existing };

  for (const [field, envKey] of Object.entries(CONFIG_TO_ENV) as Array<
    [keyof Omit<CollectorConfig, "snmpCommunity">, string]
  >) {
    const raw = input[field];
    if (typeof raw !== "string") continue;
    const value = field === "nocApiUrl" ? raw.trim().replace(/\/$/, "") : raw.trim();
    if (!value) {
      // Do not blank secrets or wipe keys that Alloy already needs
      if (SECRET_ENV_KEYS.has(envKey)) continue;
      continue;
    }
    next[envKey] = value;
  }

  // Ensure we never persist empty secret keys that would clobber Dokploy env
  for (const key of SECRET_ENV_KEYS) {
    if (next[key] === "") delete next[key];
  }

  // Preserve known secrets from current if somehow cleared
  if (!next.CF_ACCESS_CLIENT_SECRET && current.cfAccessClientSecret) {
    next.CF_ACCESS_CLIENT_SECRET = current.cfAccessClientSecret;
  }
  if (!next.COLLECTOR_TOKEN && current.collectorToken) {
    next.COLLECTOR_TOKEN = current.collectorToken;
  }

  const lines = Object.entries(next).map(([k, v]) => `${k}=${v}`);
  lines.push("");
  fs.writeFileSync(envPath(), lines.join("\n"), "utf8");

  if (input.snmpCommunity !== undefined && input.snmpCommunity.trim()) {
    writeSnmpCommunity(input.snmpCommunity.trim());
  }

  return readConfig();
}

/** Fields that require regenerating config.alloy / reloading Alloy. */
export function alloyReloadNeeded(
  before: CollectorConfig,
  after: CollectorConfig,
  patch: Partial<CollectorConfig>
): boolean {
  const keys: (keyof CollectorConfig)[] = [
    "centralRemoteWriteUrl",
    "cfAccessClientId",
    "cfAccessClientSecret",
    "siteName",
    "hostDeviceId",
    "pingTarget1",
    "pingTarget2",
    "scrapeIntervalSec",
    "snmpCommunity"
  ];
  return keys.some((k) => patch[k] !== undefined && before[k] !== after[k]);
}

export function writeSnmpCommunity(community: string): void {
  const file = snmpPath();
  let content: string;
  if (fs.existsSync(file)) {
    content = fs.readFileSync(file, "utf8");
    if (/^\s*community:/m.test(content)) {
      content = content.replace(/^\s*community:.*$/m, `    community: ${community}`);
    } else {
      content = content.replace(
        /(public_v2:\s*\n)/,
        `$1    community: ${community}\n`
      );
    }
  } else {
    content = `auths:
  public_v2:
    community: ${community}
    security_level: noAuthNoPriv
    version: 2

modules:
  if_mib:
    walk:
      - 1.3.6.1.2.1.2.2.1.2
      - 1.3.6.1.2.1.2.2.1.8
      - 1.3.6.1.2.1.2.2.1.5
      - 1.3.6.1.2.1.31.1.1.1.6
      - 1.3.6.1.2.1.31.1.1.1.10
`;
  }
  fs.writeFileSync(file, content, "utf8");
}

export function readDevicesJson(): unknown[] {
  const file = path.join(dataDir(), "devices.json");
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readConfigAlloy(): string {
  const file = path.join(dataDir(), "config.alloy");
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}
