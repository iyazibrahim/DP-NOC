import type { DomainState, Site, SiteStatus } from "../types";
import { collectorOf, uplinkOf } from "../statusLabels";

function stateTone(state: DomainState | string): "ok" | "bad" | "warn" | "unk" {
  if (state === "healthy") return "ok";
  if (state === "critical") return "bad";
  if (state === "warning") return "warn";
  return "unk";
}

function stateLabel(state: DomainState | string): string {
  if (state === "healthy") return "UP";
  if (state === "critical") return "DOWN";
  if (state === "warning") return "DEGRADED";
  return "UNKNOWN";
}

function cardClass(tone: string, compact?: boolean) {
  return `signalCard signalCard--${tone}${compact ? " signalCardCompact" : ""}`;
}

function sameLabel(a?: string, b?: string) {
  return Boolean(a?.trim()) && a!.trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** Big green/red uplink card for one site. */
export function UplinkStatusCard({
  site,
  status,
  title,
  compact
}: {
  site?: Site;
  status?: SiteStatus | null;
  title?: string;
  compact?: boolean;
}) {
  const up = uplinkOf(status);
  const tone = stateTone(up.state);
  const eyebrow = title?.trim() || "Uplink / Internet";
  const siteName = site?.name ?? "Pick a site";
  return (
    <div className={cardClass(tone, compact)} title={up.notes || undefined}>
      {!sameLabel(eyebrow, siteName) ? <div className="signalCardEyebrow">{eyebrow}</div> : null}
      <div className="signalCardName">{siteName}</div>
      <div className="signalCardState">{stateLabel(up.state)}</div>
    </div>
  );
}

/** Big green/red collector card for one site. */
export function CollectorStatusCard({
  site,
  status,
  title,
  compact
}: {
  site?: Site;
  status?: SiteStatus | null;
  title?: string;
  compact?: boolean;
}) {
  const col = collectorOf(status);
  const tone = stateTone(col.state);
  const eyebrow = title?.trim() || "Collector";
  const siteName = site?.name ?? "Pick a site";
  const collectorName =
    site?.devices?.find((d) => (d.kind ?? "network") === "server")?.name ?? "Collector";
  return (
    <div className={cardClass(tone, compact)} title={col.notes || undefined}>
      {!sameLabel(eyebrow, siteName) ? <div className="signalCardEyebrow">{eyebrow}</div> : null}
      <div className="signalCardName">{siteName}</div>
      {!compact && !sameLabel(collectorName, siteName) && !sameLabel(collectorName, eyebrow) ? (
        <div className="signalCardSub">{collectorName}</div>
      ) : null}
      <div className="signalCardState">{stateLabel(col.state)}</div>
    </div>
  );
}

/** Board of LED-style rows for every site (uplink + collector). */
export function SiteSignalBoard({
  sites,
  statuses,
  compact
}: {
  sites: Site[];
  statuses: SiteStatus[];
  compact?: boolean;
}) {
  return (
    <div className={`signalBoard${compact ? " signalBoardCompact" : ""}`}>
      {!compact ? <div className="widgetTitle">Sites at a glance</div> : null}
      <div className="signalBoardList">
        {sites.map((s) => {
          const st = statuses.find((x) => x.siteId === s.id);
          const up = uplinkOf(st);
          const col = collectorOf(st);
          return (
            <div key={s.id} className="signalBoardRow">
              <div className="signalBoardSite">{s.name}</div>
              <div className="signalLeds">
                <span className={`signalLed signalLed--${stateTone(col.state)}`} title={col.notes}>
                  <i /> {compact ? "Col" : "Collector"} {stateLabel(col.state)}
                </span>
                <span className={`signalLed signalLed--${stateTone(up.state)}`} title={up.notes}>
                  <i /> {compact ? "Up" : "Uplink"} {stateLabel(up.state)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Big green/red card for one local SNMP device. */
export function SnmpDeviceStatusCard({
  site,
  status,
  deviceId,
  title,
  compact
}: {
  site?: Site;
  status?: SiteStatus | null;
  deviceId?: string;
  title?: string;
  compact?: boolean;
}) {
  const inventory = site?.devices?.find((d) => d.id === deviceId);
  const live = status?.localDeviceStates?.find((d) => d.deviceId === deviceId);
  const state = live?.state ?? "unknown";
  const tone = stateTone(state);
  const name = live?.name ?? inventory?.name ?? "Pick a device";
  const snmpIp = live?.snmpIp ?? inventory?.snmpIp;
  const eyebrow = title?.trim() || "SNMP device";
  const titleOwnsName = Boolean(title?.trim()) && sameLabel(title, name);
  return (
    <div className={cardClass(tone, compact)} title={live?.notes || undefined}>
      {!titleOwnsName && !sameLabel(eyebrow, name) ? (
        <div className="signalCardEyebrow">{eyebrow}</div>
      ) : null}
      {!titleOwnsName ? <div className="signalCardName">{name}</div> : null}
      {!compact ? (
        <div className={titleOwnsName ? "signalCardName" : "signalCardSub"}>
          {site?.name ?? "—"}
          {snmpIp ? ` · ${snmpIp}` : ""}
        </div>
      ) : titleOwnsName ? (
        <div className="signalCardSub truncate">{snmpIp ?? site?.name ?? ""}</div>
      ) : null}
      <div className="signalCardState">{stateLabel(state)}</div>
    </div>
  );
}

/** Per-device SNMP LEDs — one site or all sites. */
export function LocalDevicesSignalBoard({
  sites,
  statuses,
  siteId,
  title,
  compact
}: {
  sites: Site[];
  statuses: SiteStatus[];
  siteId?: string;
  title?: string;
  compact?: boolean;
}) {
  const rows = (siteId ? sites.filter((s) => s.id === siteId) : sites).flatMap((s) => {
    const st = statuses.find((x) => x.siteId === s.id);
    const devices = st?.localDeviceStates ?? [];
    if (devices.length === 0) {
      return [
        {
          key: `${s.id}-empty`,
          siteName: s.name,
          deviceName: "No local devices",
          snmpIp: undefined as string | undefined,
          state: "unknown" as DomainState,
          notes: "Add network gear with an SNMP IP on this site" as string | undefined
        }
      ];
    }
    return devices.map((d) => ({
      key: `${s.id}-${d.deviceId}`,
      siteName: s.name,
      deviceName: d.name,
      snmpIp: d.snmpIp,
      state: d.state,
      notes: d.notes
    }));
  });

  return (
    <div className={`signalBoard${compact ? " signalBoardCompact" : ""}`}>
      {!compact && !title?.trim() ? (
        <div className="widgetTitle">Local devices (SNMP)</div>
      ) : null}
      <div className="signalBoardList">
        {rows.map((r) => (
          <div key={r.key} className="signalBoardRow">
            <div className="signalBoardSite">
              {!siteId ? <span className="muted">{r.siteName} · </span> : null}
              {r.deviceName}
              {!compact && r.snmpIp ? <div className="muted">{r.snmpIp}</div> : null}
            </div>
            <div className="signalLeds">
              <span className={`signalLed signalLed--${stateTone(r.state)}`} title={r.notes}>
                <i /> {compact ? "" : "SNMP "}
                {stateLabel(r.state)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
