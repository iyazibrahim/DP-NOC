import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { dataDir } from "./config";

const execFileAsync = promisify(execFile);

export async function isAlloyRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      "-f",
      "{{.State.Running}}",
      "noc_site_alloy"
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function getAlloyLogs(lines = 50): Promise<string> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "logs",
      "--tail",
      String(lines),
      "noc_site_alloy"
    ]);
    return stdout;
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

  const { stdout, stderr } = await execFileAsync("bash", [script, devices, out], {
    cwd: dir,
    env: { ...process.env, SCRAPE_INTERVAL_SEC: process.env.SCRAPE_INTERVAL_SEC || "15" }
  });
  return (stdout + stderr).trim();
}

export async function recreateAlloy(): Promise<string> {
  const dir = dataDir();
  const compose = path.join(dir, "docker-compose.yml");
  const { stdout, stderr } = await execFileAsync(
    "docker",
    ["compose", "-f", compose, "up", "-d", "--force-recreate", "alloy"],
    { cwd: dir }
  );
  return (stdout + stderr).trim();
}
