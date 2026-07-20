import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./env";
import { authRouter } from "./routes/auth";
import { sitesRouter } from "./routes/sites";
import { alertsRouter } from "./routes/alerts";
import { dashboardsRouter } from "./routes/dashboards";
import { devicesRouter } from "./routes/devices";
import { websitesRouter } from "./routes/websites";

function resolvePublicDir() {
  if (env.PUBLIC_DIR && fs.existsSync(env.PUBLIC_DIR)) {
    return env.PUBLIC_DIR;
  }
  const candidates = [
    path.join(process.cwd(), "public"),
    path.join(__dirname, "../public"),
    path.join(process.cwd(), "../../frontend/wallboard/dist")
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

export function createApp() {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    return res.json({ ok: true, service: "noc-app", port: env.PORT });
  });

  app.get("/api/settings", (_req, res) => {
    return res.json({
      grafanaPublicUrl: env.GRAFANA_PUBLIC_URL
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/sites", sitesRouter);
  app.use("/api/alerts", alertsRouter);
  app.use("/api/dashboards", dashboardsRouter);
  app.use("/api/devices", devicesRouter);
  app.use("/api/websites", websitesRouter);

  const publicDir = resolvePublicDir();
  if (publicDir) {
    app.use(express.static(publicDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path === "/health") {
        return next();
      }
      const index = path.join(publicDir, "index.html");
      if (fs.existsSync(index)) {
        return res.sendFile(index);
      }
      return next();
    });
  }

  return app;
}
