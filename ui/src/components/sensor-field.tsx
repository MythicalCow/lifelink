"use client";

import dynamic from "next/dynamic";
import type { SensorNode, SuggestedNode } from "@/types/sensor";

const LeafletMap = dynamic(
  () => import("@/components/leaflet-map").then((m) => m.LeafletMap),
  { ssr: false },
);

interface SensorFieldProps {
  nodes: SensorNode[];
  suggestions: SuggestedNode[];
  center: [number, number];
  zoom: number;
}

export function SensorField({
  nodes,
  suggestions,
  center,
  zoom,
}: SensorFieldProps) {
  return (
    <div className="h-full w-full">
      <LeafletMap
        nodes={nodes}
        center={center}
        zoom={zoom}
        suggestions={suggestions}
      />
    </div>
  );
}
