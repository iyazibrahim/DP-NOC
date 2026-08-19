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

const PROCESS_ENV_KEYS = [...Object.values(CONFIG_TO_ENV), "SNMP_DEFAULT_COMMUNITY"];

const BUNDLED_TOOLKIT = process.env.SITEBOX_TOOLKIT_DIR || "/opt/sitebox";

export function bundledToolkitDir(): string {
  return BUNDLED_TOOLKIT;
}

let resolvedDataDir: string | null = null;

/**
 * Host bind for site-box files. Dokploy often mounts the monorepo root at /data
 * (wrong) — detect sites/templates/site-box and use that instead.
 */
export function dataDir(): string {
  if (resolvedDataDir) return resolvedDataDir;
  const raw = process.env.DATA_DIR || "/data";
  const nested = path.join(raw, "sites", "templates", "site-box");
  if (
    fs.existsSync(path.join(nested, "generate-config.sh")) ||
    fs.existsSync(path.join(nested, "docker-compose.yml")) ||
    fs.existsSync(path.join(nested, "snmp.yml"))
  ) {
    resolvedDataDir = nested;
    return resolvedDataDir;
  }
  resolvedDataDir = raw;
  return resolvedDataDir;
}

/**
 * Fail fast when /data is a stale Dokploy code/ bind (empty deleted inode) or read-only.
 * Named volume noc_sitebox_data must be writable.
 */
export function assertDataDirWritable(): void {
  const dir = dataDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new Error(
      `DATA_DIR ${dir} missing and cannot be created: ${err instanceof Error ? err.message : String(err)}. ` +
        "Use docker-compose.site-box.yml with volume noc_sitebox_data:/data."
    );
  }
  if (fs.existsSync(path.join(dir, "config.alloy")) && fs.statSync(path.join(dir, "config.alloy")).isDirectory()) {
    throw new Error(
      `${path.join(dir, "config.alloy")} is a directory (Docker file-mount trap). ` +
        "Remove it from the volume, then Force apply SNMP."
    );
  }
  const probe = path.join(dir, ".write_probe");
  try {
    fs.writeFileSync(probe, "ok", "utf8");
    fs.unlinkSync(probe);
  } catch (err) {
    throw new Error(
      `DATA_DIR ${dir} is not writable (${err instanceof Error ? err.message : String(err)}). ` +
        "Stale Dokploy code/ bind mounts break after redeploy — use named volume noc_sitebox_data:/data in docker-compose.site-box.yml, rebuild, and recreate containers."
    );
  }
}

/** True when Alloy can load from the shared data volume. */
export function alloyConfigReady(): boolean {
  const dir = dataDir();
  const required = ["config.alloy", "blackbox.yml", "snmp.yml"] as const;
  return required.every((name) => {
    const p = path.join(dir, name);
    return fs.existsSync(p) && fs.statSync(p).isFile();
  });
}

/** Copy generate-config.sh (+ friends) from image into work dir if missing / stale. */
export function ensureBundledToolkit(): string {
  const dir = dataDir();
  assertDataDirWritable();

  const scripts = ["generate-config.sh", "validate-config.sh"] as const;
  const seeds = ["blackbox.yml", "snmp.yml"] as const;

  for (const name of scripts) {
    const src = path.join(BUNDLED_TOOLKIT, name);
    const dest = path.join(dir, name);
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
    } catch (err) {
      console.warn(`[toolkit] copy ${name} failed:`, err instanceof Error ? err.message : err);
    }
  }

  for (const name of seeds) {
    const src = path.join(BUNDLED_TOOLKIT, name);
    const dest = path.join(dir, name);
    if (!fs.existsSync(src)) continue;
    // Always refresh seeds from image when dest missing; keep existing snmp communities
    if (fs.existsSync(dest)) continue;
    try {
      fs.copyFileSync(src, dest);
    } catch (err) {
      console.warn(`[toolkit] seed ${name} failed:`, err instanceof Error ? err.message : err);
    }
  }

  return dir;
}

export function toolkitScript(name: string): string | null {
  const dir = ensureBundledToolkit();
  const inData = path.join(dir, name);
  if (fs.existsSync(inData)) return inData;
  const bundled = path.join(BUNDLED_TOOLKIT, name);
  if (fs.existsSync(bundled)) return bundled;
  return null;
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

type ConfigAuthority = {
  setupSavedAt?: number;
  lastProcessFingerprint?: string;
};

function authorityPath(): string {
  return path.join(stateDir(), "config-authority.json");
}

function readAuthority(): ConfigAuthority {
  const file = authorityPath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ConfigAuthority;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAuthority(next: ConfigAuthority): void {
  fs.writeFileSync(authorityPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

/** Stable hash of Environment/compose-injected overlay (boot values only). */
export function processEnvFingerprint(overlay: Record<string, string>): string {
  const keys = Object.keys(overlay).sort();
  return keys.map((k) => `${k}=${overlay[k]}`).join("\n");
}

function applyEnvToProcess(map: Record<string, string>): void {
  for (const key of PROCESS_ENV_KEYS) {
    if (map[key] !== undefined && map[key] !== "") {
      process.env[key] = map[key];
    }
  }
}

/**
 * Most recent wins:
 * - Setup Save stamps setupSavedAt → file wins at runtime until next boot.
 * - At boot, if Environment/compose fingerprint changed → process wins.
 * - At boot, same fingerprint + setupSavedAt → Setup file still wins (Pi restart).
 */
export function resolveConfigAuthority(
  fromProcess: Record<string, string>,
  authority: ConfigAuthority = readAuthority(),
  opts?: { atBoot?: boolean }
): "setup" | "process" {
  if (opts?.atBoot) {
    const fp = processEnvFingerprint(fromProcess);
    if (
      authority.lastProcessFingerprint &&
      authority.lastProcessFingerprint !== fp
    ) {
      return "process";
    }
  }
  if (authority.setupSavedAt) return "setup";
  return "process";
}

/**
 * On boot: merge Environment/compose process env + persisted /state/.env.
 * Most recent authority wins (Setup Save vs Environment redeploy).
 */
export function bootstrapPersistentEnv(): { keys: string[]; source: string } {
  const fromState = parseEnvFile(envPath());
  const fromData = parseEnvFile(dataEnvPath());
  const fromProcess = readProcessEnvOverlay();
  const authority = readAuthority();
  const fp = processEnvFingerprint(fromProcess);
  const mode = resolveConfigAuthority(fromProcess, authority, { atBoot: true });

  // Base layers then authority winner on top
  const merged: Record<string, string> =
    mode === "setup"
      ? { ...fromData, ...fromProcess, ...fromState }
      : { ...fromData, ...fromState, ...fromProcess };

  writeAuthority({
    setupSavedAt: mode === "setup" ? authority.setupSavedAt : undefined,
    lastProcessFingerprint: fp
  });

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
  applyEnvToProcess(merged);
  return {
    keys: Object.keys(merged),
    source:
      mode === "setup"
        ? "setup-ui+state"
        : Object.keys(fromProcess).length
          ? "process-env+state"
          : Object.keys(fromState).length
            ? "state-volume"
            : "empty"
  };
}

export function readSnmpCommunity(): string {
  const fromEnv =
    process.env.SNMP_DEFAULT_COMMUNITY?.trim() ||
    readEnvFile().SNMP_DEFAULT_COMMUNITY?.trim() ||
    "";
  if (fromEnv) return fromEnv;

  const file = snmpPath();
  if (!fs.existsSync(file)) return "public";
  const text = fs.readFileSync(file, "utf8");
  const defaultMatch = text.match(/default_v2:\s*\n\s*community:\s*(.+)\s*$/m);
  if (defaultMatch?.[1]) return defaultMatch[1].trim();
  const publicMatch = text.match(/public_v2:\s*\n\s*community:\s*(.+)\s*$/m);
  if (publicMatch?.[1]) return publicMatch[1].trim();
  const any = text.match(/^\s*community:\s*(.+)\s*$/m);
  return any?.[1]?.trim() || "public";
}

export function readConfig(): CollectorConfig {
  const fromFile = readEnvFile();
  const fromProcess = readProcessEnvOverlay();
  // Most recent wins: Setup Save (file) vs Environment/compose (process)
  const env =
    resolveConfigAuthority(fromProcess) === "setup"
      ? { ...fromProcess, ...fromFile }
      : { ...fromFile, ...fromProcess };
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
  // Setup Save is authority: start from file, then overlay current process gaps
  const existing = { ...readProcessEnvOverlay(), ...readEnvFile() };
  const current = readConfig();

  if (input.hostDeviceId === undefined && input.siteName) {
    const prevDefault = current.siteName ? `${current.siteName}-nuc` : "";
    const hostLooksDefault =
      !current.hostDeviceId || current.hostDeviceId === prevDefault;
    if (hostLooksDefault) {
      input = { ...input, hostDeviceId: `${input.siteName}-nuc` };
    }
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

  if (input.snmpCommunity !== undefined && input.snmpCommunity.trim()) {
    next.SNMP_DEFAULT_COMMUNITY = input.snmpCommunity.trim();
  }

  writeEnvMaps(next);
  applyEnvToProcess(next);

  const authority = readAuthority();
  writeAuthority({
    ...authority,
    setupSavedAt: Date.now()
    // Keep lastProcessFingerprint from boot — do not refresh here
  });

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
    // Prefer updating default_v2 / public_v2; generate-config.sh expands per-device auths.
    if (/default_v2:\s*\n\s*community:/m.test(content)) {
      content = content.replace(
        /(default_v2:\s*\n\s*community:\s*).*/m,
        `$1${community}`
      );
    } else if (/public_v2:\s*\n\s*community:/m.test(content)) {
      content = content.replace(
        /(public_v2:\s*\n\s*community:\s*).*/m,
        `$1${community}`
      );
    } else if (/^\s*community:/m.test(content)) {
      content = content.replace(/^\s*community:.*$/m, `    community: ${community}`);
    } else {
      content = content.replace(
        /^auths:\s*$/m,
        `auths:\n  default_v2:\n    community: ${community}\n    security_level: noAuthNoPriv\n    version: 2\n  public_v2:\n    community: ${community}\n    security_level: noAuthNoPriv\n    version: 2`
      );
    }
  } else {
    content = `auths:
  default_v2:
    community: ${community}
    security_level: noAuthNoPriv
    version: 2
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
