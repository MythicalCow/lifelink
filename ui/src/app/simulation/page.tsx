"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Header, type ViewMode } from "@/components/header";
import { SensorField } from "@/components/sensor-field";
import { SimControls } from "@/components/sim-controls";
import { Messenger, type ChatMessage } from "@/components/messenger";
import { BanditVisualization } from "@/components/bandit-visualization";
import { Sensors } from "@/components/sensors";
import { NodeManager } from "@/components/node-manager";
import { useSimulation, type SimulationHook } from "@/hooks/use-simulation";
import type { SensorNode } from "@/types/sensor";
import {
  MAP_CENTER,
  MAP_ZOOM,
} from "@/config/nodes";

// Start with no nodes — user adds them via Sensors tab
const INITIAL_NODES: SensorNode[] = [];

type QuickSetupPending = {
  maliciousNodes: Array<{ type: string; id: number }>;
  regularNodeIds: number[];
  density: number;
};

export default function SimulationPage() {
  const [view, setView] = useState<ViewMode>("nodes"); // Start on nodes tab
  const [nodes, setNodes] = useState<SensorNode[]>(INITIAL_NODES);
  const nextNodeId = useRef(1);
  const [panelMode, setPanelMode] = useState<"hidden" | "messages" | "bandit" | "both">("hidden");
  const [messagesWide, setMessagesWide] = useState(false);
  const [showGodMode, setShowGodMode] = useState(false);
  const [trustedOnlyRouting, setTrustedOnlyRouting] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [pendingQuickSetup, setPendingQuickSetup] = useState<QuickSetupPending | null>(null);
  const trustMapRef = useRef<Record<number, number[]>>({});

  const sim: SimulationHook = useSimulation(nodes);

  /* ── Lifted message state — persists across tab switches ── */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const msgCounterRef = useRef(0);

  /* ── Persist delivery / failure statuses back into messages ── */
  /* ── Also add received messages from simulator ── */
  useEffect(() => {
    if (!sim.state) return;
    const { deliveredTrackingIds, tick, nodeStates } = sim.state;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages((prev) => {
      let changed = false;

      // Update statuses of sent messages
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

      // Collect all received messages from all nodes
      const receivedMessageIds = new Set(
        next.filter((m) => m.direction === "received").map((m) => m.id)
      );

      for (const nodeState of nodeStates) {
        for (const receivedMsg of nodeState.receivedMessages) {
          // Avoid duplicates
          if (!receivedMessageIds.has(receivedMsg.id)) {
            changed = true;
            receivedMessageIds.add(receivedMsg.id);
            next.push({
              id: receivedMsg.id,
              fromNodeId: receivedMsg.fromNodeId,
              toNodeId: nodeState.id, // This node received it
              text: receivedMsg.text,
              timestamp: receivedMsg.timestamp,
              direction: "received" as const,
              status: "delivered" as const,
              hops: receivedMsg.hopCount,
            });
          }
        }
      }

      return changed ? next : prev;
    });
  }, [sim.state]);

  /* ── Refresh handler for messages ── */
  const handleRefreshMessages = useCallback(() => {
    setMessages([]);
    msgCounterRef.current = 0;
  }, []);

  /* ── Send + auto-play so the message actually routes ── */
  const handleMessengerSend = useCallback(
    (from: number, to: number, text?: string, trackingId?: string) => {
      sim.sendMessage(from, to, text, trackingId);
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

  /* ── Node Management Handlers ── */
  const handleAddNode = useCallback((node: SensorNode) => {
    setNodes((prev) => [...prev, node]);
    nextNodeId.current = Math.max(nextNodeId.current, node.id + 1);
  }, []);

  const handleQuickSetup = useCallback((config: {
    nodeCount: number;
    maliciousCount: number;
    maliciousTypes: { type: string; count: number }[];
    density: number;
  }) => {
    // Clear existing nodes and trust map
    setNodes([]);
    trustMapRef.current = {};
    nextNodeId.current = 1;

    // Generate random positions in Stanford area
    const newNodes: SensorNode[] = [];
    const centerLat = 37.4275;
    const centerLng = -122.1697;
    const spread = 0.01; // ~1km spread

    // Generate malicious nodes first
    const maliciousNodes: Array<{ type: string; id: number }> = [];
    let currentId = 1;

    for (const { type, count } of config.maliciousTypes) {
      for (let i = 0; i < count; i++) {
        const id = currentId++;
        const lat = centerLat + (Math.random() - 0.5) * spread;
        const lng = centerLng + (Math.random() - 0.5) * spread;
        newNodes.push({
          id,
          lat,
          lng,
          label: `[MAL] ${type.charAt(0).toUpperCase() + type.slice(1)} ${i + 1}`,
          radius: 170,
          isAnchor: false,
        });
        maliciousNodes.push({ type, id });
      }
    }

    // Generate regular nodes
    for (let i = 0; i < config.nodeCount - config.maliciousCount; i++) {
      const lat = centerLat + (Math.random() - 0.5) * spread;
      const lng = centerLng + (Math.random() - 0.5) * spread;
      newNodes.push({
        id: currentId++,
        lat,
        lng,
        label: `Node ${i + 1}`,
        radius: 170,
        isAnchor: i < 3, // First 3 nodes are anchors
      });
    }

    setNodes(newNodes);
    nextNodeId.current = currentId;

    const regularNodeIds = newNodes
      .filter((n) => !n.label?.includes("[MAL]"))
      .map((n) => n.id);

    setPendingQuickSetup({
      maliciousNodes,
      regularNodeIds,
      density: config.density,
    });
  }, [sim]);

  const handleClearAll = useCallback(() => {
    setNodes([]);
    trustMapRef.current = {};
    nextNodeId.current = 1;
    setPendingQuickSetup(null);
  }, []);

  /* ── Trust Graph Configuration ── */
  const handleApplyTrustGraph = useCallback((trustMap: Record<number, number[]>) => {
    if (!sim.state) return;
    const simulator = sim.simRef.current;
    if (simulator) {
      // Save the trust map so it can be restored if the simulator resets
      trustMapRef.current = trustMap;
      simulator.setTrustGraphFromMap(trustMap);
      sim.refreshState();
    }
  }, [sim]);

  // Update trusted-only routing setting when toggle changes
  useEffect(() => {
    const simulator = sim.simRef.current;
    if (simulator) {
      simulator.setTrustedOnlyRouting(trustedOnlyRouting);
    }
  }, [trustedOnlyRouting, sim.simRef]);

  useEffect(() => {
    if (!pendingQuickSetup || !sim.simRef.current || !sim.state) return;
    if (sim.state.nodeStates.length !== nodes.length) return;

    const simulator = sim.simRef.current;

    for (const { type, id } of pendingQuickSetup.maliciousNodes) {
      const node = simulator.getNode(id);
      if (node && typeof node.setStrategy === "function") {
        node.setStrategy(type);
        node.setIntensity(0.5);
      }
    }

    if (pendingQuickSetup.regularNodeIds.length > 0) {
      simulator.configureTrustGraph(
        pendingQuickSetup.regularNodeIds,
        pendingQuickSetup.density,
      );
    }

    sim.refreshState();
    
    // Save the newly configured trust graph so it persists across resets
    if (sim.state) {
      const newTrustMap: Record<number, number[]> = {};
      for (const nodeState of sim.state.nodeStates) {
        newTrustMap[nodeState.id] = nodeState.trustedPeers ?? [];
      }
      trustMapRef.current = newTrustMap;
    }
    
    setPendingQuickSetup(null);
  }, [nodes.length, pendingQuickSetup, sim, sim.state]);

  /* ── Preserve trust graph when adding a single node ── */
  useEffect(() => {
    // If we have a saved trust map and the simulator is ready
    if (Object.keys(trustMapRef.current).length === 0 || !sim.simRef.current || !sim.state) return;
    
    // Check if the simulator has nodes (means reset happened)
    if (sim.state.nodeStates.length === 0) return;
    
    // Check if we need to restore: simulator is ready but trust is missing
    // (This happens after reset clears the trust graph)
    const hasActiveTrust = sim.state.nodeStates.some((n) => n.trustedPeers.length > 0);
    const savedTrustExists = Object.values(trustMapRef.current).some((peers) => peers.length > 0);
    
    // Only restore if: we have saved trust, but simulator has no trust, and all saved nodes exist
    if (!hasActiveTrust && savedTrustExists && nodes.length === sim.state.nodeStates.length) {
      // Filter trust map to only include nodes that still exist
      const filteredTrustMap: Record<number, number[]> = {};
      for (const [nodeId, peers] of Object.entries(trustMapRef.current)) {
        const numId = Number(nodeId);
        if (nodes.some((n) => n.id === numId)) {
          filteredTrustMap[numId] = peers.filter((peerId) => 
            nodes.some((n) => n.id === peerId)
          );
        }
      }
      
      if (Object.keys(filteredTrustMap).length > 0) {
        sim.simRef.current.setTrustGraphFromMap(filteredTrustMap);
        sim.refreshState();
        // Keep trustMapRef.current for future resets
      }
    }
  }, [nodes, sim]);

  const trustMap = useMemo(() => {
    const map: Record<number, number[]> = {};
    for (const nodeState of sim.state?.nodeStates ?? []) {
      map[nodeState.id] = nodeState.trustedPeers ?? [];
    }
    return map;
  }, [sim.state]);

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
        <div className="absolute inset-0 top-16 flex flex-col">
          <div className="flex flex-wrap items-center justify-end gap-2 border-b border-[var(--foreground)]/10 bg-[var(--surface)]/90 px-4 py-2 text-[10px] backdrop-blur">
            <button
              onClick={() => {
                setPanelMode((prev) => {
                  if (prev === "hidden") return "messages";
                  if (prev === "messages") return "bandit";
                  if (prev === "bandit") return "both";
                  return "hidden";
                });
              }}
              className={`rounded-lg px-3 py-1.5 font-medium shadow-sm transition-all ${
                panelMode === "hidden"
                  ? "bg-white/80 text-[var(--muted)] hover:bg-white"
                  : panelMode === "messages"
                    ? "bg-sky-500/90 text-white"
                    : panelMode === "bandit"
                      ? "bg-purple-500/90 text-white"
                      : "bg-indigo-500/90 text-white"
              }`}
            >
              {panelMode === "hidden" && "📊 Show Panel"}
              {panelMode === "messages" && "💬 Show Bandit"}
              {panelMode === "bandit" && "📈 Show Both"}
              {panelMode === "both" && "✕ Hide"}
            </button>
            <button
              onClick={() => setMapKey((prev) => prev + 1)}
              className="rounded-lg bg-white/80 px-3 py-1.5 font-medium text-[var(--muted)] shadow-sm transition-colors hover:bg-white"
            >
              🔄 Refresh Map
            </button>
            <button
              onClick={() => setShowGodMode((prev) => !prev)}
              className={`rounded-lg px-3 py-1.5 font-medium shadow-sm transition-all ${
                showGodMode
                  ? "bg-amber-500/90 text-white"
                  : "bg-white/80 text-[var(--muted)] hover:bg-white"
              }`}
            >
              {showGodMode ? "👁 True Positions" : "📡 Estimated"}
            </button>
            <button
              onClick={() => setTrustedOnlyRouting((prev) => !prev)}
              className={`rounded-lg px-3 py-1.5 font-medium shadow-sm transition-all ${
                trustedOnlyRouting
                  ? "bg-green-500/90 text-white"
                  : "bg-white/80 text-[var(--muted)] hover:bg-white"
              }`}
              title="Route only through nodes with established trust relationships"
            >
              {trustedOnlyRouting ? "🔒 Trusted Routing ON" : "🔓 Trusted Routing OFF"}
            </button>

          </div>

          <div className="flex min-h-0 flex-1">
            <div
              className={`relative min-h-0 ${
                panelMode === "hidden"
                  ? "w-full"
                  : panelMode === "both"
                    ? "w-1/3"
                    : "w-1/2"
              }`}
            >
              <SensorField
                center={MAP_CENTER}
                zoom={MAP_ZOOM}
                simState={sim.state}
                mapKey={mapKey}
                showGodMode={showGodMode}
              />
            </div>

            {(panelMode === "messages" || panelMode === "both") && (
              <div
                className="min-h-0 flex-1 overflow-hidden border-l border-[var(--foreground)]/10 bg-[var(--surface)]"
              >
                <div className="h-full">
                  <Messenger
                    nodes={nodes}
                    simState={sim.state}
                    messages={messages}
                    setMessages={setMessages}
                    msgCounterRef={msgCounterRef}
                    onSendMessage={handleMessengerSend}
                    onRefresh={handleRefreshMessages}
                    variant="panel"
                    allowAnyGateway
                  />
                </div>
              </div>
            )}

            {(panelMode === "bandit" || panelMode === "both") && (
              <div
                className="min-h-0 flex-1 overflow-auto border-l border-[var(--foreground)]/10 bg-[var(--surface)]"
              >
                <div className="h-full p-4">
                  <BanditVisualization
                    simState={sim.state}
                    sensorNodes={nodes}
                    title="Message Delivery Bandit Tracking"
                  />
                </div>
              </div>
            )}
          </div>

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
        </div>
      )}

      {/* ── Sensors view (BLE node configuration) ─────── */}
      {view === "sensors" && (
        <Sensors onNodeConfigured={handleNodeConfigured} />
      )}

      {/* ── Nodes view (Node Management & Trust) ────────────── */}
      {view === "nodes" && (
        <NodeManager
          nodes={nodes}
          onAddNode={handleAddNode}
          onQuickSetup={handleQuickSetup}
          onClearAll={handleClearAll}
          trustMap={trustMap}
          onApplyConnections={handleApplyTrustGraph}
        />
      )}

      <footer className="absolute inset-x-0 bottom-0 z-[1000] flex items-center justify-between px-8 py-4 text-[11px] text-[var(--muted)]">
        <span>LifeLink v0.2.0</span>
        <span>
          {view === "map"
            ? "Mesh Simulation"
            : view === "nodes"
                ? "Node Management & Trust Configuration"
                : "Stanford Campus — Node Setup"}
        </span>
      </footer>
    </main>
  );
}
