"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Header, type ViewMode } from "@/components/header";
import { SensorField } from "@/components/sensor-field";
import { Messenger, type ChatMessage } from "@/components/messenger";
import { HardwareSetup } from "@/components/hardware-setup";
import { useGatewayBridge } from "@/hooks/use-gateway-bridge";
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
  const gateway = useGatewayBridge();

  /* ── Lifted message state — persists across tab switches ── */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const msgCounterRef = useRef(0);

  /* ── Node configured via BLE (from Sensors tab) ── */
  const handleNodeConfigured = useCallback((config: {
    name: string;
    lat: number;
    lng: number;
    isAnchor: boolean;
    hardwareIdHex: string;
    bleAddress: string;
  }) => {
    setNodes((prev) => {
      const existingIdx = prev.findIndex(
        (n) => (n.hardwareIdHex || "").toUpperCase() === config.hardwareIdHex.toUpperCase(),
      );

      const nextNode: SensorNode = {
        id: existingIdx >= 0 ? prev[existingIdx].id : nextNodeId.current++,
        lat: config.lat,
        lng: config.lng,
        label: config.name,
        radius: 170,
        isAnchor: config.isAnchor,
        hardwareIdHex: config.hardwareIdHex.toUpperCase(),
        bleAddress: config.bleAddress,
        locationKnown: true,
      };

      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx] = nextNode;
        return copy;
      }
      return [...prev, nextNode];
    });
  }, []);

  useEffect(() => {
    if (gateway.members.length === 0) return;
    setNodes((prev) => {
      let changed = false;
      const next = [...prev];
      for (const member of gateway.members) {
        const hex = (member.node_id || "").toUpperCase();
        if (!hex) continue;
        const idx = next.findIndex(
          (n) => (n.hardwareIdHex || "").toUpperCase() === hex,
        );
        const memberLabel =
          member.name && member.name !== "unknown" ? member.name : `Node-${hex}`;
        if (idx >= 0) {
          const cur = next[idx];
          const isGenericLabel =
            !cur.label ||
            cur.label.startsWith("Node-") ||
            cur.label.startsWith("Node ");
          if (member.name && member.name !== "unknown" && isGenericLabel && cur.label !== member.name) {
            next[idx] = { ...cur, label: member.name };
            changed = true;
          }
          continue;
        }

        const hash = parseInt(hex, 16) || 0;
        const angle = ((hash % 360) * Math.PI) / 180;
        const ring = 0.00035 + ((hash >> 4) % 5) * 0.00005;
        next.push({
          id: nextNodeId.current++,
          lat: MAP_CENTER[0] + Math.sin(angle) * ring,
          lng: MAP_CENTER[1] + Math.cos(angle) * ring,
          radius: 170,
          label: memberLabel,
          isAnchor: false,
          hardwareIdHex: hex,
          locationKnown: false,
        });
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [gateway.members]);

  /* ── Derived counts ── */
  const anchorCount = nodes.filter((n) => n.isAnchor).length;

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
            nodes={nodes}
            suggestions={SUGGESTED_NODES}
            center={MAP_CENTER}
            zoom={MAP_ZOOM}
          />
        </>
      )}

      {/* ── Messages view ──────────────────────────────── */}
      {view === "messages" && (
        <Messenger
          nodes={nodes}
          messages={messages}
          setMessages={setMessages}
          msgCounterRef={msgCounterRef}
          gatewayOnline={gateway.online}
          gatewayState={gateway.state}
          gatewayDevices={gateway.devices}
          gatewayLogs={gateway.logs}
          gatewayMessageHistory={gateway.messageHistory}
          onGatewayScan={gateway.scan}
          onGatewayConnect={gateway.connect}
          onGatewayDisconnect={gateway.disconnect}
          onGatewayCommand={gateway.command}
          onGatewayFetchMessages={gateway.fetchMessages}
        />
      )}

      {/* ── Sensors view (BLE node configuration) ─────── */}
      {view === "sensors" && (
        <HardwareSetup
          online={gateway.online}
          state={gateway.state}
          devices={gateway.devices}
          nodes={nodes}
          onScan={gateway.scan}
          onConnect={gateway.connect}
          onDisconnect={gateway.disconnect}
          onCommand={gateway.command}
          onNodeConfigured={handleNodeConfigured}
        />
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
        <span>
          Gateway {gateway.online ? (gateway.state.connected ? `connected 0x${gateway.state.node_id}` : "online") : "offline"}
          {gateway.state.connected && ` · hop ch${gateway.state.hop_channel} ${gateway.state.hop_frequency_mhz.toFixed(1)}MHz`}
        </span>
      </footer>
    </main>
  );
}
