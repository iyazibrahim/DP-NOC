import { createApp } from "./app";
import { env } from "./env";
import cron from "node-cron";
import { loadRetentionConfig, enforceStorageCap } from "./services/retention";
import { runExport } from "./services/exports";
import { syncDevicesFromPrometheus } from "./services/deviceSync";

async function main() {
  const app = createApp();
  app.listen(env.PORT, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`noc-app listening on 0.0.0.0:${env.PORT}`);
  });

  cron.schedule(
    "0 0 * * 0",
    async () => {
      try {
        const cfg = loadRetentionConfig();
        if (!cfg.scheduledExportsEnabled) return;
        const record = await runExport("weekly");
        // eslint-disable-next-line no-console
        console.log(`[cron] weekly export completed: ${record.id}`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[cron] weekly export failed:", e);
      }
    },
    { timezone: "Asia/Kuala_Lumpur" }
  );

  cron.schedule(
    "0 0 1 * *",
    async () => {
      try {
        const cfg = loadRetentionConfig();
        if (!cfg.scheduledExportsEnabled) return;
        const record = await runExport("monthly");
        // eslint-disable-next-line no-console
        console.log(`[cron] monthly export completed: ${record.id}`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[cron] monthly export failed:", e);
      }
    },
    { timezone: "Asia/Kuala_Lumpur" }
  );

  cron.schedule("0 6 * * *", () => {
    enforceStorageCap().catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[cron] retention enforcement failed:", e);
    });
  });

  // Auto-sync discovered hosts/devices from Prometheus inventory.
  // Uses 1-minute granularity (server-side) to avoid missing series entirely.
  cron.schedule("*/1 * * * *", () => {
    syncDevicesFromPrometheus().catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[cron] auto-sync devices failed:", e);
    });
  });

  // Run once on startup so the inventory is populated quickly on first boot.
  syncDevicesFromPrometheus().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[startup] auto-sync devices failed:", e);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("noc-api failed to start:", err);
  process.exit(1);
});
