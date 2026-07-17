import sites from "../../data/seed-sites.json";

export type Site = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  websiteTargets: Array<{ name: string; url: string }>;
  wan: {
    dnsTarget: string; // e.g. 1.1.1.1
    vpsTarget: string; // e.g. VPS public IP
  };
  lan?: {
    snmpTargetIp?: string;
  };
};

export const siteList: Site[] = sites as Site[];

export function getSiteById(id: string) {
  return siteList.find((s) => s.id === id) ?? null;
}

