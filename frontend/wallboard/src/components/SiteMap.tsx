import type { DomainState, SiteStatus } from "../types";

function project(lat: number, lng: number, bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
  const pad = 6;
  const latSpan = bounds.maxLat - bounds.minLat || 1;
  const lngSpan = bounds.maxLng - bounds.minLng || 1;

  const xPct = pad + ((lng - bounds.minLng) / lngSpan) * (100 - pad * 2);
  const yPct = pad + ((bounds.maxLat - lat) / latSpan) * (100 - pad * 2);
  return { xPct, yPct };
}

function dotClass(state: DomainState) {
  if (state === "healthy") return "siteDot siteDotHealthy";
  if (state === "warning") return "siteDot siteDotWarning";
  if (state === "critical") return "siteDot siteDotCritical dotPulse";
  return "siteDot siteDotUnknown";
}

export function SiteMap({
  statuses,
  selectedSiteId,
  onSelect
}: {
  statuses: SiteStatus[];
  selectedSiteId: string | null;
  onSelect: (siteId: string) => void;
}) {
  const withCoords = statuses.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (withCoords.length === 0) return null;

  const minLat = Math.min(...withCoords.map((s) => s.lat as number));
  const maxLat = Math.max(...withCoords.map((s) => s.lat as number));
  const minLng = Math.min(...withCoords.map((s) => s.lng as number));
  const maxLng = Math.max(...withCoords.map((s) => s.lng as number));

  const bounds = { minLat, maxLat, minLng, maxLng };

  return (
    <div aria-label="Site map" style={{ position: "absolute", inset: 0 }}>
      {statuses.map((s) => {
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return null;
        const { xPct, yPct } = project(s.lat as number, s.lng as number, bounds);
        const cls = dotClass(s.overall);
        const selected = selectedSiteId === s.siteId;

        return (
          <div
            key={s.siteId}
            className={cls}
            role="button"
            tabIndex={0}
            aria-label={`Select ${s.siteId}`}
            title={`${s.siteId} (${s.overall})`}
            style={{
              left: `${xPct}%`,
              top: `${yPct}%`,
              transform: "translate(-50%, -50%)",
              boxShadow: selected ? "0 0 0 10px rgba(245,158,11,0.12)" : undefined
            }}
            onClick={() => onSelect(s.siteId)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect(s.siteId);
            }}
          />
        );
      })}
    </div>
  );
}

