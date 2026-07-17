import type { ActiveAlert, Site, SiteStatus } from "../types";
import { StatusPill } from "./StatusPill";

export function SiteDetailPanel({
  site,
  status,
  alerts,
  grafanaBaseUrl
}: {
  site: Site | null;
  status: SiteStatus | null;
  alerts: ActiveAlert[];
  grafanaBaseUrl: string;
}) {
  if (!site || !status) {
    return (
      <div className="panel" aria-label="Site details">
        <div className="panelHeader">
          <div>
            <div className="panelTitle">SELECT A SITE</div>
            <div className="panelHint" style={{ marginTop: 6 }}>
              Tap a dot on the map.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const firingAlerts = alerts.filter((a) => a.status === "firing");
  const resolvedAlerts = alerts.filter((a) => a.status === "resolved");
  const grafanaLink = (() => {
    const hasQuery = grafanaBaseUrl.includes("?");
    const sep = hasQuery ? "&" : "?";
    return `${grafanaBaseUrl}${sep}var-site=${encodeURIComponent(site.id)}`;
  })();

  return (
    <div className="panel" aria-label="Site details">
      <div className="panelHeader">
        <div>
          <div className="panelTitle">{site.name}</div>
          <div className="panelHint" style={{ marginTop: 6 }}>
            {site.id} • {status.overall.toUpperCase()}
          </div>
        </div>
        <StatusPill state={status.overall} />
      </div>

      <div className="kvRow">
        <div className="kvKey">WAN HEALTH</div>
        <div className="kvVal">{status.wan.state.toUpperCase()}</div>
      </div>
      <div className="kvRow">
        <div className="kvKey">WEBSITE CHECKS</div>
        <div className="kvVal">{status.websites.state.toUpperCase()}</div>
      </div>
      <div className="kvRow">
        <div className="kvKey">LAN/SNMP</div>
        <div className="kvVal">{status.lan.state.toUpperCase()}</div>
      </div>

      <div className="sectionTitle">WEBSITES</div>
      {site.websiteTargets.map((w, idx) => (
        <div
          className="kvRow"
          key={`${w.url}-${idx}`}
          style={{ padding: "9px 12px" }}
        >
          <div className="kvKey">{w.name}</div>
          <div className="kvVal">{w.url.replace(/^https?:\/\//, "")}</div>
        </div>
      ))}

      <div className="sectionTitle">ALERTS</div>
      <div className="kvRow">
        <div className="kvKey">FIRING / RESOLVED</div>
        <div className="kvVal">
          {firingAlerts.length} / {resolvedAlerts.length}
        </div>
      </div>

      {firingAlerts.length > 0 ? (
        <div className="alertList">
          {firingAlerts.slice(0, 5).map((a, idx) => (
            <div className="alertItem" key={idx}>
              <div className="alertTop">
                <div className="alertName">
                  {a.labels.alertname ?? a.labels.alert ?? "alert"}
                </div>
                <div className="alertStatus">
                  {a.status.toUpperCase()}
                </div>
              </div>
              {a.annotations?.summary && (
                <div className="alertSummary">{a.annotations.summary}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="panelHint">No firing alerts.</div>
      )}

      <div className="btnRow" style={{ marginTop: 16 }}>
        <a
          href={grafanaLink}
          target="_blank"
          rel="noreferrer"
          style={{
            textDecoration: "none",
            display: "inline-block",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(245, 158, 11, 0.55)",
            background: "rgba(245, 158, 11, 0.16)",
            fontWeight: 800,
            color: "#e5e7eb"
          }}
        >
          OPEN GRAFANA
        </a>
      </div>
    </div>
  );
}

