/* ── TrustGraphConfig ─────────────────────────────────
 * UI for configuring trust relationships between nodes.
 * Select nodes and set graph density.
 * ───────────────────────────────────────────────────── */

"use client";

import { useState } from "react";
import type { SensorNode } from "@/types/sensor";

interface TrustGraphConfigProps {
  nodes: SensorNode[];
  onConfigure: (nodeIds: number[], density: number) => void;
  trustMap: Record<number, number[]>;
  onApplyConnections?: (trustMap: Record<number, number[]>) => void;
}

export function TrustGraphConfig({
  nodes,
  onConfigure,
  trustMap,
  onApplyConnections,
}: TrustGraphConfigProps) {
  const [draftConnections, setDraftConnections] = useState<
    Record<number, Set<number>>
  >({});

  // Filter out malicious nodes from trust graph
  const availableNodes = nodes.filter((n) => !n.label?.startsWith("[MAL]"));

  const nodeLabelMap = new Map<number, string>();
  for (const node of availableNodes) {
    nodeLabelMap.set(node.id, node.label || `Node ${node.id}`);
  }

  const baseTrustMap: Record<number, number[]> = {};
  for (const node of availableNodes) {
    const peers = trustMap[node.id] ?? [];
    baseTrustMap[node.id] = [...new Set(peers.filter((peerId) => peerId !== node.id))]
      .sort((a, b) => a - b);
  }

  const pendingTrustMap: Record<number, number[]> = {};
  for (const node of availableNodes) {
    const draft = draftConnections[node.id];
    const peers = draft ? [...draft] : [...(baseTrustMap[node.id] ?? [])];
    pendingTrustMap[node.id] = peers.sort((a, b) => a - b);
  }

  const hasChanges =
    JSON.stringify(pendingTrustMap) !== JSON.stringify(baseTrustMap);

  const handleToggleConnection = (
    nodeId: number,
    peerId: number,
    isConnected: boolean,
  ) => {
    setDraftConnections((prev) => {
      const next = { ...prev };
      const baseNodePeers = baseTrustMap[nodeId] ?? [];
      const basePeerPeers = baseTrustMap[peerId] ?? [];
      const nodeSet = new Set(next[nodeId] ?? baseNodePeers);
      const peerSet = new Set(next[peerId] ?? basePeerPeers);

      if (isConnected) {
        nodeSet.add(peerId);
        peerSet.add(nodeId);
      } else {
        nodeSet.delete(peerId);
        peerSet.delete(nodeId);
      }

      next[nodeId] = nodeSet;
      next[peerId] = peerSet;
      return next;
    });
  };

  const handleApplyConnections = () => {
    if (!onApplyConnections) return;
    if (availableNodes.length < 2) return;
    onApplyConnections(pendingTrustMap);
    setDraftConnections({});
  };

  // Calculate trust graph stats
  const totalConnections = Object.values(baseTrustMap).reduce(
    (sum, peers) => sum + peers.length,
    0
  ) / 2; // Divide by 2 since connections are bidirectional
  const maxPossibleConnections = (availableNodes.length * (availableNodes.length - 1)) / 2;
  const density = maxPossibleConnections > 0 ? (totalConnections / maxPossibleConnections) * 100 : 0;

  return (
    <div className="absolute inset-0 top-16 bottom-10 flex flex-col bg-[var(--surface)] text-[var(--foreground)] overflow-hidden">
      {/* Header */}
      <div className="flex-none px-4 py-3 border-b border-[var(--foreground)]/10">
        <h2 className="text-lg font-semibold">Trust Graph Configuration</h2>
        <p className="text-xs text-[var(--foreground)]/60 mt-1">
          Configure which nodes trust each other (exchange public keys)
        </p>
      </div>

      {/* Configuration */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Trust Graph Overview */}
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
          <h3 className="text-sm font-semibold mb-3 text-blue-600">📊 Trust Graph Overview</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-[var(--foreground)]">{availableNodes.length}</div>
              <div className="text-xs text-[var(--foreground)]/60">Nodes</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{totalConnections}</div>
              <div className="text-xs text-[var(--foreground)]/60">Connections</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{density.toFixed(0)}%</div>
              <div className="text-xs text-[var(--foreground)]/60">Density</div>
            </div>
          </div>
          
          {totalConnections === 0 && availableNodes.length >= 2 && (
            <div className="mt-3 text-center text-xs text-amber-600 bg-amber-500/10 rounded-lg py-2 px-3">
              ⚠️ No trust connections configured. Add connections below to enable secure routing.
            </div>
          )}
          
          {totalConnections > 0 && (
            <div className="mt-3 text-xs text-[var(--foreground)]/60">
              Trust connections are shown as gray lines on the map.
            </div>
          )}
        </div>

        {/* Manual Connections */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Connections (Manual)</label>
            <span className="text-xs text-[var(--foreground)]/60">
              Bidirectional trust links
            </span>
          </div>

          {availableNodes.length < 2 ? (
            <div className="text-center text-[var(--foreground)]/50 py-8">
              Add at least two nodes to configure connections.
            </div>
          ) : (
            <div className="space-y-2">
              {availableNodes.map((node) => {
                const connectedPeers = pendingTrustMap[node.id] ?? [];
                const connectedLabels = connectedPeers
                  .map((peerId) => nodeLabelMap.get(peerId) ?? `Node ${peerId}`)
                  .join(", ");

                return (
                  <div
                    key={node.id}
                    className="rounded border border-[var(--foreground)]/10 bg-[var(--foreground)]/5"
                  >
                    <div className="flex items-center justify-between px-3 py-2">
                      <div>
                        <div className="text-sm font-medium">
                          {node.label || `Node ${node.id}`}
                        </div>
                        <div className="text-xs text-[var(--foreground)]/50">
                          ID: {node.id}{node.isAnchor ? " • GPS Anchor" : ""}
                        </div>
                      </div>
                      <span className="text-xs text-[var(--foreground)]/60">
                        {connectedPeers.length} connections
                      </span>
                    </div>

                    <details className="border-t border-[var(--foreground)]/10 px-3 py-2">
                      <summary className="cursor-pointer text-xs text-[var(--foreground)]/70">
                        {connectedPeers.length > 0
                          ? `Connected to: ${connectedLabels}`
                          : "No connections yet"}
                      </summary>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {availableNodes
                          .filter((peer) => peer.id !== node.id)
                          .map((peer) => {
                            const isChecked = connectedPeers.includes(peer.id);
                            return (
                              <label
                                key={peer.id}
                                className="flex items-center gap-2 text-xs text-[var(--foreground)]/80"
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) =>
                                    handleToggleConnection(
                                      node.id,
                                      peer.id,
                                      e.target.checked,
                                    )
                                  }
                                  className="h-3.5 w-3.5"
                                />
                                <span>
                                  {peer.label || `Node ${peer.id}`}
                                </span>
                              </label>
                            );
                          })}
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={handleApplyConnections}
            disabled={!onApplyConnections || availableNodes.length < 2 || !hasChanges}
            className={`w-full py-2.5 rounded font-medium transition-colors ${
              !onApplyConnections || availableNodes.length < 2 || !hasChanges
                ? "bg-[var(--foreground)]/10 text-[var(--foreground)]/30 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {hasChanges
              ? "Apply Manual Connections"
              : "Connections Up To Date"}
          </button>
        </div>
      </div>


    </div>
  );
}
