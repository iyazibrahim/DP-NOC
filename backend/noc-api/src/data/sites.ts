import fs from "fs";
import path from "path";

export type SiteDevice = {
  id: string;
  name: string;
  type: string;
  snmpIp: string;
  vendor: string;
};

export type Site = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  websiteTargets: Array<{ name: string; url: string }>;
  wan: {
    dnsTarget: string;
    vpsTarget: string;
  };
  devices: SiteDevice[];
  lan?: {
    snmpTargetIp?: string;
  };
};

function seedPathCandidates(): string[] {
  return [
    path.join(__dirname, "../../data/seed-sites.json"),
    path.join(process.cwd(), "data/seed-sites.json")
  ];
}

function runtimeSitesPathCandidates(): string[] {
  return [
    path.join(process.cwd(), "data/runtime/sites.json"),
    path.join(__dirname, "../../data/runtime/sites.json"),
    "/app/data/runtime/sites.json"
  ];
}

function findExisting(paths: string[]): string | null {
  for (const file of paths) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function resolveWritableSitesPath(): string {
  const existing = findExisting(runtimeSitesPathCandidates());
  if (existing) return existing;

  const preferred = path.join(process.cwd(), "data/runtime/sites.json");
  const dir = path.dirname(preferred);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return preferred;
}

function loadSeed(): Site[] {
  const seedFile = findExisting(seedPathCandidates());
  if (!seedFile) {
    throw new Error("seed-sites.json not found");
  }
  return JSON.parse(fs.readFileSync(seedFile, "utf8")) as Site[];
}

function ensureSitesFile(): string {
  const writable = resolveWritableSitesPath();
  if (!fs.existsSync(writable)) {
    const seed = loadSeed();
    fs.writeFileSync(writable, JSON.stringify(seed, null, 2) + "\n", "utf8");
  }
  return writable;
}

let sitesFile = ensureSitesFile();
let siteList: Site[] = JSON.parse(fs.readFileSync(sitesFile, "utf8")) as Site[];

function persist() {
  sitesFile = resolveWritableSitesPath();
  const dir = path.dirname(sitesFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(sitesFile, JSON.stringify(siteList, null, 2) + "\n", "utf8");
}

export function getSiteList(): Site[] {
  return siteList;
}

/** @deprecated use getSiteList — kept for call-site compatibility */
export { siteList };

export function getSiteById(id: string) {
  return siteList.find((s) => s.id === id) ?? null;
}

export function getAllDevices() {
  return siteList.flatMap((site) =>
    (site.devices ?? []).map((d) => ({
      ...d,
      siteId: site.id,
      siteName: site.name
    }))
  );
}

export function addDevice(siteId: string, device: SiteDevice): Site | null {
  const site = getSiteById(siteId);
  if (!site) return null;
  if (!site.devices) site.devices = [];
  if (site.devices.some((d) => d.id === device.id)) {
    throw new Error("Device id already exists on this site");
  }
  site.devices.push(device);
  persist();
  return site;
}

export function updateDevice(
  siteId: string,
  deviceId: string,
  patch: Partial<Omit<SiteDevice, "id">>
): Site | null {
  const site = getSiteById(siteId);
  if (!site) return null;
  const idx = (site.devices ?? []).findIndex((d) => d.id === deviceId);
  if (idx < 0) return null;
  site.devices[idx] = { ...site.devices[idx], ...patch, id: deviceId };
  persist();
  return site;
}

export function removeDevice(siteId: string, deviceId: string): Site | null {
  const site = getSiteById(siteId);
  if (!site) return null;
  const before = site.devices?.length ?? 0;
  site.devices = (site.devices ?? []).filter((d) => d.id !== deviceId);
  if ((site.devices?.length ?? 0) === before) return null;
  persist();
  return site;
}
