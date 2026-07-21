import { MapContainer, TileLayer, CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Site, SiteStatus } from "../types";
import "leaflet/dist/leaflet.css";

const VIEW_KEY = "noc.map.view.v1";

type SavedView = { lat: number; lng: number; zoom: number };

function colorFor(state?: string) {
  if (state === "healthy") return "#34d399";
  if (state === "warning") return "#fbbf24";
  if (state === "critical") return "#f87171";
  return "#94a3b8";
}

function loadSavedView(): SavedView | null {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedView;
    if (
      typeof v.lat === "number" &&
      typeof v.lng === "number" &&
      typeof v.zoom === "number" &&
      Number.isFinite(v.lat) &&
      Number.isFinite(v.lng) &&
      Number.isFinite(v.zoom)
    ) {
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveView(lat: number, lng: number, zoom: number) {
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ lat, lng, zoom }));
  } catch {
    /* ignore */
  }
}

function FitBoundsOnce({ sites, enabled }: { sites: Site[]; enabled: boolean }) {
  const map = useMap();
  const done = useRef(false);

  useEffect(() => {
    if (!enabled || done.current || sites.length === 0) return;
    done.current = true;
    const lats = sites.map((s) => s.lat);
    const lngs = sites.map((s) => s.lng);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)]
      ],
      { padding: [40, 40], maxZoom: 8 }
    );
  }, [map, sites, enabled]);

  return null;
}

function PersistView() {
  const map = useMapEvents({
    moveend() {
      const c = map.getCenter();
      saveView(c.lat, c.lng, map.getZoom());
    },
    zoomend() {
      const c = map.getCenter();
      saveView(c.lat, c.lng, map.getZoom());
    }
  });
  return null;
}

function InvalidateOnResize({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const map = useMap();
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    ro.observe(el);
    map.invalidateSize({ animate: false });
    return () => ro.disconnect();
  }, [map, containerRef]);
  return null;
}

function FlyToSite({ site }: { site: Site | null }) {
  const map = useMap();
  useEffect(() => {
    if (!site) return;
    map.flyTo([site.lat, site.lng], Math.max(map.getZoom(), 11), { duration: 0.6 });
  }, [map, site]);
  return null;
}

export function SitesLeafletMap({
  sites,
  statuses,
  height = "100%",
  selectedSiteId,
  onSelectSite
}: {
  sites: Site[];
  statuses: SiteStatus[];
  height?: string | number;
  selectedSiteId?: string | null;
  onSelectSite?: (siteId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [saved] = useState(() => loadSavedView());
  const byId = new Map(statuses.map((s) => [s.siteId, s]));
  const selected = selectedSiteId ? sites.find((s) => s.id === selectedSiteId) ?? null : null;

  const clusters = sites.map((s) => {
    const nearby = sites.filter(
      (o) => Math.abs(o.lat - s.lat) < 0.35 && Math.abs(o.lng - s.lng) < 0.35
    );
    return { site: s, count: nearby.length, status: byId.get(s.id) };
  });

  const seen = new Set<string>();
  const markers = clusters.filter((c) => {
    const key = `${c.site.lat.toFixed(2)},${c.site.lng.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const center: [number, number] = saved ? [saved.lat, saved.lng] : [4.2, 101.9];
  const zoom = saved?.zoom ?? 6;

  return (
    <div
      ref={containerRef}
      className="nocMapRoot"
      style={{ height, width: "100%", minHeight: 120, borderRadius: 12, overflow: "hidden" }}
    >
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: "100%", width: "100%", background: "#0b1215" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <FitBoundsOnce sites={sites} enabled={!saved} />
        <PersistView />
        <InvalidateOnResize containerRef={containerRef} />
        <FlyToSite site={selected} />
        {markers.map(({ site, count, status }) => {
          const isSelected = selectedSiteId === site.id;
          const base = Math.min(8 + count * 3, 22);
          return (
            <CircleMarker
              key={site.id}
              center={[site.lat, site.lng]}
              radius={isSelected ? base + 4 : base}
              eventHandlers={{
                click: () => onSelectSite?.(site.id)
              }}
              pathOptions={{
                color: isSelected ? "#2dd4bf" : colorFor(status?.overall),
                fillColor: colorFor(status?.overall),
                fillOpacity: isSelected ? 0.95 : 0.75,
                weight: isSelected ? 3 : 2
              }}
            >
              <Popup>
                <strong>{site.name}</strong>
                <div>{status?.overall?.toUpperCase() ?? "UNKNOWN"}</div>
                <div>Cluster ~{count} nearby</div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
