"use client";

import dynamic from "next/dynamic";
import type { SensorNode, SuggestedNode } from "@/types/sensor";
import type { SimState } from "@/simulation/types";

const LeafletMap = dynamic(
  () => import("@/components/leaflet-map").then((m) => m.LeafletMap),
  { ssr: false },
);

interface SensorFieldProps {
  nodes: SensorNode[];
  suggestions: SuggestedNode[];
  center: [number, number];
  zoom: number;
  simState: SimState | null;
}

export function SensorField({
  nodes,
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
        nodes={nodes}
        suggestions={suggestions}
        simState={simState}
      />
    </div>
  );
}
