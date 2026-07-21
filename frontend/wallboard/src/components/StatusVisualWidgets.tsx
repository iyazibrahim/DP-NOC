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

/** Big green/red uplink card for one site. */
export function UplinkStatusCard({
  site,
  status,
  title
}: {
  site?: Site;
  status?: SiteStatus | null;
  title?: string;
}) {
  const up = uplinkOf(status);
  const tone = stateTone(up.state);
  return (
    <div className={`signalCard signalCard--${tone}`}>
      <div className="signalCardEyebrow">{title?.trim() || "Uplink / Internet"}</div>
      <div className="signalCardName">{site?.name ?? "Pick a site"}</div>
      <div className="signalCardState">{stateLabel(up.state)}</div>
      {up.notes ? <div className="signalCardNotes">{up.notes}</div> : null}
      <div className="signalCardHint">Green = reachable · Red = down</div>
    </div>
  );
}

/** Big green/red collector card for one site. */
export function CollectorStatusCard({
  site,
  status,
  title
}: {
  site?: Site;
  status?: SiteStatus | null;
  title?: string;
}) {
  const col = collectorOf(status);
  const tone = stateTone(col.state);
  const collectorName =
    site?.devices?.find((d) => (d.kind ?? "network") === "server")?.name ?? "Collector";
  return (
    <div className={`signalCard signalCard--${tone}`}>
      <div className="signalCardEyebrow">{title?.trim() || "Collector"}</div>
      <div className="signalCardName">{site?.name ?? "Pick a site"}</div>
      <div className="signalCardSub">{collectorName}</div>
      <div className="signalCardState">{stateLabel(col.state)}</div>
      {col.notes ? <div className="signalCardNotes">{col.notes}</div> : null}
    </div>
  );
}

/** Board of LED-style rows for every site (uplink + collector). */
export function SiteSignalBoard({
  sites,
  statuses
}: {
  sites: Site[];
  statuses: SiteStatus[];
}) {
  return (
    <div className="signalBoard">
      <div className="widgetTitle">Sites at a glance</div>
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
                  <i /> Collector {stateLabel(col.state)}
                </span>
                <span className={`signalLed signalLed--${stateTone(up.state)}`} title={up.notes}>
                  <i /> Uplink {stateLabel(up.state)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Per-device SNMP LEDs — one site or all sites. */
export function LocalDevicesSignalBoard({
  sites,
  statuses,
  siteId,
  title
}: {
  sites: Site[];
  statuses: SiteStatus[];
  siteId?: string;
  title?: string;
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
    <div className="signalBoard">
      <div className="widgetTitle">{title?.trim() || "Local devices (SNMP)"}</div>
      <div className="signalBoardList">
        {rows.map((r) => (
          <div key={r.key} className="signalBoardRow">
            <div className="signalBoardSite">
              {!siteId ? <span className="muted">{r.siteName} · </span> : null}
              {r.deviceName}
              {r.snmpIp ? <div className="muted">{r.snmpIp}</div> : null}
            </div>
            <div className="signalLeds">
              <span className={`signalLed signalLed--${stateTone(r.state)}`} title={r.notes}>
                <i /> SNMP {stateLabel(r.state)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
