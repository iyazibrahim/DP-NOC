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
    path.join(__dirname, "../../public"),
    path.join(process.cwd(), "../../frontend/wallboard/dist")
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html")) || fs.existsSync(dir)) {
      if (fs.existsSync(path.join(dir, "index.html"))) return dir;
    }
  }
  return null;
}

export function createApp() {
  const app = express();
  const publicDir = resolvePublicDir();
  const hasUi = Boolean(publicDir && fs.existsSync(path.join(publicDir, "index.html")));

  // eslint-disable-next-line no-console
  console.log(
    hasUi
      ? `Serving UI from ${publicDir}`
      : "WARNING: No UI build found (public/index.html missing). / will not serve the React app."
  );

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    return res.json({
      ok: true,
      service: "noc-app",
      port: env.PORT,
      ui: hasUi,
      publicDir: publicDir ?? null
    });
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

  if (hasUi && publicDir) {
    app.use(express.static(publicDir, { index: false }));

    // SPA fallback for client-side routes (Express 4-safe)
    app.get(["/", "/maps", "/sites", "/sites/*", "/devices", "/alerts", "/websites", "/settings"], (_req, res) => {
      return res.sendFile(path.join(publicDir, "index.html"));
    });

    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api") || req.path === "/health") return next();
      if (path.extname(req.path)) return next();
      return res.sendFile(path.join(publicDir!, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      return res.status(503).type("html").send(`<!doctype html>
<html><body style="font-family:sans-serif;padding:2rem;background:#0b1215;color:#e5e7eb">
  <h1>noc-app is running (API only)</h1>
  <p>UI build is missing. Rebuild the image with the repo-root <code>Dockerfile</code> (multi-stage) so <code>public/index.html</code> is included.</p>
  <p>Check <a href="/health" style="color:#f59e0b">/health</a> — <code>ui</code> should be <code>true</code>.</p>
</body></html>`);
    });
  }

  app.use((req, res) => {
    res.status(404).json({
      error: "Not found",
      path: req.path,
      hint: "If this is the public domain, confirm Dokploy/Cloudflare route to noc-app:8080. Try /health"
    });
  });

  return app;
}
