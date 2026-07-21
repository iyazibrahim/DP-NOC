import { Link } from "react-router-dom";
import type { ActiveAlert, DeviceRow, Site, SiteStatus } from "../types";
import { collectorOf, uplinkOf } from "../statusLabels";

function toneClass(state: string) {
  if (state === "healthy") return "ok";
  if (state === "critical") return "bad";
  if (state === "warning") return "warn";
  return "unk";
}

function shortLabel(state: string) {
  if (state === "healthy") return "UP";
  if (state === "critical") return "DOWN";
  if (state === "warning") return "WARN";
  return "—";
}

export function MapsOpsRail({
  sites,
  statuses,
  devices,
  alerts,
  selectedSiteId,
  onSelectSite
}: {
  sites: Site[];
  statuses: SiteStatus[];
  devices: DeviceRow[];
  alerts?: ActiveAlert[];
  selectedSiteId: string | null;
  onSelectSite: (siteId: string) => void;
}) {
  const firing =
    alerts?.filter((a) => a.status === "firing") ??
    [];
  const hotDevices = devices.filter((d) => (d.alertCount ?? 0) > 0);
  const hasHotspots = firing.length > 0 || hotDevices.length > 0;

  return (
    <aside className="mapsOpsRail">
      <div className="mapsOpsBlock">
        <div className="tableTitle">Site uplink</div>
        <div className="mapsOpsList">
          {sites.map((s) => {
            const st = statuses.find((x) => x.siteId === s.id);
            const up = uplinkOf(st);
            const active = selectedSiteId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                className={`mapsOpsRow mapsOpsRow--${toneClass(up.state)}${active ? " mapsOpsRow--active" : ""}`}
                onClick={() => onSelectSite(s.id)}
              >
                <span className="mapsOpsName">{s.name}</span>
                <span className={`mapsOpsBadge mapsOpsBadge--${toneClass(up.state)}`}>
                  {shortLabel(up.state)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mapsOpsBlock">
        <div className="tableTitle">Collectors</div>
        <div className="mapsOpsList">
          {sites.map((s) => {
            const st = statuses.find((x) => x.siteId === s.id);
            const col = collectorOf(st);
            const active = selectedSiteId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                className={`mapsOpsRow mapsOpsRow--${toneClass(col.state)}${active ? " mapsOpsRow--active" : ""}`}
                onClick={() => onSelectSite(s.id)}
              >
                <span className="mapsOpsName">{s.name}</span>
                <span className={`mapsOpsBadge mapsOpsBadge--${toneClass(col.state)}`}>
                  {shortLabel(col.state)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mapsOpsBlock">
        <div className="tableTitle">Hotspots</div>
        {!hasHotspots ? (
          <p className="muted mapsOpsEmpty">No hotspots</p>
        ) : (
          <div className="mapsOpsList">
            {firing.slice(0, 8).map((a, i) => {
              const siteId = a.labels?.site ?? "";
              const siteName =
                sites.find((s) => s.id === siteId)?.name ?? (siteId || "—");
              return (
                <button
                  key={`${a.labels?.alertname ?? "a"}-${i}`}
                  type="button"
                  className="mapsOpsRow mapsOpsRow--bad"
                  onClick={() => siteId && onSelectSite(siteId)}
                >
                  <span className="mapsOpsName">
                    {a.annotations?.summary ?? a.labels?.alertname ?? "Alert"}
                    <span className="muted"> · {siteName}</span>
                  </span>
                  <span className="mapsOpsBadge mapsOpsBadge--bad">FIRE</span>
                </button>
              );
            })}
            {hotDevices.slice(0, 6).map((d) => (
              <button
                key={`${d.siteId}-${d.id}`}
                type="button"
                className="mapsOpsRow mapsOpsRow--warn"
                onClick={() => onSelectSite(d.siteId)}
              >
                <span className="mapsOpsName">
                  {d.name}
                  <span className="muted"> · {d.siteName}</span>
                </span>
                <span className="mapsOpsBadge mapsOpsBadge--warn">{d.alertCount}</span>
              </button>
            ))}
          </div>
        )}
        <p className="muted mapsOpsHint">
          <Link to="/alerts">Open alerts</Link>
        </p>
      </div>
    </aside>
  );
}
