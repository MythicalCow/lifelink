"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Header, type ViewMode } from "@/components/header";
import { SensorField } from "@/components/sensor-field";
import { SimControls } from "@/components/sim-controls";
import { Messenger, type ChatMessage } from "@/components/messenger";
import { Sensors } from "@/components/sensors";
import { useSimulation } from "@/hooks/use-simulation";
import type { SensorNode } from "@/types/sensor";
import {
  SUGGESTED_NODES,
  MAP_CENTER,
  MAP_ZOOM,
} from "@/config/nodes";

// Start with no nodes — user adds them via Sensors tab
const INITIAL_NODES: SensorNode[] = [];

export default function Home() {
  const [view, setView] = useState<ViewMode>("sensors"); // Start on sensors to add nodes
  const [nodes, setNodes] = useState<SensorNode[]>(INITIAL_NODES);
  const nextNodeId = useRef(1);

  const sim = useSimulation(nodes);

  /* ── Lifted message state — persists across tab switches ── */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const msgCounter = useRef(0);

  /* ── Persist delivery / failure statuses back into messages ── */
  useEffect(() => {
    if (!sim.state) return;
    const { deliveredTrackingIds, tick } = sim.state;

    setMessages((prev) => {
      let changed = false;
      const next = prev.map((msg) => {
        if (msg.status === "delivered" || msg.status === "failed") return msg;

        if (deliveredTrackingIds.includes(msg.id)) {
          changed = true;
          return { ...msg, status: "delivered" as const };
        }

        // Timeout: if 60+ ticks without delivery, mark failed
        if (tick - msg.timestamp > 60) {
          changed = true;
          return { ...msg, status: "failed" as const };
        }

        return msg;
      });
      return changed ? next : prev;
    });
  }, [sim.state]);

  /* ── Send + auto-play so the message actually routes ── */
  const handleMessengerSend = useCallback(
    (from: number, to: number, trackingId?: string) => {
      sim.sendMessage(from, to, trackingId);
      if (!sim.running) {
        sim.play();
      }
    },
    [sim],
  );

  /* ── Node configured via BLE (from Sensors tab) ── */
  const handleNodeConfigured = useCallback((config: {
    name: string;
    lat: number;
    lng: number;
    isAnchor: boolean;
  }) => {
    const id = nextNodeId.current++;
    setNodes((prev) => [...prev, {
      id,
      lat: config.lat,
      lng: config.lng,
      label: config.name,
      radius: 170,
      isAnchor: config.isAnchor,
    }]);
  }, []);

  /* ── Derived counts ── */
  const anchorCount = sim.state?.nodeStates.filter(
    (n) => n.posConfidence === 1,
  ).length ?? 0;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[var(--surface)]">
      <Header
        view={view}
        onViewChange={setView}
        nodeCount={nodes.length}
        anchorCount={anchorCount}
      />

      {/* ── Map view ───────────────────────────────────── */}
      {view === "map" && (
        <>
          <SensorField
            suggestions={SUGGESTED_NODES}
            center={MAP_CENTER}
            zoom={MAP_ZOOM}
            simState={sim.state}
          />

          <SimControls
            state={sim.state}
            running={sim.running}
            speed={sim.speed}
            onPlay={sim.play}
            onPause={sim.pause}
            onStep={sim.stepOnce}
            onToggleSpeed={sim.toggleSpeed}
            onReset={sim.reset}
          />
        </>
      )}

      {/* ── Messages view ──────────────────────────────── */}
      {view === "messages" && (
        <Messenger
          nodes={nodes}
          simState={sim.state}
          messages={messages}
          setMessages={setMessages}
          msgCounter={msgCounter}
          onSendMessage={handleMessengerSend}
        />
      )}

      {/* ── Sensors view (BLE node configuration) ─────── */}
      {view === "sensors" && (
        <Sensors onNodeConfigured={handleNodeConfigured} />
      )}

      <footer className="absolute inset-x-0 bottom-0 z-[1000] flex items-center justify-between px-8 py-4 text-[11px] text-[var(--muted)]">
        <span>LifeLink v0.1.0</span>
        <span>
          {view === "map"
            ? "Stanford Campus — Mesh Simulation"
            : view === "messages"
              ? "Stanford Campus — Mesh Messenger"
              : "Stanford Campus — Node Setup"}
        </span>
      </footer>
    </main>
  );
}
