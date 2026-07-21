import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),

  // Local development default. Replace for production.
  JWT_SECRET: z.string().min(16).default("dev-noc-jwt-secret"),
  JWT_ISSUER: z.string().default("noc-api"),
  JWT_AUDIENCE: z.string().default("noc-wallboard"),

  OPERATOR_USERNAME: z.string().default("admin"),
  OPERATOR_PASSWORD: z.string().default("admin"),

  WALLBOARD_ENABLED: z.coerce.boolean().default(true),

  PROMETHEUS_BASE_URL: z.string().default("http://localhost:9090"),
  ALERTMANAGER_BASE_URL: z.string().default("http://localhost:9093"),
  GRAFANA_PUBLIC_URL: z.string().default("http://localhost:3001"),
  PUBLIC_DIR: z.string().optional(),
  PROMETHEUS_APPLY_CMD: z.string().optional(),
  ALERTMANAGER_APPLY_CMD: z.string().optional(),
  STATUS_DASHBOARD_REFRESH_SEC: z.coerce.number().default(5),
  /** Silence window before uplink/collector treated as DOWN (30–60s; needs ICMP ≤30s). */
  STATUS_METRIC_FRESH_SEC: z.coerce.number().default(45),

  // Auto-register devices/collector hosts discovered in Prometheus `up` series.
  AUTO_SYNC_DEVICES: z.coerce.boolean().default(true),
  AUTO_SYNC_NETWORK_DEVICES: z.coerce.boolean().default(false)
});

export const env = envSchema.parse(process.env);

