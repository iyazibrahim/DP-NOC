import fs from "fs";
import path from "path";

export type GlobalWebsiteTarget = {
  name: string;
  url: string;
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
}

export function getGlobalWebsites(): GlobalWebsiteTarget[] {
  const file = globalFilePath();
  return readJsonFile<GlobalWebsiteTarget[]>(file, []);
}

export function addGlobalWebsite(target: { name: string; url: string }): GlobalWebsiteTarget[] {
  const url = target.url.trim();
  const name = target.name.trim() || url;
  if (!url) throw new Error("url is required");
  if (!/^https?:\/\//i.test(url)) throw new Error("url must start with http:// or https://");

  const current = getGlobalWebsites();
  if (current.some((w) => w.url === url)) {
    throw new Error("Website URL already exists");
  }

  const next = [...current, { name, url }];
  persist(next);
  return next;
}

export function updateGlobalWebsite(
  url: string,
  patch: { name?: string; newUrl?: string }
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
  next[idx] = { name: nextName, url: nextUrl };
  persist(next);
  return next;
}

export function removeGlobalWebsite(url: string): GlobalWebsiteTarget[] {
  const current = getGlobalWebsites();
  const next = current.filter((w) => w.url !== url);
  persist(next);
  return next;
}

