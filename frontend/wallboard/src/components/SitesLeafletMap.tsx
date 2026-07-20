import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { useEffect } from "react";
import type { Site, SiteStatus } from "../types";
import "leaflet/dist/leaflet.css";

function colorFor(state?: string) {
  if (state === "healthy") return "#22c55e";
  if (state === "warning") return "#fbbf24";
  if (state === "critical") return "#ef4444";
  return "#94a3b8";
}

function FitBounds({ sites }: { sites: Site[] }) {
  const map = useMap();
  useEffect(() => {
    if (sites.length === 0) return;
    const lats = sites.map((s) => s.lat);
    const lngs = sites.map((s) => s.lng);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)]
      ],
      { padding: [40, 40], maxZoom: 8 }
    );
  }, [map, sites]);
  return null;
}

export function SitesLeafletMap({
  sites,
  statuses,
  height = "100%"
}: {
  sites: Site[];
  statuses: SiteStatus[];
  height?: string | number;
}) {
  const byId = new Map(statuses.map((s) => [s.siteId, s]));

  // Simple visual clustering: group nearby sites and show count in popup
  const clusters = sites.map((s) => {
    const nearby = sites.filter(
      (o) =>
        Math.abs(o.lat - s.lat) < 0.35 &&
        Math.abs(o.lng - s.lng) < 0.35
    );
    return { site: s, count: nearby.length, status: byId.get(s.id) };
  });

  // Deduplicate markers for overlapping coords by keeping highest count per rounded cell
  const seen = new Set<string>();
  const markers = clusters.filter((c) => {
    const key = `${c.site.lat.toFixed(2)},${c.site.lng.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div style={{ height, width: "100%", minHeight: 240, borderRadius: 12, overflow: "hidden" }}>
      <MapContainer
        center={[4.2, 101.9]}
        zoom={6}
        style={{ height: "100%", width: "100%", background: "#0b1215" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <FitBounds sites={sites} />
        {markers.map(({ site, count, status }) => (
          <CircleMarker
            key={site.id}
            center={[site.lat, site.lng]}
            radius={Math.min(8 + count * 3, 22)}
            pathOptions={{
              color: colorFor(status?.overall),
              fillColor: colorFor(status?.overall),
              fillOpacity: 0.75,
              weight: 2
            }}
          >
            <Popup>
              <strong>{site.name}</strong>
              <div>{status?.overall?.toUpperCase() ?? "UNKNOWN"}</div>
              <div>Cluster ~{count} nearby</div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
