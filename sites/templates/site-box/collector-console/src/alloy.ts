import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { dataDir, readEnvFile } from "./config";

const execFileAsync = promisify(execFile);

async function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<string> {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd: opts?.cwd,
    env: opts?.env ? { ...process.env, ...opts.env } : process.env,
    maxBuffer: 2 * 1024 * 1024
  });
  return `${stdout}${stderr}`.trim();
}

export async function isAlloyRunning(): Promise<boolean> {
  try {
    const out = await run("docker", [
      "inspect",
      "-f",
      "{{.State.Running}}",
      "noc_site_alloy"
    ]);
    return out === "true";
  } catch {
    return false;
  }
}

export async function getAlloyLogs(lines = 50): Promise<string> {
  try {
    return await run("docker", ["logs", "--tail", String(lines), "noc_site_alloy"]);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Read CF Access / remote-write secrets from the running Alloy container env. */
export async function readAlloyContainerEnv(): Promise<Record<string, string>> {
  try {
    const out = await run("docker", [
      "inspect",
      "-f",
      "{{range .Config.Env}}{{println .}}{{end}}",
      "noc_site_alloy"
    ]);
    const result: Record<string, string> = {};
    for (const line of out.split("\n")) {
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      result[line.slice(0, idx)] = line.slice(idx + 1);
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * If .env is missing CF secrets (common when Dokploy injects env in UI),
 * copy them from the running Alloy container so a later recreate does not wipe metrics.
 */
export async function preserveSecretsFromAlloy(): Promise<string[]> {
  const file = path.join(dataDir(), ".env");
  const existing = readEnvFile();
  const fromAlloy = await readAlloyContainerEnv();
  const keys = [
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
    "CENTRAL_REMOTE_WRITE_URL"
  ];
  const added: string[] = [];
  const next = { ...existing };
  for (const key of keys) {
    if (!next[key] && fromAlloy[key]) {
      next[key] = fromAlloy[key];
      added.push(key);
    }
  }
  if (added.length === 0) return added;

  const lines = Object.entries(next).map(([k, v]) => `${k}=${v}`);
  lines.push("");
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return added;
}

export async function regenerateAlloyConfig(): Promise<string> {
  const dir = dataDir();
  const script = path.join(dir, "generate-config.sh");
  const devices = path.join(dir, "devices.json");
  const stateDevices = path.join(process.env.STATE_DIR || dir, "devices.json");
  const devicesFile = fs.existsSync(stateDevices) ? stateDevices : devices;
  const out = path.join(dir, "config.alloy");

  if (!fs.existsSync(script)) {
    throw new Error("generate-config.sh not found in data directory");
  }

  // Always write a numeric interval — Alloy rejects "${SCRAPE_INTERVAL_SEC}s"
  const interval = process.env.SCRAPE_INTERVAL_SEC || "15";
  const safeInterval = /^\d+$/.test(interval) ? interval : "15";

  return run("bash", [script, devicesFile, out], {
    cwd: dir,
    env: { SCRAPE_INTERVAL_SEC: safeInterval }
  });
}

/**
 * Reload Alloy after config.alloy / devices change.
 * Default: docker restart (safe — keeps Dokploy-injected env).
 * forceRecreate: only when .env metrics secrets actually changed.
 */
export async function reloadAlloy(opts?: { forceRecreate?: boolean }): Promise<string> {
  const forceRecreate = opts?.forceRecreate === true;
  const dir = dataDir();
  const composeFile = path.join(dir, "docker-compose.yml");

  if (!forceRecreate) {
    const out = await run("docker", ["restart", "noc_site_alloy"]);
    return out || "restarted noc_site_alloy";
  }

  // Preserve secrets into .env before recreate so env_file does not blank them
  await preserveSecretsFromAlloy();

  const errors: string[] = [];

  try {
    const out = await run(
      "docker",
      ["compose", "-f", composeFile, "up", "-d", "--force-recreate", "alloy"],
      { cwd: dir }
    );
    return out || "alloy recreated via docker compose";
  } catch (err) {
    errors.push(`docker compose: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const out = await run(
      "docker-compose",
      ["-f", composeFile, "up", "-d", "--force-recreate", "alloy"],
      { cwd: dir }
    );
    return out || "alloy recreated via docker-compose";
  } catch (err) {
    errors.push(`docker-compose: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Last resort: restart keeps existing container env
  try {
    const out = await run("docker", ["restart", "noc_site_alloy"]);
    return (
      (out || "restarted noc_site_alloy") +
      " (recreate failed; restart used to keep existing env)"
    );
  } catch (err) {
    errors.push(`docker restart: ${err instanceof Error ? err.message : String(err)}`);
    throw new Error(`Failed to reload Alloy:\n${errors.join("\n")}`);
  }
}

/** @deprecated use reloadAlloy */
export async function recreateAlloy(): Promise<string> {
  return reloadAlloy({ forceRecreate: false });
}
