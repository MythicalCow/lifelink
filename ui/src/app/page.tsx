import { Header } from "@/components/header";
import { SensorField } from "@/components/sensor-field";
import { SENSOR_NODES, SUGGESTED_NODES, MAP_CENTER, MAP_ZOOM } from "@/config/nodes";

export default function Home() {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[var(--surface)]">
      <Header
        nodeCount={SENSOR_NODES.length}
        suggestionCount={SUGGESTED_NODES.length}
      />
      <SensorField
        nodes={SENSOR_NODES}
        suggestions={SUGGESTED_NODES}
        center={MAP_CENTER}
        zoom={MAP_ZOOM}
      />

      {/* Bottom status bar */}
      <footer className="absolute inset-x-0 bottom-0 z-[1000] flex items-center justify-between px-8 py-4 text-[11px] text-[var(--muted)]">
        <span>LifeLink v0.1.0</span>
        <span>Stanford Campus — Last check-in just now</span>
      </footer>
    </main>
  );
}
