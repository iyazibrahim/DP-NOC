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
    deviceCount: devices.length,
    snmpConfigStale: snmpStale,
    nocReachable,
    lastSync: last,
    siteName: config.siteName,
    hostDeviceId: config.hostDeviceId
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

app.get("/api/diagnostics", (_req, res) => {
  const devices = readDevicesJson() as Array<{ id?: string; snmpIp?: string }>;
  const alloyPath = path.join(dir, "config.alloy");
  const alloy = fs.existsSync(alloyPath) ? fs.readFileSync(alloyPath, "utf8") : "";
  const hasSnmpBlock = alloy.includes("prometheus.exporter.snmp");
  const missingInAlloy = devices
    .filter((d) => d.id && d.snmpIp)
    .filter((d) => !alloy.includes(`device = "${d.id}"`))
    .map((d) => d.id);

  res.json({
    deviceCount: devices.length,
    devices,
    hasSnmpBlock,
    snmpConfigStale: alloySnmpConfigStale(dir),
    missingDeviceLabelsInAlloy: missingInAlloy,
    siteName: readConfig().siteName,
    hint:
      missingInAlloy.length > 0 || (devices.length > 0 && !hasSnmpBlock)
        ? "SNMP targets missing in Alloy — click Sync now (force apply)"
        : "Alloy config has SNMP targets. If NOC still shows UNKNOWN: check Fortinet SNMPv2c community (must match snmp.yml), UDP 161 from NUC, then query snmp_up{site=\"site-1\"} in Prometheus"
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
