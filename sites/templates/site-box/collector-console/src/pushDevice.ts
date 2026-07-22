import fs from "fs";
import path from "path";
import { readConfig } from "./config";
import { syncDevices, type SyncResult } from "./sync";

export type PushDeviceInput = {
  name: string;
  snmpIp: string;
  type?: string;
  vendor?: string;
  id?: string;
};

export type PushDeviceResult = {
  ok: boolean;
  created?: boolean;
  message: string;
  device?: unknown;
  sync?: SyncResult;
};

/** Push a network device to NOC, then pull inventory + reload Alloy. */
export async function pushDeviceToNoc(
  dataDir: string,
  input: PushDeviceInput
): Promise<PushDeviceResult> {
  const config = readConfig();
  if (!config.nocApiUrl || !config.siteName || !config.collectorToken) {
    return {
      ok: false,
      message: "Missing NOC_API_URL, SITE_NAME, or COLLECTOR_TOKEN — finish Setup first"
    };
  }

  const name = input.name.trim();
  const snmpIp = input.snmpIp.trim();
  if (!name || !snmpIp) {
    return { ok: false, message: "name and snmpIp are required" };
  }

  const url = `${config.nocApiUrl.replace(/\/$/, "")}/api/collector/${config.siteName}/devices`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.collectorToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      name,
      snmpIp,
      type: (input.type || "switch").trim() || "switch",
      vendor: (input.vendor || "generic").trim() || "generic",
      id: input.id?.trim() || undefined
    })
  });

  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }

  if (!res.ok) {
    return {
      ok: false,
      message: `NOC rejected device (HTTP ${res.status}): ${
        typeof body.error === "string" ? body.error : text.slice(0, 200)
      }`
    };
  }

  // Invalidate etag so pull gets the new inventory
  const etagFile = path.join(dataDir, ".devices.etag");
  try {
    if (fs.existsSync(etagFile)) fs.unlinkSync(etagFile);
  } catch {
    /* ignore */
  }

  const sync = await syncDevices(dataDir);
  const created = body.created === true;

  return {
    ok: sync.ok,
    created,
    message: created
      ? `Added on NOC and ${sync.message}`
      : `Updated on NOC and ${sync.message}`,
    device: body.device,
    sync
  };
}
