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

const SECRET_ENV_KEYS = new Set(["CF_ACCESS_CLIENT_SECRET", "COLLECTOR_TOKEN"]);

const PROCESS_ENV_KEYS = Object.values(CONFIG_TO_ENV);

export function dataDir(): string {
  return process.env.DATA_DIR || "/data";
}

/** Persists across Dokploy redeploys (named volume). Falls back to dataDir. */
export function stateDir(): string {
  const s = process.env.STATE_DIR;
  if (s && fs.existsSync(s)) return s;
  if (s) {
    try {
      fs.mkdirSync(s, { recursive: true });
      return s;
    } catch {
      return dataDir();
    }
  }
  return dataDir();
}

function envPath(): string {
  return path.join(stateDir(), ".env");
}

function dataEnvPath(): string {
  return path.join(dataDir(), ".env");
}

function snmpPath(): string {
  return path.join(dataDir(), "snmp.yml");
}

export function devicesFilePath(): string {
  return path.join(stateDir(), "devices.json");
}

function parseEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

export function readEnvFile(): Record<string, string> {
  return parseEnvFile(envPath());
}

function readProcessEnvOverlay(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PROCESS_ENV_KEYS) {
    const v = process.env[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

function writeEnvMaps(map: Record<string, string>): void {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v === "" && SECRET_ENV_KEYS.has(k)) continue;
    cleaned[k] = v;
  }
  const text = Object.entries(cleaned)
    .map(([k, v]) => `${k}=${v}`)
    .concat("")
    .join("\n");
  fs.writeFileSync(envPath(), text, "utf8");
  // Also mirror into project .env for tools that expect it (optional)
  try {
    fs.writeFileSync(dataEnvPath(), text, "utf8");
  } catch {
    /* ignore if data dir read-only */
  }
}

/**
 * On boot: merge Dokploy process env + persisted /state/.env so Setup is pre-filled
 * and secrets survive redeploy without re-typing.
 */
export function bootstrapPersistentEnv(): { keys: string[]; source: string } {
  const fromState = parseEnvFile(envPath());
  const fromData = parseEnvFile(dataEnvPath());
  const fromProcess = readProcessEnvOverlay();

  // Priority: process (Dokploy Environment) > state volume > project .env
  const merged: Record<string, string> = {
    ...fromData,
    ...fromState,
    ...fromProcess
  };

  // Sync devices.json: prefer state, copy to data for generate-config.sh
  const stateDevices = path.join(stateDir(), "devices.json");
  const dataDevices = path.join(dataDir(), "devices.json");
  try {
    if (fs.existsSync(stateDevices)) {
      fs.copyFileSync(stateDevices, dataDevices);
    } else if (fs.existsSync(dataDevices)) {
      fs.copyFileSync(dataDevices, stateDevices);
    } else {
      fs.writeFileSync(stateDevices, "[]\n", "utf8");
      fs.writeFileSync(dataDevices, "[]\n", "utf8");
    }
  } catch {
    /* ignore */
  }

  writeEnvMaps(merged);
  return {
    keys: Object.keys(merged),
    source: Object.keys(fromProcess).length
      ? "dokploy-env+state"
      : Object.keys(fromState).length
        ? "state-volume"
        : "empty"
  };
}

export function readSnmpCommunity(): string {
  const file = snmpPath();
  if (!fs.existsSync(file)) return "public";
  const match = fs.readFileSync(file, "utf8").match(/^\s*community:\s*(.+)\s*$/m);
  return match?.[1]?.trim() || "public";
}

export function readConfig(): CollectorConfig {
  // Live merge so Dokploy Environment always wins without re-setup
  const env = { ...readEnvFile(), ...readProcessEnvOverlay() };
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
      config.siteName && config.nocApiUrl && config.collectorToken && config.centralRemoteWriteUrl
    )
  };
}

export function writeConfig(input: Partial<CollectorConfig>): CollectorConfig {
  const existing = { ...readEnvFile(), ...readProcessEnvOverlay() };
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
    if (!value) continue;
    next[envKey] = value;
  }

  for (const key of SECRET_ENV_KEYS) {
    if (next[key] === "") delete next[key];
  }
  if (!next.CF_ACCESS_CLIENT_SECRET && current.cfAccessClientSecret) {
    next.CF_ACCESS_CLIENT_SECRET = current.cfAccessClientSecret;
  }
  if (!next.COLLECTOR_TOKEN && current.collectorToken) {
    next.COLLECTOR_TOKEN = current.collectorToken;
  }

  writeEnvMaps(next);

  if (input.snmpCommunity !== undefined && input.snmpCommunity.trim()) {
    writeSnmpCommunity(input.snmpCommunity.trim());
  }

  return readConfig();
}

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
      content = content.replace(/(public_v2:\s*\n)/, `$1    community: ${community}\n`);
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
  const stateFile = devicesFilePath();
  const dataFile = path.join(dataDir(), "devices.json");
  const file = fs.existsSync(stateFile) ? stateFile : dataFile;
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Write devices to state volume AND data dir (generate-config.sh reads data dir). */
export function writeDevicesJson(jsonText: string): void {
  const stateFile = devicesFilePath();
  const dataFile = path.join(dataDir(), "devices.json");
  fs.writeFileSync(stateFile, jsonText, "utf8");
  try {
    fs.writeFileSync(dataFile, jsonText, "utf8");
  } catch {
    /* ignore */
  }
}

export function readConfigAlloy(): string {
  const file = path.join(dataDir(), "config.alloy");
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}
