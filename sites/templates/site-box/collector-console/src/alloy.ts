import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { dataDir } from "./config";

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

export async function regenerateAlloyConfig(): Promise<string> {
  const dir = dataDir();
  const script = path.join(dir, "generate-config.sh");
  const devices = path.join(dir, "devices.json");
  const out = path.join(dir, "config.alloy");

  if (!fs.existsSync(script)) {
    throw new Error("generate-config.sh not found in data directory");
  }

  return run("bash", [script, devices, out], {
    cwd: dir,
    env: { SCRAPE_INTERVAL_SEC: process.env.SCRAPE_INTERVAL_SEC || "15" }
  });
}

/**
 * Reload Alloy after devices.json / config.alloy / .env changes.
 * Prefer compose recreate; fall back to restart (config.alloy is bind-mounted).
 * Dokploy images often ship docker CLI without the compose plugin.
 */
export async function recreateAlloy(): Promise<string> {
  const dir = dataDir();
  const composeFile = path.join(dir, "docker-compose.yml");
  const errors: string[] = [];

  // 1) docker compose (plugin v2)
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

  // 2) docker-compose standalone binary
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

  // 3) restart — enough when only config.alloy / snmp.yml changed (bind mounts)
  try {
    const out = await run("docker", ["restart", "noc_site_alloy"]);
    return (
      (out || "restarted noc_site_alloy") +
      " (compose unavailable; restart used — remounts config.alloy)"
    );
  } catch (err) {
    errors.push(`docker restart: ${err instanceof Error ? err.message : String(err)}`);
    throw new Error(`Failed to reload Alloy:\n${errors.join("\n")}`);
  }
}
