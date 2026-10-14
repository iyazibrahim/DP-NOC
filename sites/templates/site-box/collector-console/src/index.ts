import express from "express";
import path from "path";
import fs from "fs";
import {
  alloyConfigReady,
  alloyReloadNeeded,
  assertDataDirWritable,
  bootstrapPersistentEnv,
  dataDir,
  ensureBundledToolkit,
  maskConfig,
  readConfig,
  readConfigAlloy,
  readDevicesJson,
  writeConfig,
  type CollectorConfig
} from "./config";
import {
  getAlloyLogs,
  isAlloyRunning,
  preserveSecretsFromAlloy,
  readAlloyContainerEnv,
  regenerateAlloyConfig,
  reloadAlloy,
  assertAlloyConfigSafe
} from "./alloy";
import {
  alloySnmpConfigStale,
  alloySnmpStaleReason,
  getLastSync,
  startSyncLoop,
  syncDevices
} from "./sync";
import { pushDeviceToNoc } from "./pushDevice";
import { scanAndPushStations, startClientsScanLoop } from "./scanClients";

const PORT = Number(process.env.PORT || "8090");

let dir: string;
try {
  dir = ensureBundledToolkit();
} catch (err) {
  console.error("[boot] DATA_DIR not usable:", err instanceof Error ? err.message : err);
  dir = process.env.DATA_DIR || "/data";
}

const app = express();
app.use(express.json({ limit: "64kb" }));

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

const CATALOG = [
  { id: "site-1", name: "Digital Penang Office" },
  { id: "site-2", name: "Penang Digital Library 1" },
  { id: "site-3", name: "Penang Digital Library 2" },
  { id: "site-4", name: "Butterworth Digital Library" },
  { id: "site-5", name: "Batu Maung Digital Library" }
];

function inspectConfigAlloyHealth(): {
  hasSnmpBlock: boolean;
  configUnsafe: boolean;
  configUnsafeReason: string | null;
} {
  const alloyPath = path.join(dir, "config.alloy");
  if (!fs.existsSync(alloyPath)) {
    return { hasSnmpBlock: false, configUnsafe: false, configUnsafeReason: null };
  }
  const alloy = fs.readFileSync(alloyPath, "utf8");
  const hasSnmpBlock = alloy.includes("prometheus.exporter.snmp");
  try {
    assertAlloyConfigSafe(alloy);
    return { hasSnmpBlock, configUnsafe: false, configUnsafeReason: null };
  } catch (err) {
    return {
      hasSnmpBlock,
      configUnsafe: true,
      configUnsafeReason: err instanceof Error ? err.message : String(err)
    };
  }
}

function alloyLogCrashHints(logs: string): string[] {
  const logLower = logs.toLowerCase();
  const hints: string[] = [];
  if (logLower.includes("config_merge_strategy") || logLower.includes("unrecognized attribute")) {
    hints.push(
      "Alloy logs: unsupported attribute (often config_merge_strategy) — regenerate without it (Alloy v1.5.1)"
    );
  }
  if (logLower.includes("invalid duration")) {
    hints.push("Alloy logs: invalid duration — scrape_interval still has a shell placeholder");
  }
  if (logLower.includes("could not perform the initial load")) {
    hints.push("Alloy could not load config — SNMP scrape will not run until config is fixed");
  }
  if (logLower.includes("integrations/snmp")) {
    hints.push(
      "Legacy integrations/snmp job names in logs — ensure generate-config relabels to site_snmp_if_mib (CUTOVER_SITEBOX_SNMP.md)"
    );
  }
  return hints;
}

/** Compose healthcheck — Alloy waits until shared volume has loadable config. */
app.get("/api/ready", (_req, res) => {
  try {
    assertDataDirWritable();
    if (!alloyConfigReady()) {
      res.status(503).json({
        ok: false,
        ready: false,
        message: "Waiting for config.alloy / blackbox.yml / snmp.yml on DATA_DIR volume"
      });
      return;
    }
    res.json({ ok: true, ready: true, dataDir: dataDir() });
  } catch (err) {
    res.status(503).json({
      ok: false,
      ready: false,
      message: err instanceof Error ? err.message : String(err)
    });
  }
});

app.get("/api/catalog", (_req, res) => {
  res.json(CATALOG);
});

app.get("/api/status", async (_req, res) => {
  const config = readConfig();
  const last = getLastSync();
  const alloyRunning = await isAlloyRunning();
  const devices = readDevicesJson();
  const snmpStale = alloySnmpConfigStale(dir);
  const alloyEnv = await readAlloyContainerEnv();
  const metricsConfigured = Boolean(
    alloyEnv.CENTRAL_REMOTE_WRITE_URL &&
      alloyEnv.CF_ACCESS_CLIENT_ID &&
      alloyEnv.CF_ACCESS_CLIENT_SECRET
  );
  const cfgHealth = inspectConfigAlloyHealth();
  const logs = await getAlloyLogs(30);
  const crashHints = alloyLogCrashHints(logs);
  const alloyText = fs.existsSync(path.join(dir, "config.alloy"))
    ? fs.readFileSync(path.join(dir, "config.alloy"), "utf8")
    : "";

  let nocReachable: boolean | null = null;
  if (config.nocApiUrl) {
    try {
      const r = await fetch(`${config.nocApiUrl.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      nocReachable = r.ok;
    } catch {
      nocReachable = false;
    }
  }

  const site = config.siteName || "site-1";
  const warnings: string[] = [];
  if (!metricsConfigured) {
    warnings.push(
      "Alloy missing CF Access / remote_write env — NOC will show Collector/Uplink DOWN (No recent samples). Set them in Setup (or Environment on redeploy), then Save."
    );
  }
  if (cfgHealth.configUnsafe) {
    warnings.push(cfgHealth.configUnsafeReason || "config.alloy unsafe for Alloy v1.5.1");
  }
  if (alloyText.includes("integrations/snmp") || alloyText.includes("integrations.snmp")) {
    warnings.push(
      "config.alloy still has legacy integrations/snmp — follow CUTOVER_SITEBOX_SNMP.md (need site_snmp_if_mib + snmp_up)"
    );
  }
  if (crashHints.length > 0) {
    warnings.push(...crashHints);
  }
  const snmpStaleReason = alloySnmpStaleReason(dir);
  if (snmpStale) {
    warnings.push(
      snmpStaleReason?.detail ||
        "SNMP targets in devices.json are not fully applied in config.alloy — click Force apply SNMP."
    );
  }

  res.json({
    configured: Boolean(
      config.siteName && config.nocApiUrl && config.collectorToken && config.centralRemoteWriteUrl
    ),
    alloyRunning,
    metricsConfigured,
    deviceCount: devices.length,
    snmpConfigStale: snmpStale,
    snmpStaleReason,
    snmpBlockPresent: cfgHealth.hasSnmpBlock,
    configUnsafe: cfgHealth.configUnsafe,
    snmpScrapeHint:
      devices.length > 0
        ? "SNMP polling is active. The dashboard marks a device Up when at least one SNMP check succeeds (ping alone is not enough)."
        : "No SNMP devices yet — add one to start polling.",
    snmpPollingLabel: devices.length > 0 ? "Active" : "Idle",
    dashboardConnection: !config.nocApiUrl
      ? { state: "unknown" as const, label: "Not configured" }
      : nocReachable === false
        ? { state: "fail" as const, label: "Failed" }
        : nocReachable === true
          ? { state: "ok" as const, label: "Connected" }
          : { state: "unknown" as const, label: "Unknown" },
    nocReachable,
    lastSync: last,
    siteName: config.siteName,
    hostDeviceId: config.hostDeviceId,
    warning: warnings.length > 0 ? warnings[0] : null,
    warnings
  });
});

app.get("/api/config", (_req, res) => {
  res.json(maskConfig(readConfig()));
});

/** Check NOC URL, site id, and token before a fresh install is saved. */
app.post("/api/setup/probe", async (req, res) => {
  const body = (req.body || {}) as {
    nocApiUrl?: string;
    siteName?: string;
    collectorToken?: string;
  };
  const nocApiUrl =
    typeof body.nocApiUrl === "string" ? body.nocApiUrl.trim().replace(/\/$/, "") : "";
  const siteName = typeof body.siteName === "string" ? body.siteName.trim() : "";
  const provided =
    typeof body.collectorToken === "string" ? body.collectorToken.trim() : "";
  const token =
    provided && !provided.endsWith("…") ? provided : readConfig().collectorToken;

  let parsed: URL;
  try {
    parsed = new URL(nocApiUrl);
  } catch {
    return res.status(400).json({ ok: false, message: "NOC API URL is not a valid address." });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return res.status(400).json({
      ok: false,
      message: "NOC API URL must start with https:// or http://."
    });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(siteName)) {
    return res.status(400).json({
      ok: false,
      message: "Site ID should look like site-1."
    });
  }
  if (!token) {
    return res.status(400).json({
      ok: false,
      message: "Enter the collector token from the site page in the NOC."
    });
  }

  const target = `${nocApiUrl}/api/collector/${encodeURIComponent(siteName)}/devices.json`;
  try {
    const r = await fetch(target, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(12000)
    });
    if (r.status === 401 || r.status === 403) {
      return res.json({
        ok: false,
        message:
          "The NOC rejected this token. On the site page, generate a collector token and paste it again."
      });
    }
    if (r.status === 404) {
      return res.json({
        ok: false,
        message: "That site was not found. Use the site id from the wallboard, such as site-1."
      });
    }
    if (!r.ok) {
      return res.json({
        ok: false,
        message: `The NOC replied with status ${r.status}. Check the address.`
      });
    }
    return res.json({
      ok: true,
      message: "Connected. This collector can reach the dashboard for that site."
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return res.json({
      ok: false,
      message: `Could not reach the NOC. Check the address and that this collector can route to it. (${detail})`
    });
  }
});

app.post("/api/config", async (req, res) => {
  try {
    const preserved = await preserveSecretsFromAlloy();

    const body = req.body as Partial<CollectorConfig>;
    const before = readConfig();

    const patch: Partial<CollectorConfig> = {};
    const assign = <K extends keyof CollectorConfig>(key: K, val: unknown) => {
      if (typeof val === "string" && val.trim()) patch[key] = val.trim() as CollectorConfig[K];
    };

    assign("centralRemoteWriteUrl", body.centralRemoteWriteUrl);
    assign("cfAccessClientId", body.cfAccessClientId);
    if (
      typeof body.cfAccessClientSecret === "string" &&
      body.cfAccessClientSecret &&
      body.cfAccessClientSecret !== "***"
    ) {
      patch.cfAccessClientSecret = body.cfAccessClientSecret.trim();
    }
    assign("siteName", body.siteName);
    assign("hostDeviceId", body.hostDeviceId);
    assign("pingTarget1", body.pingTarget1);
    assign("pingTarget2", body.pingTarget2);
    assign("nocApiUrl", body.nocApiUrl);
    if (
      typeof body.collectorToken === "string" &&
      body.collectorToken &&
      !body.collectorToken.endsWith("…")
    ) {
      patch.collectorToken = body.collectorToken.trim();
    }
    assign("scrapeIntervalSec", body.scrapeIntervalSec);
    assign("syncIntervalSec", body.syncIntervalSec);
    assign("snmpCommunity", body.snmpCommunity);

    const saved = writeConfig(patch);
    const needsAlloyReload = alloyReloadNeeded(before, saved, patch);

    let regenMsg = "";
    if (needsAlloyReload) {
      try {
        // Recreate so Alloy picks up SITE_NAME / CF / remote_write from mirrored .env
        const envChanged = Boolean(
          patch.centralRemoteWriteUrl ||
            patch.cfAccessClientId ||
            patch.cfAccessClientSecret ||
            patch.siteName ||
            patch.hostDeviceId ||
            patch.pingTarget1 ||
            patch.pingTarget2 ||
            patch.scrapeIntervalSec
        );
        regenMsg = await regenerateAlloyConfig();
        regenMsg += " | " + (await reloadAlloy({ forceRecreate: envChanged }));
      } catch (err) {
        regenMsg = err instanceof Error ? err.message : String(err);
      }
    } else {
      regenMsg = "Alloy unchanged (only NOC sync settings updated)";
    }

    const syncResult = await syncDevices(dir, { forceAlloyReload: true });

    res.json({
      ok: true,
      config: maskConfig(saved),
      regen: regenMsg,
      preservedSecrets: preserved,
      sync: syncResult
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

app.post("/api/sync", async (req, res) => {
  const force =
    req.query.force === "1" ||
    req.query.force === "true" ||
    (req.body && typeof req.body === "object" && (req.body as { force?: boolean }).force === true);
  const result = await syncDevices(dir, { forceAlloyReload: Boolean(force) });
  res.status(result.ok ? 200 : 502).json(result);
});

app.get("/api/devices", (_req, res) => {
  res.json(readDevicesJson());
});

/** Walk AP client tables on the LAN and push rows to NOC (fills Clients tab). */
app.post("/api/scan-clients", async (_req, res) => {
  try {
    const result = await scanAndPushStations();
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      message: err instanceof Error ? err.message : String(err)
    });
  }
});

/** Live per-device SNMP status from the NOC dashboard (same source as wallboard). */
app.get("/api/device-status", async (_req, res) => {
  const config = readConfig();
  if (!config.nocApiUrl || !config.siteName || !config.collectorToken) {
    return res.status(400).json({
      ok: false,
      error: "Finish Setup first (NOC URL, site, collector token)",
      devices: [],
      dashboard: { connected: false, notes: "Collector not configured" }
    });
  }
  try {
    const url = `${config.nocApiUrl.replace(/\/$/, "")}/api/collector/${config.siteName}/device-status`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.collectorToken}`,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(15000)
    });
    const text = await r.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: text.slice(0, 200) };
    }
    if (!r.ok) {
      return res.status(502).json({
        ok: false,
        error: typeof body.error === "string" ? body.error : `NOC HTTP ${r.status}`,
        devices: [],
        dashboard: { connected: false, notes: "Could not load device status from NOC" }
      });
    }
    return res.json({ ok: true, ...body });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      devices: [],
      dashboard: { connected: false, notes: "NOC unreachable" }
    });
  }
});

app.get("/api/diagnostics", async (_req, res) => {
  const devices = readDevicesJson() as Array<{ id?: string; snmpIp?: string }>;
  const alloyPath = path.join(dir, "config.alloy");
  const alloy = fs.existsSync(alloyPath) ? fs.readFileSync(alloyPath, "utf8") : "";
  const hasSnmpBlock = alloy.includes("prometheus.exporter.snmp");
  const missingInAlloy = devices
    .filter((d) => d.id && d.snmpIp)
    .filter((d) => !alloy.includes(`device = "${d.id}"`))
    .map((d) => d.id);

  const alloyEnv = await readAlloyContainerEnv();
  const metricsEnv = {
    hasRemoteWriteUrl: Boolean(alloyEnv.CENTRAL_REMOTE_WRITE_URL),
    hasCfClientId: Boolean(alloyEnv.CF_ACCESS_CLIENT_ID),
    hasCfClientSecret: Boolean(alloyEnv.CF_ACCESS_CLIENT_SECRET),
    siteName: alloyEnv.SITE_NAME || "",
    remoteWriteUrl: alloyEnv.CENTRAL_REMOTE_WRITE_URL
      ? alloyEnv.CENTRAL_REMOTE_WRITE_URL.replace(/\/\/.*@/, "//***@")
      : ""
  };
  const metricsOk =
    metricsEnv.hasRemoteWriteUrl && metricsEnv.hasCfClientId && metricsEnv.hasCfClientSecret;

  const logs = await getAlloyLogs(40);
  const logLower = logs.toLowerCase();
  const remoteWriteHints: string[] = [];
  if (logLower.includes("403") || logLower.includes("forbidden")) {
    remoteWriteHints.push("Alloy logs show 403 — CF Access Client ID/Secret wrong or missing");
  }
  if (logLower.includes("401") || logLower.includes("unauthorized")) {
    remoteWriteHints.push("Alloy logs show 401 — auth rejected on metrics endpoint");
  }
  if (logLower.includes("502") || logLower.includes("503")) {
    remoteWriteHints.push("Alloy logs show 502/503 — metrics tunnel/Prometheus origin down");
  }
  if (logLower.includes("remote_write") && (logLower.includes("error") || logLower.includes("failed"))) {
    remoteWriteHints.push("Alloy logs mention remote_write errors — open Settings → View Alloy logs");
  }
  if (logLower.includes("out of order sample")) {
    remoteWriteHints.push(
      "400 out of order sample — Force apply SNMP, check NTP, wipe noc_alloy_wal if stuck (see docs/ALLOY_COLLECTOR.md)"
    );
  }
  if (logLower.includes("http2") && logLower.includes("connection lost")) {
    remoteWriteHints.push("HTTP/2 connection lost — Force apply so config has enable_http2=false");
  }
  const crashHints = alloyLogCrashHints(logs);
  const cfgHealth = inspectConfigAlloyHealth();

  let hint: string;
  if (!metricsOk) {
    hint =
      "NOC shows DOWN because Alloy cannot remote_write metrics. In Setup set CENTRAL remote write URL + CF Access Client ID/Secret, Save, and confirm Alloy recreates — or set the same vars in Environment before redeploy.";
  } else if (cfgHealth.configUnsafe || crashHints.length > 0) {
    hint = [cfgHealth.configUnsafeReason, ...crashHints]
      .filter(Boolean)
      .join(" | ");
  } else if (remoteWriteHints.length > 0) {
    hint = remoteWriteHints.join(" | ");
  } else if (missingInAlloy.length > 0 || (devices.length > 0 && !hasSnmpBlock)) {
    hint = "SNMP targets missing in Alloy — click Force apply SNMP";
  } else {
    hint =
      "Metrics env present on Alloy. Prove: up{job=\"site_snmp_if_mib\",device=\"site-1-fw1\"}=1. Config must have discovery.relabel snmp_job. If still integrations/snmp only: rebuild console + Force apply.";
  }
  res.json({
    whyNocDown:
      !metricsOk || remoteWriteHints.length > 0
        ? "Collector container is running, but metrics are not reaching central Prometheus (No recent samples)."
        : null,
    metricsEnv,
    remoteWriteHints,
    crashHints,
    configUnsafe: cfgHealth.configUnsafe,
    configUnsafeReason: cfgHealth.configUnsafeReason,
    snmpScrapeHint:
      "SNMP polling active when Alloy scrapes devices; dashboard Up = at least one SNMP check OK (not ping).",
    deviceCount: devices.length,
    devices,
    hasSnmpBlock,
    snmpConfigStale: alloySnmpConfigStale(dir),
    snmpStaleReason: alloySnmpStaleReason(dir),
    missingDeviceLabelsInAlloy: missingInAlloy,
    siteName: readConfig().siteName,
    hint,
    alloyLogTail: logs.slice(-1500)
  });
});

app.post("/api/devices", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await pushDeviceToNoc(dir, {
      name: typeof body.name === "string" ? body.name : "",
      snmpIp: typeof body.snmpIp === "string" ? body.snmpIp : "",
      type: typeof body.type === "string" ? body.type : "switch",
      vendor: typeof body.vendor === "string" ? body.vendor : "generic",
      id: typeof body.id === "string" ? body.id : undefined,
      snmpCommunity: typeof body.snmpCommunity === "string" ? body.snmpCommunity : undefined
    });
    res.status(result.ok ? (result.created ? 201 : 200) : 502).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      message: err instanceof Error ? err.message : String(err)
    });
  }
});

app.get("/api/config/alloy", (_req, res) => {
  res.type("text/plain").send(readConfigAlloy());
});

app.get("/api/logs/alloy", async (_req, res) => {
  const logs = await getAlloyLogs(80);
  res.type("text/plain").send(logs);
});

app.get("*", (_req, res) => {
  const index = path.join(publicDir, "index.html");
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.status(404).send("Collector console UI not found");
  }
});

async function boot(): Promise<void> {
  try {
    dir = ensureBundledToolkit();
  } catch (err) {
    console.error("[boot] ensureBundledToolkit:", err instanceof Error ? err.message : err);
  }

  const bootEnv = bootstrapPersistentEnv();

  try {
    if (!alloyConfigReady() || alloySnmpConfigStale(dir)) {
      const msg = await regenerateAlloyConfig();
      console.log("[boot] seeded/regenerated config.alloy:", msg || "ok");
    }
  } catch (err) {
    console.error(
      "[boot] regenerateAlloyConfig failed (healthcheck will stay down until fixed):",
      err instanceof Error ? err.message : err
    );
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `collector-console listening on :${PORT} (data=${dir} state=${process.env.STATE_DIR || dir} boot=${bootEnv.source} keys=${bootEnv.keys.length} alloyReady=${alloyConfigReady()})`
    );
    startSyncLoop(dir);
    startClientsScanLoop();
  });
}

void boot();
