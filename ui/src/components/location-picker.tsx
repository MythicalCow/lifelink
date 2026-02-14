"use client";

import { useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Marker,
  useMapEvents,
  Tooltip,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface LocationPickerProps {
  center: [number, number];
  zoom: number;
  selectedLat: number | null;
  selectedLng: number | null;
  existingNodes: { lat: number; lng: number; label: string }[];
  onSelect: (lat: number, lng: number) => void;
}

// Custom marker icon for selected location
const selectedIcon = L.divIcon({
  className: "selected-location-marker",
  html: `<div style="
    width: 24px;
    height: 24px;
    background: #6b9e8a;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    transform: translate(-50%, -50%);
  "></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function ClickHandler({
  onSelect,
}: {
  onSelect: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function LocationPicker({
  center,
  zoom,
  selectedLat,
  selectedLng,
  existingNodes,
  onSelect,
}: LocationPickerProps) {
  const handleClick = useCallback(
    (lat: number, lng: number) => {
      onSelect(lat, lng);
    },
    [onSelect],
  );

  return (
    <div className="relative h-full w-full rounded-xl overflow-hidden ring-1 ring-[var(--foreground)]/[0.06]">
      {/* Instructions overlay */}
      <div className="absolute top-2 left-2 right-2 z-[1000] pointer-events-none">
        <div className="inline-block rounded-lg bg-white/90 px-3 py-1.5 text-[11px] font-medium text-[var(--foreground)] shadow-sm backdrop-blur-sm">
          📍 Click to set node location
        </div>
      </div>

      <MapContainer
        center={center}
        zoom={zoom}
        minZoom={12}
        maxZoom={19}
        zoomControl={false}
        attributionControl={false}
        className="h-full w-full"
        style={{ background: "#f8f4f0" }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
        />

        <ClickHandler onSelect={handleClick} />

        {/* Existing nodes */}
        {existingNodes.map((node, idx) => (
          <CircleMarker
            key={`existing-${idx}`}
            center={[node.lat, node.lng]}
            radius={6}
            pathOptions={{
              color: idx < 3 ? "#f59e0b" : "#6b9e8a",
              weight: 2,
              opacity: 0.8,
              fillColor: idx < 3 ? "#f59e0b" : "#6b9e8a",
              fillOpacity: 0.3,
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} className="lifelink-tooltip">
              <span className="font-medium">{node.label}</span>
              {idx < 3 && (
                <span className="ml-1 text-amber-600">(anchor)</span>
              )}
            </Tooltip>
          </CircleMarker>
        ))}

        {/* Selected location marker */}
        {selectedLat !== null && selectedLng !== null && (
          <Marker position={[selectedLat, selectedLng]} icon={selectedIcon}>
            <Tooltip
              direction="top"
              offset={[0, -16]}
              permanent
              className="lifelink-tooltip"
            >
              <span className="tabular-nums text-[10px]">
                {selectedLat.toFixed(5)}, {selectedLng.toFixed(5)}
              </span>
            </Tooltip>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
