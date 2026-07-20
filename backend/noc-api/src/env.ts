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
  PUBLIC_DIR: z.string().optional()
});

export const env = envSchema.parse(process.env);

