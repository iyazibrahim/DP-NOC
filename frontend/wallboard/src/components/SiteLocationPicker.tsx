import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

function MapClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

export function SiteLocationPicker({
  lat,
  lng,
  onChange,
  height = 280
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  height?: number;
}) {
  return (
    <div style={{ height, width: "100%", borderRadius: 12, overflow: "hidden" }}>
      <MapContainer
        center={[lat, lng]}
        zoom={13}
        style={{ height: "100%", width: "100%", background: "#0b1215" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <MapClickHandler onPick={onChange} />
        <Marker
          position={[lat, lng]}
          icon={defaultIcon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const pos = e.target.getLatLng();
              onChange(pos.lat, pos.lng);
            }
          }}
        />
      </MapContainer>
      <p className="muted" style={{ marginTop: 8 }}>
        Click the map or drag the pin to set coordinates ({lat.toFixed(5)}, {lng.toFixed(5)}).
      </p>
    </div>
  );
}
