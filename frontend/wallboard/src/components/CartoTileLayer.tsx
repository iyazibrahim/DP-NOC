import { useEffect, useState } from "react";
import { TileLayer } from "react-leaflet";
import { useAuth } from "@/auth/AuthContext";
import { getMapSettings } from "@/api";

const FALLBACK_TILE =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

/** Module cache so every map mount does not re-hit /api/settings/map. */
let cachedTileUrl: string | null = null;
let inflight: Promise<string> | null = null;

async function loadTileUrl(token: string): Promise<string> {
  // Only cache a URL that includes the Carto key — avoid sticky keyless watermark.
  if (cachedTileUrl && cachedTileUrl.includes("?key=")) return cachedTileUrl;
  if (!inflight) {
    inflight = getMapSettings(token)
      .then((r) => {
        const next = r.tileUrl || FALLBACK_TILE;
        if (r.configured && next.includes("?key=")) {
          cachedTileUrl = next;
        }
        return next;
      })
      .catch(() => FALLBACK_TILE)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Dark Carto basemap tiles. API key comes from noc-app env at runtime
 * (NEXT_PUBLIC_CARTO_API_KEY) via GET /api/settings/map — never baked into Vite.
 */
export function CartoTileLayer() {
  const { token } = useAuth();
  const [url, setUrl] = useState(cachedTileUrl ?? FALLBACK_TILE);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    loadTileUrl(token).then((next) => {
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <TileLayer
      key={url}
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO'
      url={url}
    />
  );
}
