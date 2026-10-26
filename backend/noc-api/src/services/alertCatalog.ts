export const ALERT_TYPE_IDS = ["uplink", "collector", "website", "device", "snmp", "bandwidth"] as const;

export type AlertTypeId = (typeof ALERT_TYPE_IDS)[number];

export type AlertTypeDef = {
  id: AlertTypeId;
  label: string;
  alertname: string;
  severity: "critical" | "warning";
  defaultEnabled: boolean;
  description: string;
};

/** The only alert types the wallboard opens and pages. */
export const ALERT_TYPES: AlertTypeDef[] = [
  {
    id: "uplink",
    label: "Internet",
    alertname: "SiteUplinkDown",
    severity: "critical",
    defaultEnabled: true,
    description: "Both internet paths failed."
  },
  {
    id: "collector",
    label: "Probe",
    alertname: "SiteCollectorDown",
    severity: "critical",
    defaultEnabled: true,
    description: "The monitoring box is not reporting."
  },
  {
    id: "website",
    label: "Website",
    alertname: "SiteWebsiteDown",
    severity: "critical",
    defaultEnabled: true,
    description: "A public website check failed."
  },
  {
    id: "device",
    label: "Network device",
    alertname: "SiteLocalDeviceDown",
    severity: "critical",
    defaultEnabled: true,
    description: "A device is not answering ping."
  },
  {
    id: "snmp",
    label: "SNMP",
    alertname: "SiteSnmpDegraded",
    severity: "warning",
    defaultEnabled: false,
    description: "A device answers ping but not SNMP."
  },
  {
    id: "bandwidth",
    label: "Bandwidth",
    alertname: "ClientBandwidth",
    severity: "warning",
    defaultEnabled: true,
    description: "A Wi-Fi client crossed a daily download, upload, or guest cap."
  }
];

export function defaultAlertTypes(): Record<AlertTypeId, boolean> {
  return {
    uplink: true,
    collector: true,
    website: true,
    device: true,
    snmp: false,
    bandwidth: true
  };
}

export function alertTypeByKind(kind: string): AlertTypeDef | undefined {
  return ALERT_TYPES.find((row) => row.id === kind);
}
