"use client";

import {
  MapContainer,
  TileLayer,
  Circle,
  CircleMarker,
  Polyline,
  Tooltip,
} from "react-leaflet";
import type { SensorNode, SuggestedNode } from "@/types/sensor";
import type { SimState, Transmission } from "@/simulation/types";
import { PacketType } from "@/simulation/types";
import "leaflet/dist/leaflet.css";

interface LeafletMapProps {
  center: [number, number];
  zoom: number;
  nodes: SensorNode[];
  suggestions: SuggestedNode[];
  simState: SimState | null;
}

/** Map node visual state → color */
function nodeColor(
  nodeId: number,
  simState: SimState | null,
): string {
  if (!simState) return "#6b9e8a";
  const ns = simState.nodeStates.find((n) => n.id === nodeId);
  if (!ns) return "#6b9e8a";
  switch (ns.state) {
    case "tx":
      return "#4ade80"; // bright green
    case "rx":
      return "#60a5fa"; // blue
    default:
      return "#6b9e8a"; // sage
  }
}

/** Map node state → border weight */
function nodeWeight(nodeId: number, simState: SimState | null): number {
  if (!simState) return 2;
  const ns = simState.nodeStates.find((n) => n.id === nodeId);
  if (!ns) return 2;
  return ns.state === "idle" ? 2 : 3;
}

/** Transmission line color by packet type / outcome */
function txColor(tx: Transmission): string {
  if (tx.status === "collision") return "#ef4444";
  if (tx.status === "captured") return "#f59e0b";

  switch (tx.packetType) {
    case PacketType.HEARTBEAT:
      return "#6b9e8a";
    case PacketType.DATA:
      return "#3b82f6";
    case PacketType.ACK:
      return "#4ade80";
  }
}

function txOpacity(tx: Transmission): number {
  if (tx.status === "collision") return 0.72;
  if (tx.status === "captured") return 0.8;
  return tx.packetType === PacketType.HEARTBEAT ? 0.15 : 0.6;
}

function txWeight(tx: Transmission): number {
  if (tx.status === "collision") return 2.6;
  if (tx.status === "captured") return 2.8;
  return tx.packetType === PacketType.HEARTBEAT ? 1 : 2.5;
}

function txDashArray(tx: Transmission): string | undefined {
  if (tx.status === "collision") return "2 4";
  if (tx.packetType === PacketType.HEARTBEAT) return "3 4";
  return undefined;
}

export function LeafletMap({
  center,
  zoom,
  nodes,
  suggestions,
  simState,
}: LeafletMapProps) {
  const transmissions = simState?.transmissions ?? [];

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
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
      />

      {/* Transmission lines */}
      {transmissions.map((tx, i) => (
        <Polyline
          key={`tx-${tx.createdTick}-${i}`}
          positions={[
            [tx.fromLat, tx.fromLng],
            [tx.toLat, tx.toLng],
          ]}
          pathOptions={{
            color: txColor(tx),
            weight: txWeight(tx),
            opacity: txOpacity(tx),
            dashArray: txDashArray(tx),
          }}
        />
      ))}

      {/* Coverage perimeters */}
      {nodes.map((node) => (
        <Circle
          key={`perimeter-${node.id}`}
          center={[node.lat, node.lng]}
          radius={node.radius ?? 170}
          pathOptions={{
            color: nodeColor(node.id, simState),
            weight: 1,
            opacity: 0.2,
            fillColor: nodeColor(node.id, simState),
            fillOpacity: 0.04,
          }}
        />
      ))}

      {/* Active sensor nodes */}
      {nodes.map((node) => {
        const color = nodeColor(node.id, simState);
        const weight = nodeWeight(node.id, simState);
        const ns = simState?.nodeStates.find((n) => n.id === node.id);

        return (
          <CircleMarker
            key={`node-${node.id}`}
            center={[node.lat, node.lng]}
            radius={7}
            pathOptions={{
              color,
              weight,
              opacity: 0.9,
              fillColor: "transparent",
              fillOpacity: 0,
            }}
          >
            <Tooltip direction="top" offset={[0, -10]} className="lifelink-tooltip">
              <span className="font-semibold">{node.label ?? `Node ${node.id}`}</span>
              {ns && (
                <span className="block opacity-60">
                  {ns.neighborCount} neighbors · {ns.knownNodes} known
                </span>
              )}
            </Tooltip>
          </CircleMarker>
        );
      })}

      {/* Suggested nodes */}
      {suggestions.map((node) => (
        <CircleMarker
          key={`suggest-${node.id}`}
          center={[node.lat, node.lng]}
          radius={7}
          pathOptions={{
            color: "#d4956a",
            weight: 1.5,
            opacity: 0.5,
            dashArray: "4 3",
            fillColor: "#d4956a",
            fillOpacity: 0.04,
          }}
        >
          <Tooltip direction="top" offset={[0, -10]} className="lifelink-tooltip">
            {node.reason}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
