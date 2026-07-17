export type DomainState = "healthy" | "warning" | "critical" | "unknown";

export type DomainStatus = {
  state: DomainState;
  notes?: string;
};

export type SiteStatus = {
  siteId: string;
  lat?: number;
  lng?: number;
  wan: DomainStatus;
  websites: DomainStatus;
  lan: DomainStatus;
  alerts: {
    firing: number;
    resolved: number;
  };
  overall: DomainState;
};

export type Site = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  websiteTargets: Array<{ name: string; url: string }>;
  wan: { dnsTarget: string; vpsTarget: string };
  lan?: { snmpTargetIp?: string };
};

export type ActiveAlert = {
  status: "firing" | "resolved";
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
};

