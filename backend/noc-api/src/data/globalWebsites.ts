import fs from "fs";
import path from "path";

export type GlobalWebsiteTarget = {
  name: string;
  url: string;
  /** HetrixTools uptime monitor ID when synced */
  hetrixMonitorId?: string;
};

function resolveRuntimeDir(): string {
  const candidates = [
    path.join(process.cwd(), "data/runtime"),
    path.join(__dirname, "../../data/runtime"),
    "/app/data/runtime"
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  const preferred = path.join(process.cwd(), "data/runtime");
  fs.mkdirSync(preferred, { recursive: true });
  return preferred;
}

function globalFilePath(): string {
  return path.join(resolveRuntimeDir(), "global-websites.json");
}

function readJsonFile<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function persist(targets: GlobalWebsiteTarget[]) {
  const file = globalFilePath();
  fs.writeFileSync(file, JSON.stringify(targets, null, 2) + "\n", "utf8");
  try {
    // Lazy require avoids cycle with websiteProbes → getGlobalWebsites
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { syncWebsiteProbes } = require("../services/websiteProbes") as typeof import("../services/websiteProbes");
    syncWebsiteProbes();
  } catch {
    /* probe sync is best-effort */
  }
}

export function getGlobalWebsites(): GlobalWebsiteTarget[] {
  const file = globalFilePath();
  return readJsonFile<GlobalWebsiteTarget[]>(file, []);
}

export function addGlobalWebsite(target: {
  name: string;
  url: string;
  hetrixMonitorId?: string;
}): GlobalWebsiteTarget[] {
  const url = target.url.trim();
  const name = target.name.trim() || url;
  if (!url) throw new Error("url is required");
  if (!/^https?:\/\//i.test(url)) throw new Error("url must start with http:// or https://");

  const current = getGlobalWebsites();
  if (current.some((w) => w.url === url)) {
    throw new Error("Website URL already exists");
  }

  const next = [
    ...current,
    {
      name,
      url,
      ...(target.hetrixMonitorId ? { hetrixMonitorId: target.hetrixMonitorId } : {})
    }
  ];
  persist(next);
  return next;
}

export function updateGlobalWebsite(
  url: string,
  patch: { name?: string; newUrl?: string; hetrixMonitorId?: string | null }
): GlobalWebsiteTarget[] {
  const current = getGlobalWebsites();
  const idx = current.findIndex((w) => w.url === url);
  if (idx < 0) throw new Error("Website not found");

  const nextUrl = patch.newUrl?.trim() || current[idx].url;
  const nextName = patch.name?.trim() ?? current[idx].name;

  if (!/^https?:\/\//i.test(nextUrl)) throw new Error("url must start with http:// or https://");
  if (nextUrl !== url && current.some((w) => w.url === nextUrl)) {
    throw new Error("Website URL already exists");
  }

  const next = current.slice();
  const prev = current[idx];
  const updated: GlobalWebsiteTarget = {
    name: nextName,
    url: nextUrl
  };
  if (patch.hetrixMonitorId === null) {
    // clear
  } else if (typeof patch.hetrixMonitorId === "string" && patch.hetrixMonitorId) {
    updated.hetrixMonitorId = patch.hetrixMonitorId;
  } else if (prev.hetrixMonitorId && nextUrl === url) {
    updated.hetrixMonitorId = prev.hetrixMonitorId;
  }
  next[idx] = updated;
  persist(next);
  return next;
}

export function setGlobalWebsiteHetrixId(url: string, hetrixMonitorId: string | null): void {
  updateGlobalWebsite(url, { hetrixMonitorId });
}

export function removeGlobalWebsite(url: string): GlobalWebsiteTarget[] {
  const current = getGlobalWebsites();
  const next = current.filter((w) => w.url !== url);
  persist(next);
  return next;
}

export function findGlobalWebsite(url: string): GlobalWebsiteTarget | undefined {
  return getGlobalWebsites().find((w) => w.url === url);
}
