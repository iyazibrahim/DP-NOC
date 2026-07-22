import express from "express";
import path from "path";
import fs from "fs";
import {
  alloyReloadNeeded,
  bootstrapPersistentEnv,
  dataDir,
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
  reloadAlloy
} from "./alloy";
import { alloySnmpConfigStale, getLastSync, startSyncLoop, syncDevices } from "./sync";
import { pushDeviceToNoc } from "./pushDevice";

const PORT = Number(process.env.PORT || "8090");
const dir = dataDir();

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

  res.json({
    configured: Boolean(
      config.siteName && config.nocApiUrl && config.collectorToken && config.centralRemoteWriteUrl
    ),
    alloyRunning,
    metricsConfigured,
    deviceCount: devices.length,
    snmpConfigStale: snmpStale,
    nocReachable,
    lastSync: last,
    siteName: config.siteName,
    hostDeviceId: config.hostDeviceId,
    warning: !metricsConfigured
      ? "Alloy missing CF Access / remote_write env — NOC will show Collector/Uplink DOWN (No recent samples). Set vars in Dokploy Environment."
      : null
  });
});

app.get("/api/config", (_req, res) => {
  res.json(maskConfig(readConfig()));
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
        const envChanged = Boolean(
          patch.centralRemoteWriteUrl || patch.cfAccessClientId || patch.cfAccessClientSecret
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

  let hint: string;
  if (!metricsOk) {
    hint =
      "NOC shows DOWN because Alloy cannot remote_write metrics. Set CENTRAL_REMOTE_WRITE_URL + CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET in Dokploy → Environment, then redeploy/restart noc_site_alloy.";
  } else if (remoteWriteHints.length > 0) {
    hint = remoteWriteHints.join(" | ");
  } else if (missingInAlloy.length > 0 || (devices.length > 0 && !hasSnmpBlock)) {
    hint = "SNMP targets missing in Alloy — click Force apply SNMP";
  } else {
    hint =
      "Metrics env present on Alloy. Check SNMP scrape: up{job=\"site_snmp_if_mib\"} then snmp_up{site=\"site-1\"}. If scrape up=0: Fortinet community in snmp.yml / UDP 161. Device id must match exactly (e.g. site-1-firewall1).";
  }
  res.json({
    whyNocDown:
      !metricsOk || remoteWriteHints.length > 0
        ? "Collector container is running, but metrics are not reaching central Prometheus (No recent samples)."
        : null,
    metricsEnv,
    remoteWriteHints,
    deviceCount: devices.length,
    devices,
    hasSnmpBlock,
    snmpConfigStale: alloySnmpConfigStale(dir),
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
      id: typeof body.id === "string" ? body.id : undefined
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

app.listen(PORT, "0.0.0.0", () => {
  const boot = bootstrapPersistentEnv();
  console.log(
    `collector-console listening on :${PORT} (data=${dir} state=${process.env.STATE_DIR || dir} boot=${boot.source} keys=${boot.keys.length})`
  );
  startSyncLoop(dir);
});
