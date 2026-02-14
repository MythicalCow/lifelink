"use client";

import { useState } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  CircleMarker,
  Polyline,
  Tooltip,
} from "react-leaflet";
import type { SuggestedNode } from "@/types/sensor";
import type { SimState, Transmission, NodeVisualState } from "@/simulation/types";
import { PacketType } from "@/simulation/types";
import "leaflet/dist/leaflet.css";

interface LeafletMapProps {
  center: [number, number];
  zoom: number;
  suggestions: SuggestedNode[];
  simState: SimState | null;
}

/** Map node visual state → color */
function nodeColor(ns: NodeVisualState | undefined): string {
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
function nodeWeight(ns: NodeVisualState | undefined): number {
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

/** Calculate position error in meters */
function positionError(ns: NodeVisualState): number {
  if (ns.posConfidence === 1) return 0; // Anchor — no error
  if (ns.posConfidence === 0) return Infinity; // Unknown

  // Haversine approximation for small distances
  const dLat = ns.estLat - ns.trueLat;
  const dLng = ns.estLng - ns.trueLng;
  const latM = dLat * 111_132;
  const lngM = dLng * 111_412 * Math.cos((ns.trueLat * Math.PI) / 180);
  return Math.sqrt(latM * latM + lngM * lngM);
}

export function LeafletMap({
  center,
  zoom,
  suggestions,
  simState,
}: LeafletMapProps) {
  const [showGodMode, setShowGodMode] = useState(false);
  const transmissions = simState?.transmissions ?? [];
  const nodeStates = simState?.nodeStates ?? [];

  return (
    <>
      {/* God mode toggle */}
      <div className="absolute top-20 right-4 z-[1000]">
        <button
          onClick={() => setShowGodMode(!showGodMode)}
          className={`rounded-lg px-3 py-1.5 text-[10px] font-medium shadow-sm backdrop-blur-sm transition-all ${
            showGodMode
              ? "bg-amber-500/90 text-white"
              : "bg-white/80 text-[var(--muted)] hover:bg-white"
          }`}
        >
          {showGodMode ? "👁 True Positions" : "📡 Estimated"}
        </button>
      </div>

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

        {/* Transmission lines (always use true positions for physics) */}
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

        {/* Error lines: connect true → estimated position (god mode only) */}
        {showGodMode &&
          nodeStates
            .filter((ns) => ns.posConfidence > 0 && ns.posConfidence < 1)
            .map((ns) => (
              <Polyline
                key={`error-${ns.id}`}
                positions={[
                  [ns.trueLat, ns.trueLng],
                  [ns.estLat, ns.estLng],
                ]}
                pathOptions={{
                  color: "#ef4444",
                  weight: 1.5,
                  opacity: 0.5,
                  dashArray: "4 4",
                }}
              />
            ))}

        {/* True position markers (god mode only — faded) */}
        {showGodMode &&
          nodeStates.map((ns) => (
            <CircleMarker
              key={`true-${ns.id}`}
              center={[ns.trueLat, ns.trueLng]}
              radius={5}
              pathOptions={{
                color: "#f59e0b",
                weight: 1.5,
                opacity: 0.6,
                fillColor: "#f59e0b",
                fillOpacity: 0.15,
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -8]}
                className="lifelink-tooltip"
              >
                <span className="text-amber-600">True: {ns.label}</span>
              </Tooltip>
            </CircleMarker>
          ))}

        {/* Main node markers — show at ESTIMATED position (or true for anchors/unknown) */}
        {nodeStates.map((ns) => {
          const color = nodeColor(ns);
          const weight = nodeWeight(ns);
          const isAnchor = ns.posConfidence === 1;
          const hasPosition = ns.posConfidence > 0;
          const error = positionError(ns);

          // Position to display:
          // - Anchors: use true position (they know it via GPS)
          // - Trilaterated: use estimated position
          // - Unknown (confidence=0): use true position (shown grayed out)
          const lat = isAnchor || !hasPosition ? ns.trueLat : ns.estLat;
          const lng = isAnchor || !hasPosition ? ns.trueLng : ns.estLng;

          return (
            <CircleMarker
              key={`node-${ns.id}`}
              center={[lat, lng]}
              radius={7}
              pathOptions={{
                color: hasPosition ? color : "#9ca3af",
                weight,
                opacity: hasPosition ? 0.9 : 0.4,
                fillColor: isAnchor ? color : "transparent",
                fillOpacity: isAnchor ? 0.3 : 0,
                dashArray: hasPosition ? undefined : "3 3",
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -10]}
                className="lifelink-tooltip"
              >
                <span className="font-semibold">
                  {ns.label}
                  {isAnchor && " 📍"}
                </span>
                <span className="block opacity-60">
                  {ns.neighborCount} neighbors · {ns.knownNodes} known
                </span>
                <span className="block opacity-40 text-[10px]">
                  {isAnchor
                    ? "GPS anchor"
                    : hasPosition
                      ? `${Math.round(ns.posConfidence * 100)}% confident · ${error.toFixed(1)}m error`
                      : "⏳ Waiting for FTM..."}
                </span>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {/* Coverage perimeters (centered on estimated positions) */}
        {nodeStates
          .filter((ns) => ns.posConfidence > 0)
          .map((ns) => {
            const isAnchor = ns.posConfidence === 1;
            const lat = isAnchor ? ns.trueLat : ns.estLat;
            const lng = isAnchor ? ns.trueLng : ns.estLng;

            return (
              <Circle
                key={`perimeter-${ns.id}`}
                center={[lat, lng]}
                radius={170}
                pathOptions={{
                  color: nodeColor(ns),
                  weight: 1,
                  opacity: 0.15,
                  fillColor: nodeColor(ns),
                  fillOpacity: 0.03,
                }}
              />
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
    </>
  );
}
