"use client";

import dynamic from "next/dynamic";
import type { SimState } from "@/simulation/types";

const LeafletMap = dynamic(
  () => import("@/components/leaflet-map").then((m) => m.LeafletMap),
  { ssr: false },
);

interface SensorFieldProps {
  center: [number, number];
  zoom: number;
  simState: SimState | null;
  mapKey?: number;
  showGodMode?: boolean;
}

export function SensorField({
  center,
  zoom,
  simState,
  mapKey,
  showGodMode,
}: SensorFieldProps) {
  return (
    <div className="h-full w-full">
      <LeafletMap
        center={center}
        zoom={zoom}
        simState={simState}
        mapKey={mapKey}
        showGodMode={showGodMode}
      />
    </div>
  );
}
