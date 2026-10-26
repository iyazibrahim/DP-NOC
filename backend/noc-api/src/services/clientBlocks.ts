import fs from "fs";
import path from "path";
import { normalizeMac } from "./clientLedger";

export type BlockResult = "pending" | "dropped" | "refused" | "absent";

export type ClientBlock = {
  mac: string;
  hostname: string | null;
  ssid: string | null;
  apLabel: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  lastResult: BlockResult;
  lastDetail: string | null;
};

type BlockFile = { sites: Record<string, ClientBlock[]> };

function blockPath(): string {
  const dir = path.join(process.cwd(), "data/runtime");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "client-blocks.json");
}

function loadFile(): BlockFile {
  const file = blockPath();
  if (!fs.existsSync(file)) return { sites: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as BlockFile;
    return parsed?.sites ? parsed : { sites: {} };
  } catch {
    return { sites: {} };
  }
}

function saveFile(file: BlockFile): void {
  fs.writeFileSync(blockPath(), JSON.stringify(file, null, 2) + "\n", "utf8");
}

export function listClientBlocks(siteId: string): ClientBlock[] {
  return loadFile().sites[siteId] ?? [];
}

export function blockClient(
  siteId: string,
  input: { mac: string; hostname?: string | null; ssid?: string | null; apLabel?: string | null }
): ClientBlock | null {
  const mac = normalizeMac(input.mac);
  if (!mac) return null;
  const file = loadFile();
  const rows = file.sites[siteId] ?? [];
  const existing = rows.find((row) => row.mac === mac);
  if (existing) {
    existing.hostname = input.hostname ?? existing.hostname;
    existing.ssid = input.ssid ?? existing.ssid;
    existing.apLabel = input.apLabel ?? existing.apLabel;
    file.sites[siteId] = rows;
    saveFile(file);
    return existing;
  }
  const created: ClientBlock = {
    mac,
    hostname: input.hostname ?? null,
    ssid: input.ssid ?? null,
    apLabel: input.apLabel ?? null,
    createdAt: new Date().toISOString(),
    lastAttemptAt: null,
    lastResult: "pending",
    lastDetail: "Saved. The collector will try to drop this MAC on the next client scan."
  };
  file.sites[siteId] = [...rows, created];
  saveFile(file);
  return created;
}

export function unblockClient(siteId: string, macRaw: string): boolean {
  const mac = normalizeMac(macRaw);
  if (!mac) return false;
  const file = loadFile();
  const rows = file.sites[siteId] ?? [];
  const next = rows.filter((row) => row.mac !== mac);
  if (next.length === rows.length) return false;
  file.sites[siteId] = next;
  saveFile(file);
  return true;
}

export function reportBlockAttempts(
  siteId: string,
  attempts: Array<{ mac: string; result: BlockResult; detail: string }>
): ClientBlock[] {
  const file = loadFile();
  const rows = file.sites[siteId] ?? [];
  const now = new Date().toISOString();
  for (const attempt of attempts) {
    const mac = normalizeMac(attempt.mac);
    if (!mac) continue;
    const row = rows.find((item) => item.mac === mac);
    if (!row) continue;
    if (attempt.result !== "pending" && attempt.result !== "dropped" && attempt.result !== "refused" && attempt.result !== "absent") {
      continue;
    }
    row.lastAttemptAt = now;
    row.lastResult = attempt.result;
    row.lastDetail = attempt.detail.slice(0, 400);
  }
  file.sites[siteId] = rows;
  saveFile(file);
  return rows;
}
