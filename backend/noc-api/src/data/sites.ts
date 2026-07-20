import fs from "fs";
import path from "path";
import crypto from "crypto";

export type DeviceKind = "server" | "network";

export type SiteDevice = {
  id: string;
  name: string;
  type: string;
  kind: DeviceKind;
  snmpIp?: string;
  hostMetricId?: string;
  vendor: string;
};

export type Site = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  notes?: string;
  createdAt?: string;
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
  return normalizeSites(JSON.parse(fs.readFileSync(seedFile, "utf8")) as Site[]);
}

function normalizeDevice(d: SiteDevice): SiteDevice {
  const kind: DeviceKind = d.kind ?? (d.hostMetricId ? "server" : "network");
  return {
    ...d,
    kind,
    vendor: d.vendor || "generic",
    snmpIp: kind === "network" ? d.snmpIp : d.snmpIp || undefined,
    hostMetricId: kind === "server" ? d.hostMetricId || `${d.id}` : d.hostMetricId
  };
}

function normalizeSite(s: Site): Site {
  return {
    ...s,
    devices: (s.devices ?? []).map(normalizeDevice),
    websiteTargets: s.websiteTargets ?? [],
    wan: s.wan ?? { dnsTarget: "1.1.1.1", vpsTarget: "139.99.88.174" }
  };
}

function normalizeSites(sites: Site[]): Site[] {
  return sites.map(normalizeSite);
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
let siteList: Site[] = normalizeSites(JSON.parse(fs.readFileSync(sitesFile, "utf8")) as Site[]);

function persist() {
  sitesFile = resolveWritableSitesPath();
  const dir = path.dirname(sitesFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(sitesFile, JSON.stringify(siteList, null, 2) + "\n", "utf8");
  syncSiteCatalog();
}

function syncSiteCatalog() {
  const catalog = getSiteCatalog();
  const candidates = [
    path.join(process.cwd(), "../../sites/catalog.json"),
    path.join(process.cwd(), "sites/catalog.json"),
    path.join(__dirname, "../../../../sites/catalog.json")
  ];
  for (const file of candidates) {
    const dir = path.dirname(file);
    if (fs.existsSync(dir)) {
      fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n", "utf8");
      return;
    }
  }
}

export function slugifyId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `site-${crypto.randomBytes(4).toString("hex")}`;
}

export function generateSiteId(name: string): string {
  let candidate = slugifyId(name);
  if (!siteList.some((s) => s.id === candidate)) return candidate;
  candidate = `${candidate}-${crypto.randomBytes(3).toString("hex")}`;
  return candidate;
}

export function getSiteList(): Site[] {
  return siteList;
}

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

export function getSiteCatalog() {
  return siteList.map((s) => ({ id: s.id, name: s.name }));
}

export function createSite(input: {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  notes?: string;
  wan?: Site["wan"];
}): Site {
  const id = generateSiteId(input.name);
  const site: Site = normalizeSite({
    id,
    name: input.name.trim(),
    lat: input.lat,
    lng: input.lng,
    address: input.address?.trim(),
    notes: input.notes?.trim(),
    createdAt: new Date().toISOString(),
    wan: input.wan ?? { dnsTarget: "1.1.1.1", vpsTarget: "139.99.88.174" },
    devices: [],
    websiteTargets: []
  });
  siteList.push(site);
  persist();
  return site;
}

export function updateSite(
  id: string,
  patch: Partial<
    Pick<Site, "name" | "lat" | "lng" | "address" | "notes" | "wan" | "websiteTargets">
  >
): Site | null {
  const site = getSiteById(id);
  if (!site) return null;
  if (typeof patch.name === "string") site.name = patch.name.trim();
  if (typeof patch.lat === "number") site.lat = patch.lat;
  if (typeof patch.lng === "number") site.lng = patch.lng;
  if (patch.address !== undefined) site.address = patch.address?.trim();
  if (patch.notes !== undefined) site.notes = patch.notes?.trim();
  if (patch.wan) site.wan = { ...site.wan, ...patch.wan };
  if (patch.websiteTargets) site.websiteTargets = patch.websiteTargets;
  persist();
  return site;
}

export function deleteSite(id: string): boolean {
  if (siteList.length <= 1) {
    throw new Error("Cannot delete the last site");
  }
  const before = siteList.length;
  siteList = siteList.filter((s) => s.id !== id);
  if (siteList.length === before) return false;
  persist();
  return true;
}

export function resetSitesFromSeed(): Site[] {
  siteList = loadSeed();
  persist();
  return siteList;
}

export function addDevice(siteId: string, device: SiteDevice): Site | null {
  const site = getSiteById(siteId);
  if (!site) return null;
  if (!site.devices) site.devices = [];
  if (site.devices.some((d) => d.id === device.id)) {
    throw new Error("Device id already exists on this site");
  }
  site.devices.push(normalizeDevice(device));
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
  site.devices[idx] = normalizeDevice({ ...site.devices[idx], ...patch, id: deviceId });
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

export function exportNetworkDevicesJson(siteId: string): Array<{
  id: string;
  name: string;
  type: string;
  snmpIp: string;
  vendor: string;
}> {
  const site = getSiteById(siteId);
  if (!site) return [];
  return (site.devices ?? [])
    .filter((d) => d.kind === "network" && d.snmpIp)
    .map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      snmpIp: d.snmpIp!,
      vendor: d.vendor
    }));
}
