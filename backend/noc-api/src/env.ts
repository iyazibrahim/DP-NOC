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
  /** Aliases used when OPERATOR_* is still the default admin/admin (Dokploy / ADMIN_* habit). */
  ADMIN_USER: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_PASS: z.string().optional(),

  WALLBOARD_ENABLED: z.coerce.boolean().default(true),

  PROMETHEUS_BASE_URL: z.string().default("http://localhost:9090"),
  ALERTMANAGER_BASE_URL: z.string().default("http://localhost:9093"),
  GRAFANA_PUBLIC_URL: z.string().default("http://localhost:3001"),
  PUBLIC_DIR: z.string().optional(),
  PROMETHEUS_APPLY_CMD: z.string().optional(),
  ALERTMANAGER_APPLY_CMD: z.string().optional(),
  STATUS_DASHBOARD_REFRESH_SEC: z.coerce.number().default(5),
  /**
   * Silence window before uplink/collector treated as DOWN.
   * Default 90s (balanced FP reduction). Requires ICMP scrape ≤30s (template 15s).
   */
  STATUS_METRIC_FRESH_SEC: z.coerce.number().default(90),
  /** Sustained critical duration before opening an acknowledgeable incident (ms). */
  INCIDENT_SUSTAIN_MS: z.coerce.number().default(90_000),

  // Auto-register devices/collector hosts discovered in Prometheus `up` series.
  AUTO_SYNC_DEVICES: z.coerce.boolean().default(true),
  AUTO_SYNC_NETWORK_DEVICES: z.coerce.boolean().default(false),

  /** Optional HetrixTools API key — overlays website status + sync create/delete monitors. */
  HETRIXTOOLS_API_TOKEN: z.string().default(""),
  /** Comma-separated location codes: nyc,sfo,dal,ams,lon,fra,sgp,syd,sao,tok,mba,waw */
  HETRIXTOOLS_LOCATIONS: z.string().default("sgp,ams,nyc"),
  /** Optional Hetrix contact list ID for alerts (empty = none). */
  HETRIXTOOLS_CONTACT_LIST: z.string().default(""),

  /**
   * Carto basemap API key (Dokploy / .env name kept as NEXT_PUBLIC_* for continuity).
   * Served at runtime via GET /api/settings/map — not baked into the Vite build.
   */
  NEXT_PUBLIC_CARTO_API_KEY: z.string().default("")
});

export const env = envSchema.parse(process.env);

const DEFAULT_OPERATOR_USER = "admin";
const DEFAULT_OPERATOR_PASS = "admin";

/**
 * Prefer OPERATOR_* when customized. If still the built-in admin/admin defaults,
 * fall back to ADMIN_USER + ADMIN_PASSWORD / ADMIN_PASS so Dokploy-style env names work.
 * Grafana GF_SECURITY_ADMIN_* is intentionally ignored.
 */
export function resolveOperatorCredentials(): { username: string; password: string } {
  const opUser = env.OPERATOR_USERNAME;
  const opPass = env.OPERATOR_PASSWORD;
  const stillDefault =
    opUser === DEFAULT_OPERATOR_USER && opPass === DEFAULT_OPERATOR_PASS;

  if (!stillDefault) {
    return { username: opUser, password: opPass };
  }

  const adminUser = (env.ADMIN_USER || "").trim();
  const adminPass = (env.ADMIN_PASSWORD || env.ADMIN_PASS || "").trim();
  if (adminUser && adminPass) {
    return { username: adminUser, password: adminPass };
  }

  return { username: opUser, password: opPass };
}

