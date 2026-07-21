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
        config.centralRemoteWriteUrl &&
        config.cfAccessClientId &&
        config.cfAccessClientSecret
    )
  };
}

export function writeConfig(input: Partial<CollectorConfig>): CollectorConfig {
  const current = readConfig();
  const merged: CollectorConfig = {
    ...current,
    ...input,
    hostDeviceId:
      input.hostDeviceId ||
      (input.siteName ? `${input.siteName}-nuc` : current.hostDeviceId)
  };

  const lines = [
    `CENTRAL_REMOTE_WRITE_URL=${merged.centralRemoteWriteUrl}`,
    `CF_ACCESS_CLIENT_ID=${merged.cfAccessClientId}`,
    `CF_ACCESS_CLIENT_SECRET=${merged.cfAccessClientSecret}`,
    `SITE_NAME=${merged.siteName}`,
    `HOST_DEVICE_ID=${merged.hostDeviceId}`,
    `PING_TARGET_1=${merged.pingTarget1}`,
    `PING_TARGET_2=${merged.pingTarget2}`,
    `NOC_API_URL=${merged.nocApiUrl.replace(/\/$/, "")}`,
    `COLLECTOR_TOKEN=${merged.collectorToken}`,
    `SCRAPE_INTERVAL_SEC=${merged.scrapeIntervalSec}`,
    `SYNC_INTERVAL_SEC=${merged.syncIntervalSec}`,
    ""
  ];
  fs.writeFileSync(envPath(), lines.join("\n"), "utf8");

  if (input.snmpCommunity !== undefined) {
    writeSnmpCommunity(input.snmpCommunity);
  }

  return readConfig();
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
