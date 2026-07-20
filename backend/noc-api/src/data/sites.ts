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

function loadSites(): Site[] {
  const candidates = [
    path.join(__dirname, "../../data/seed-sites.json"),
    path.join(process.cwd(), "data/seed-sites.json")
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8");
      return JSON.parse(raw) as Site[];
    }
  }
  throw new Error("seed-sites.json not found");
}

export const siteList: Site[] = loadSites();

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
