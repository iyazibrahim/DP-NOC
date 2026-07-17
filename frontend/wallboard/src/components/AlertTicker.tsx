import type { ActiveAlert } from "../types";
import { StatusPill } from "./StatusPill";

function alertTitle(a: ActiveAlert) {
  const name = a.labels?.alertname ?? a.labels?.alert ?? "alert";
  const site = a.labels?.site ?? "unknown-site";
  return `${name} @ ${site}`;
}

export function AlertTicker({ alerts }: { alerts: ActiveAlert[] }) {
  const items = alerts.slice(0, 10);

  return (
    <div className="ticker" aria-label="Alert ticker">
      <div className="tickerRow">
        <div className="tickerTitle">ACTIVE ALERTS</div>
        <div className="marquee">
          <div className="marqueeInner">
            {items.length === 0 ? (
              <span className="marqueeItem">
                <span className="marqueeBullet" />
                NO ALERTS
              </span>
            ) : (
              items.map((a, idx) => (
                <span className="marqueeItem" key={idx}>
                  <span className="marqueeBullet" />
                  <span style={{ fontWeight: 800 }}>{alertTitle(a)}</span>
                  <span style={{ color: "rgba(229,231,235,0.75)" }}>
                    {a.status.toUpperCase()}
                  </span>
                </span>
              ))
            )}
            {items.length > 0 &&
              items.map((a, idx) => (
                <span className="marqueeItem" key={`dup-${idx}`}>
                  <span className="marqueeBullet" />
                  <span style={{ fontWeight: 800 }}>{alertTitle(a)}</span>
                  <span style={{ color: "rgba(229,231,235,0.75)" }}>
                    {a.status.toUpperCase()}
                  </span>
                </span>
              ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <StatusPill state={alerts.some((a) => a.status === "firing") ? "critical" : "healthy"} />
        </div>
      </div>
    </div>
  );
}

