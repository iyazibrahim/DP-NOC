import { execFile } from "child_process";
import { promisify } from "util";
import { readSnmpCommunity, stateDir } from "./config";
import type { ScannedStation } from "./scanClients";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

type LocalDevice = {
  id?: string;
  name?: string;
  snmpIp?: string;
  type?: string;
  vendor?: string;
  snmpCommunity?: string;
};

function readLocalDevices(): LocalDevice[] {
  const p = path.join(stateDir(), "devices.json");
  const fallback = path.join(process.env.DATA_DIR || "/data", "devices.json");
  const use = fs.existsSync(p) ? p : fallback;
  if (!fs.existsSync(use)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(use, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isCambium(d: LocalDevice): boolean {
  const v = (d.vendor || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return v === "cambium" || v.startsWith("cambium");
}

function isAp(d: LocalDevice): boolean {
  const t = (d.type || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return t === "ap" || t === "accesspoint" || t === "wifi" || t === "wireless";
}

/**
 * cnPilot E-series client table is read-only in the published MIB.
 * RowStatus destroy (integer 6) on the index column is the only write we attempt.
 * A refusal is reported; the block stays saved.
 */
const CLIENT_INDEX_OID = "1.3.6.1.4.1.17713.22.1.3.1.1";

function explainSnmpFailure(text: string, community: string): string {
  const safe = text.split(community).join("••••");
  if (/noSuchName|noSuchObject|noSuchInstance|notWritable|noAccess|authorizationError|wrongType|Bad variable type/i.test(safe)) {
    return "The access point refused the write. cnPilot E-series SNMP is read-only on this firmware, so block this MAC on the AP.";
  }
  if (/Timeout|timed out|No response/i.test(safe)) return "The access point did not answer the write.";
  const line = safe.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop() || "The access point refused the write.";
  return line.slice(0, 240);
}

async function snmpSet(ip: string, community: string, oid: string): Promise<{ ok: boolean; detail: string }> {
  try {
    await execFileAsync(
      "snmpset",
      ["-v2c", "-c", community, "-t", "2", "-r", "0", ip, oid, "i", "6"],
      { timeout: 8000 }
    );
    return { ok: true, detail: "The access point accepted the disconnect." };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string; code?: string };
    if (e.code === "ENOENT") return { ok: false, detail: "snmpset is not installed on the collector." };
    return { ok: false, detail: explainSnmpFailure(`${e.stderr || ""} ${e.message || ""}`, community) };
  }
}

export async function applyClientBlocks(
  blocks: Array<{ mac: string }>,
  stations: ScannedStation[]
): Promise<Array<{ mac: string; result: "dropped" | "refused" | "absent"; detail: string }>> {
  const attempts: Array<{ mac: string; result: "dropped" | "refused" | "absent"; detail: string }> = [];
  if (blocks.length === 0) return attempts;
  const devices = readLocalDevices().filter((d) => d.id && d.snmpIp && isAp(d) && isCambium(d));
  const fallback = readSnmpCommunity();
  for (const block of blocks) {
    const mac = block.mac.trim().toLowerCase();
    const hits = stations.filter((st) => (st.mac || "").toLowerCase() === mac && st.clientIndex && /cambium/i.test(st.vendor || ""));
    if (hits.length === 0) {
      attempts.push({
        mac: block.mac,
        result: "absent",
        detail: "Saved. This MAC is not on a Cambium access point right now. The collector will drop it if it joins."
      });
      continue;
    }
    let dropped = false;
    const details: string[] = [];
    for (const hit of hits) {
      const device = devices.find((d) => d.id === hit.deviceId);
      if (!device?.snmpIp || !hit.clientIndex) {
        details.push(`${hit.apLabel}: no SNMP address for this access point.`);
        continue;
      }
      const community = (device.snmpCommunity || fallback || "public").trim() || "public";
      const result = await snmpSet(device.snmpIp, community, `${CLIENT_INDEX_OID}.${hit.clientIndex}`);
      if (result.ok) dropped = true;
      details.push(`${hit.apLabel}: ${result.detail}`);
    }
    attempts.push({
      mac: block.mac,
      result: dropped ? "dropped" : "refused",
      detail: details.join(" ").slice(0, 400)
    });
  }
  return attempts;
}
