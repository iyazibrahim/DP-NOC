import { execFile } from "child_process";
import { promisify } from "util";
import { readConfig, readDevicesJson } from "./config";

const execFileAsync = promisify(execFile);

type ProbeLevel = "up" | "down" | "unknown";

type LocalDevice = {
  id?: string;
  snmpIp?: string;
  snmpCommunity?: string;
};

export type ProbeRow = {
  deviceId: string;
  ping: ProbeLevel;
  snmp: ProbeLevel;
};

function isHost(ip: string): boolean {
  return /^[0-9a-fA-F:.]+$/.test(ip) && ip.length <= 64;
}

async function run(cmd: string, args: string[], timeout: number): Promise<ProbeLevel> {
  try {
    await execFileAsync(cmd, args, { timeout, windowsHide: true });
    return "up";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "unknown";
    return "down";
  }
}

async function pingHost(ip: string): Promise<ProbeLevel> {
  if (!isHost(ip)) return "unknown";
  const args =
    process.platform === "win32" ? ["-n", "1", "-w", "2000", ip] : ["-c", "1", "-W", "2", ip];
  return run("ping", args, 5000);
}

async function snmpHost(ip: string, community: string): Promise<ProbeLevel> {
  if (!isHost(ip)) return "unknown";
  const comm = community.replace(/[\r\n]/g, "").slice(0, 128) || "public";
  return run(
    "snmpget",
    ["-v2c", "-c", comm, "-t", "1", "-r", "0", ip, "1.3.6.1.2.1.1.3.0"],
    5000
  );
}

async function postSnapshot(
  rows: ProbeRow[]
): Promise<{ ok: boolean; message: string }> {
  const config = readConfig();
  if (!config.nocApiUrl || !config.siteName || !config.collectorToken) {
    return {
      ok: false,
      message: "Finish Setup first so this collector can report device checks to the NOC."
    };
  }
  const url = `${config.nocApiUrl.replace(/\/$/, "")}/api/collector/${encodeURIComponent(config.siteName)}/status-snapshot`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.collectorToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ devices: rows }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) {
      return {
        ok: false,
        message:
          "Checked the devices here, but the NOC did not accept the update. Check the collector token in Setup."
      };
    }
    return { ok: true, message: "Updated" };
  } catch {
    return {
      ok: false,
      message: "Checked the devices here, but the NOC could not be reached. Check the address in Setup."
    };
  }
}

export async function probeAllDevices(): Promise<{
  ok: boolean;
  message: string;
  devices: ProbeRow[];
}> {
  const config = readConfig();
  const devices = readDevicesJson() as LocalDevice[];
  const rows: ProbeRow[] = [];
  for (const d of devices) {
    const id = typeof d.id === "string" ? d.id.trim() : "";
    const ip = typeof d.snmpIp === "string" ? d.snmpIp.trim() : "";
    if (!id || !ip) continue;
    const community = (d.snmpCommunity || config.snmpCommunity || "public").trim() || "public";
    const ping = await pingHost(ip);
    const snmp = await snmpHost(ip, community);
    rows.push({ deviceId: id, ping, snmp });
  }

  const posted = await postSnapshot(rows);
  if (!rows.length) {
    return {
      ok: posted.ok,
      message: posted.ok ? "No devices with an SNMP address to check." : posted.message,
      devices: rows
    };
  }
  if (!posted.ok) return { ok: false, message: posted.message, devices: rows };

  const down = rows.filter((r) => r.ping === "down" && r.snmp === "down").length;
  const snmpOnly = rows.filter((r) => r.ping === "up" && r.snmp === "down").length;
  if (down > 0) {
    return {
      ok: true,
      message:
        down === 1
          ? "Updated. 1 device is not answering ping or SNMP. Check power and the network cable."
          : `Updated. ${down} devices are not answering ping or SNMP. Check power and the network cable.`,
      devices: rows
    };
  }
  if (snmpOnly > 0) {
    return {
      ok: true,
      message:
        snmpOnly === 1
          ? "Updated. 1 device is online, but SNMP is not answering. Check the SNMP community and that UDP port 161 is allowed, then use Force apply."
          : `Updated. ${snmpOnly} devices are online, but SNMP is not answering. Check the SNMP community and that UDP port 161 is allowed, then use Force apply.`,
      devices: rows
    };
  }
  return { ok: true, message: "Updated", devices: rows };
}

let probeInFlight = false;

export function startProbeLoop(): void {
  const tick = () => {
    if (probeInFlight) return;
    probeInFlight = true;
    void probeAllDevices()
      .catch((err) => {
        console.error("[probe]", err instanceof Error ? err.message : err);
      })
      .finally(() => {
        probeInFlight = false;
      });
  };
  setTimeout(tick, 10000);
  setInterval(tick, 30000);
}
