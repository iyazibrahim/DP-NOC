import express from "express";
import path from "path";
import fs from "fs";
import {
  alloyReloadNeeded,
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
import { getLastSync, startSyncLoop, syncDevices } from "./sync";
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
      config.siteName &&
        config.nocApiUrl &&
        config.collectorToken &&
        config.centralRemoteWriteUrl
    ),
    alloyRunning,
    deviceCount: devices.length,
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
    // Pull CF secrets from running Alloy into .env before any write (Dokploy recovery)
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
        // Env secret changes need recreate; otherwise restart (keep Dokploy env)
        const envChanged = Boolean(
          patch.centralRemoteWriteUrl ||
            patch.cfAccessClientId ||
            patch.cfAccessClientSecret
        );
        regenMsg = await regenerateAlloyConfig();
        regenMsg += " | " + (await reloadAlloy({ forceRecreate: envChanged }));
      } catch (err) {
        regenMsg = err instanceof Error ? err.message : String(err);
      }
    } else {
      regenMsg = "Alloy unchanged (only NOC sync settings updated)";
    }

    const syncResult = await syncDevices(dir);

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

app.post("/api/sync", async (_req, res) => {
  const result = await syncDevices(dir);
  res.status(result.ok ? 200 : 502).json(result);
});

app.get("/api/devices", (_req, res) => {
  res.json(readDevicesJson());
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
  console.log(`collector-console listening on :${PORT} (data dir: ${dir})`);
  startSyncLoop(dir);
});
