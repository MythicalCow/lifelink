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
import type { SimState, Transmission, NodeVisualState } from "@/simulation/types";
import { PacketType } from "@/simulation/types";
import "leaflet/dist/leaflet.css";

interface LeafletMapProps {
  center: [number, number];
  zoom: number;
  simState: SimState | null;
  mapKey?: number;
  showGodMode?: boolean;
}

/** Map node visual state → color */
function nodeColor(ns: NodeVisualState | undefined): string {
  if (!ns) return "#2563eb";
  return "#2563eb";
}

/** Map node state → border weight */
function nodeWeight(ns: NodeVisualState | undefined): number {
  if (!ns) return 2;
  return ns.state === "idle" ? 2 : 3;
}

/** Transmission line color by channel (green -> yellow family) */
function txColorByChannel(channel: number): string {
  const colors = [
    "#22c55e", // green - ch 0
    "#4ade80", // lighter green - ch 1
    "#84cc16", // lime - ch 2
    "#a3e635", // lighter lime - ch 3
    "#bef264", // yellow-green - ch 4
    "#facc15", // yellow - ch 5
    "#fde047", // lighter yellow - ch 6
    "#fef08a", // pale yellow - ch 7
  ];
  return colors[channel % colors.length];
}

/** Transmission line color */
function txColor(tx: Transmission): string {
  // Collisions and captures get special colors
  if (tx.status === "collision") return "#ef4444";
  if (tx.status === "captured") return "#f59e0b";
  
  // Normal transmissions use channel colors
  return txColorByChannel(tx.channel);
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
  // Malicious transmissions: dotted (short dashes)
  if (tx.isMalicious) return "2 6";
  // Collisions: small dashes
  if (tx.status === "collision") return "4 4";
  // Normal transmissions: dashed
  return "8 4";
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
  simState,
  mapKey = 0,
  showGodMode = false,
}: LeafletMapProps) {
  const [showLegend, setShowLegend] = useState(true);
  const transmissions = simState?.transmissions ?? [];
  const nodeStates = simState?.nodeStates ?? [];

  return (
    <>
      {/* Legend */}
      {showLegend && (
        <div className="absolute top-20 left-4 z-[1000] w-64 rounded-xl bg-white/90 p-4 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[var(--foreground)]">Transmission Legend</span>
            <button
              onClick={() => setShowLegend(false)}
              className="text-[var(--muted)] hover:text-[var(--foreground)] text-xs"
            >
              ✕
            </button>
          </div>
          
          <div className="space-y-2.5">
            {/* Channel colors */}
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wide">Channels</p>
              <div className="grid grid-cols-4 gap-1">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((ch) => (
                  <div key={ch} className="flex items-center gap-1">
                    <div 
                      className="w-6 h-0.5 rounded-full" 
                      style={{ backgroundColor: txColorByChannel(ch) }}
                    />
                    <span className="text-[9px] text-[var(--muted)]">{ch}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Line styles */}
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wide">Line Styles</p>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <svg width="32" height="8" className="shrink-0">
                    <line x1="0" y1="4" x2="32" y2="4" stroke="#22c55e" strokeWidth="2" strokeDasharray="8 4" />
                  </svg>
                  <span className="text-[10px] text-[var(--foreground)]">Normal</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg width="32" height="8" className="shrink-0">
                    <line x1="0" y1="4" x2="32" y2="4" stroke="#ef4444" strokeWidth="2" strokeDasharray="2 6" />
                  </svg>
                  <span className="text-[10px] text-[var(--foreground)]">Malicious</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg width="32" height="8" className="shrink-0">
                    <line x1="0" y1="4" x2="32" y2="4" stroke="#ef4444" strokeWidth="2" strokeDasharray="4 4" />
                  </svg>
                  <span className="text-[10px] text-[var(--foreground)]">Collision</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg width="32" height="8" className="shrink-0">
                    <line x1="0" y1="4" x2="32" y2="4" stroke="#f59e0b" strokeWidth="2" strokeDasharray="8 4" />
                  </svg>
                  <span className="text-[10px] text-[var(--foreground)]">Captured</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toggle legend button (when hidden) */}
      {!showLegend && (
        <button
          onClick={() => setShowLegend(true)}
          className="absolute top-20 left-4 z-[1000] rounded-lg bg-white/80 px-3 py-1.5 text-[10px] font-medium text-[var(--muted)] shadow-sm backdrop-blur-sm transition-colors hover:bg-white"
        >
          Show Legend
        </button>
      )}

      <MapContainer
        key={`map-${mapKey}`}
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
                color,
                weight,
                opacity: hasPosition ? 0.9 : 0.6,
                fillColor: "transparent",
                fillOpacity: 0,
                dashArray: "1 5",
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
      </MapContainer>
    </>
  );
}
