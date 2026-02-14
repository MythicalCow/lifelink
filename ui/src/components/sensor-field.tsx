"use client";

import dynamic from "next/dynamic";
import type { SuggestedNode } from "@/types/sensor";
import type { SimState } from "@/simulation/types";

const LeafletMap = dynamic(
  () => import("@/components/leaflet-map").then((m) => m.LeafletMap),
  { ssr: false },
);

interface SensorFieldProps {
  suggestions: SuggestedNode[];
  center: [number, number];
  zoom: number;
  simState: SimState | null;
}

export function SensorField({
  suggestions,
  center,
  zoom,
  simState,
}: SensorFieldProps) {
  return (
    <div className="h-full w-full">
      <LeafletMap
        center={center}
        zoom={zoom}
        suggestions={suggestions}
        simState={simState}
      />
    </div>
  );
}
