import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./env";
import { authRouter } from "./routes/auth";
import { sitesRouter } from "./routes/sites";
import { alertsRouter } from "./routes/alerts";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    return res.json({ ok: true, service: "noc-api", port: env.PORT });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/sites", sitesRouter);
  app.use("/api/alerts", alertsRouter);

  return app;
}

