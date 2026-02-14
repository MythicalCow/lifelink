"use client";

import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip } from "react-leaflet";
import type { SensorNode, SuggestedNode } from "@/types/sensor";
import "leaflet/dist/leaflet.css";

interface LeafletMapProps {
  center: [number, number];
  zoom: number;
  nodes: SensorNode[];
  suggestions: SuggestedNode[];
}

export function LeafletMap({ center, zoom, nodes, suggestions }: LeafletMapProps) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      minZoom={13}
      maxZoom={18}
      zoomControl={false}
      attributionControl={false}
      className="h-full w-full"
      style={{ background: "var(--surface)" }}
    >
      {/* Light minimal tile layer — CartoDB Positron */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
      />

      {/* Coverage perimeters */}
      {nodes.map((node) => (
        <Circle
          key={`perimeter-${node.id}`}
          center={[node.lat, node.lng]}
          radius={node.radius ?? 170}
          pathOptions={{
            color: "var(--accent)",
            weight: 1,
            opacity: 0.25,
            fillColor: "var(--accent)",
            fillOpacity: 0.06,
          }}
        />
      ))}

      {/* Active sensor nodes — hollow rings */}
      {nodes.map((node) => (
        <CircleMarker
          key={`node-${node.id}`}
          center={[node.lat, node.lng]}
          radius={7}
          pathOptions={{
            color: "#6b9e8a",
            weight: 2,
            opacity: 0.9,
            fillColor: "transparent",
            fillOpacity: 0,
          }}
        >
          <Tooltip
            direction="top"
            offset={[0, -10]}
            className="lifelink-tooltip"
          >
            {node.label ?? `Sensor ${node.id}`}
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Suggested placement nodes — dashed amber */}
      {suggestions.map((node) => (
        <CircleMarker
          key={`suggest-${node.id}`}
          center={[node.lat, node.lng]}
          radius={7}
          pathOptions={{
            color: "#d4956a",
            weight: 1.5,
            opacity: 0.6,
            dashArray: "4 3",
            fillColor: "#d4956a",
            fillOpacity: 0.06,
          }}
        >
          <Tooltip
            direction="top"
            offset={[0, -10]}
            className="lifelink-tooltip"
          >
            {node.reason}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
