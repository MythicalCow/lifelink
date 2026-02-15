/* ── NodeManager ──────────────────────────────────────
 * UI component for managing nodes: add, delete, configure.
 * Supports creating both normal and malicious nodes.
 * ───────────────────────────────────────────────────── */

"use client";

import { useState } from "react";
import type { SensorNode } from "@/types/sensor";
import type { AttackStrategy } from "@/simulation/malicious-node";

interface NodeManagerProps {
  nodes: SensorNode[];
  onAddNode: (node: SensorNode) => void;
  onQuickSetup?: (config: {
    nodeCount: number;
    maliciousCount: number;
    maliciousTypes: { type: AttackStrategy; count: number }[];
    density: number;
  }) => void;
  onClearAll?: () => void;
  trustMap?: Record<number, number[]>;
  onApplyConnections?: (trustMap: Record<number, number[]>) => void;
}

export function NodeManager({
  nodes,
  onAddNode,
  onQuickSetup,
  onClearAll,
  trustMap = {},
  onApplyConnections,
}: NodeManagerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [showQuickSetup, setShowQuickSetup] = useState(false);
  const [newNodeName, setNewNodeName] = useState("");
  const [newNodeLat, setNewNodeLat] = useState("37.4275");
  const [newNodeLng, setNewNodeLng] = useState("-122.1697");
  const [isAnchor, setIsAnchor] = useState(false);
  const [isMalicious, setIsMalicious] = useState(false);
  const [attackStrategy, setAttackStrategy] = useState<AttackStrategy>("jammer");
  const [attackIntensity, setAttackIntensity] = useState(0.5);

  // Quick setup state
  const [quickNodeCount, setQuickNodeCount] = useState(10);
  const [quickMaliciousCount, setQuickMaliciousCount] = useState(2);
  const [quickDensity, setQuickDensity] = useState(0.3);
  const [malJammers, setMalJammers] = useState(1);
  const [malLiars, setMalLiars] = useState(1);
  const [malSybils, setMalSybils] = useState(0);
  const [malBlackholes, setMalBlackholes] = useState(0);
  const [malSelective, setMalSelective] = useState(0);

  // Trust graph state
  const [draftConnections, setDraftConnections] = useState<
    Record<number, Set<number>>
  >({});

  const regularNodeCount = Math.max(quickNodeCount - quickMaliciousCount, 0);

  // Trust graph calculations
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

  const totalConnections = Object.values(baseTrustMap).reduce(
    (sum, peers) => sum + peers.length,
    0
  ) / 2;
  const maxPossibleConnections = (availableNodes.length * (availableNodes.length - 1)) / 2;
  const density = maxPossibleConnections > 0 ? (totalConnections / maxPossibleConnections) * 100 : 0;

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

  const buildMaliciousTypes = (targetCount: number) => {
    if (targetCount <= 0) return [];

    const entries: Array<{ type: AttackStrategy; count: number }> = [
      { type: "jammer", count: malJammers },
      { type: "liar", count: malLiars },
      { type: "sybil", count: malSybils },
      { type: "blackhole", count: malBlackholes },
      { type: "selective", count: malSelective },
    ];

    const expanded: AttackStrategy[] = [];
    for (const entry of entries) {
      for (let i = 0; i < entry.count; i++) {
        expanded.push(entry.type);
      }
    }

    if (expanded.length === 0) {
      return [{ type: "jammer", count: targetCount }];
    }

    const normalized: Record<AttackStrategy, number> = {
      jammer: 0,
      liar: 0,
      sybil: 0,
      blackhole: 0,
      selective: 0,
    };

    for (let i = 0; i < targetCount; i++) {
      const type = expanded[i % expanded.length];
      normalized[type] += 1;
    }

    return entries
      .map((entry) => ({ type: entry.type, count: normalized[entry.type] }))
      .filter((entry) => entry.count > 0);
  };

  const handleAddNode = () => {
    if (!newNodeName.trim()) return;

    const lat = parseFloat(newNodeLat);
    const lng = parseFloat(newNodeLng);

    if (isNaN(lat) || isNaN(lng)) return;

    const newId = Math.max(0, ...nodes.map((n) => n.id)) + 1;

    onAddNode({
      id: newId,
      lat,
      lng,
      label: isMalicious ? `[MAL] ${newNodeName}` : newNodeName,
      radius: 170,
      isAnchor,
    });

    // Reset form
    setNewNodeName("");
    setShowAddForm(false);
    setIsMalicious(false);
    setIsAnchor(false);
  };

  const handleQuickSetup = () => {
    if (!onQuickSetup) return;

    const maliciousTypes = buildMaliciousTypes(quickMaliciousCount);

    onQuickSetup({
      nodeCount: quickNodeCount,
      maliciousCount: quickMaliciousCount,
      maliciousTypes,
      density: quickDensity,
    });

    setShowQuickSetup(false);
  };

  return (
    <div className="absolute inset-0 top-16 bottom-0 flex flex-col bg-[var(--surface)] text-[var(--foreground)] overflow-hidden">
      {/* Header */}
      <div className="flex-none px-4 py-3 border-b border-[var(--foreground)]/10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Node & Trust Management</h2>
            <p className="text-xs text-[var(--foreground)]/60 mt-0.5">
              Configure nodes and trust relationships
            </p>
          </div>
          <div className="flex items-center gap-2">
            {nodes.length > 0 && onClearAll && (
              <button
                onClick={onClearAll}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
              >
                Clear All
              </button>
            )}
            <button
              onClick={() => {
                setShowQuickSetup(!showQuickSetup);
                setShowAddForm(false);
              }}
              className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
            >
              {showQuickSetup ? "Cancel" : "⚡ Quick Setup"}
            </button>
            <button
              onClick={() => {
                setShowAddForm(!showAddForm);
                setShowQuickSetup(false);
              }}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
            >
              {showAddForm ? "Cancel" : "+ Add Node"}
            </button>
          </div>
        </div>
      </div>

      {/* Quick Setup Form */}
      {showQuickSetup && (
        <div className="flex-none px-4 py-4 bg-green-500/5 border-b border-green-500/20">
          <div className="space-y-4 max-w-2xl">
            <h3 className="text-sm font-semibold text-green-400">⚡ Generate Full Network</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-2">
                  Total Nodes: {quickNodeCount}
                </label>
                <input
                  type="range"
                  min="3"
                  max="50"
                  value={quickNodeCount}
                  onChange={(e) => setQuickNodeCount(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-2">
                  Trust Graph Density: {(quickDensity * 100).toFixed(0)}% (regular nodes: {regularNodeCount})
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={quickDensity}
                  onChange={(e) => setQuickDensity(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>

            <div className="border-t border-[var(--foreground)]/10 pt-3">
              <label className="block text-xs font-medium mb-2 text-red-400">
                Malicious Nodes (Total: {quickMaliciousCount})
              </label>
              <input
                type="range"
                min="0"
                max={Math.min(20, Math.floor(quickNodeCount / 2))}
                value={quickMaliciousCount}
                onChange={(e) => {
                  const next = parseInt(e.target.value);
                  setQuickMaliciousCount(next);
                  if (next === 0) {
                    setMalJammers(0);
                    setMalLiars(0);
                    setMalSybils(0);
                    setMalBlackholes(0);
                    setMalSelective(0);
                  }
                }}
                className="w-full mb-3"
              />

              {quickMaliciousCount > 0 && (
                <div className="grid grid-cols-5 gap-2 text-xs">
                  <div>
                    <label className="block mb-1">Jammers</label>
                    <input
                      type="number"
                      min="0"
                      max={quickMaliciousCount}
                      value={malJammers}
                      onChange={(e) => setMalJammers(parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1 bg-[var(--surface)] border border-[var(--foreground)]/20 rounded"
                    />
                  </div>
                  <div>
                    <label className="block mb-1">Liars</label>
                    <input
                      type="number"
                      min="0"
                      max={quickMaliciousCount}
                      value={malLiars}
                      onChange={(e) => setMalLiars(parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1 bg-[var(--surface)] border border-[var(--foreground)]/20 rounded"
                    />
                  </div>
                  <div>
                    <label className="block mb-1">Sybils</label>
                    <input
                      type="number"
                      min="0"
                      max={quickMaliciousCount}
                      value={malSybils}
                      onChange={(e) => setMalSybils(parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1 bg-[var(--surface)] border border-[var(--foreground)]/20 rounded"
                    />
                  </div>
                  <div>
                    <label className="block mb-1">Blackholes</label>
                    <input
                      type="number"
                      min="0"
                      max={quickMaliciousCount}
                      value={malBlackholes}
                      onChange={(e) => setMalBlackholes(parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1 bg-[var(--surface)] border border-[var(--foreground)]/20 rounded"
                    />
                  </div>
                  <div>
                    <label className="block mb-1">Selective</label>
                    <input
                      type="number"
                      min="0"
                      max={quickMaliciousCount}
                      value={malSelective}
                      onChange={(e) => setMalSelective(parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1 bg-[var(--surface)] border border-[var(--foreground)]/20 rounded"
                    />
                  </div>
                </div>
              )}

            </div>

            <button
              onClick={handleQuickSetup}
              className={`w-full py-2.5 rounded font-medium transition-colors ${
                "bg-green-600 hover:bg-green-700 text-white"
              }`}
            >
              Generate Network ({quickNodeCount} nodes, {quickMaliciousCount} malicious, {(quickDensity * 100).toFixed(0)}% density)
            </button>
          </div>
        </div>
      )}

      {/* Add Node Form */}
      {showAddForm && (
        <div className="flex-none px-4 py-4 bg-[var(--foreground)]/5 border-b border-[var(--foreground)]/10">
          <div className="space-y-3 max-w-md">
            <div>
              <label className="block text-xs font-medium mb-1">Node Name</label>
              <input
                type="text"
                value={newNodeName}
                onChange={(e) => setNewNodeName(e.target.value)}
                placeholder="e.g., Node Alpha"
                className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--foreground)]/20 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Latitude</label>
                <input
                  type="text"
                  value={newNodeLat}
                  onChange={(e) => setNewNodeLat(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--foreground)]/20 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Longitude</label>
                <input
                  type="text"
                  value={newNodeLng}
                  onChange={(e) => setNewNodeLng(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--foreground)]/20 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAnchor}
                  onChange={(e) => setIsAnchor(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Anchor (GPS)</span>
              </label>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isMalicious}
                  onChange={(e) => setIsMalicious(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-red-500">Malicious Node</span>
              </label>
            </div>

            {isMalicious && (
              <div className="space-y-2 pt-2 border-t border-[var(--foreground)]/10">
                <div>
                  <label className="block text-xs font-medium mb-1">Attack Strategy</label>
                  <select
                    value={attackStrategy}
                    onChange={(e) => setAttackStrategy(e.target.value as AttackStrategy)}
                    className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--foreground)]/20 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="jammer">Jammer (flood channel)</option>
                    <option value="liar">Liar (false positions)</option>
                    <option value="sybil">Sybil (fake identities)</option>
                    <option value="blackhole">Blackhole (drop packets)</option>
                    <option value="selective">Selective (target specific nodes)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">
                    Intensity: {(attackIntensity * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={attackIntensity}
                    onChange={(e) => setAttackIntensity(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleAddNode}
              className="w-full py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
            >
              Add Node
            </button>
          </div>
        </div>
      )}

      {/* Trust Graph & Node List */}
      <div className="flex-1 overflow-y-auto pb-16">
        {/* Trust Graph Section */}
        {nodes.length > 0 && (
          <div className="p-4 border-b border-[var(--foreground)]/10 bg-blue-500/5">
            <div className="space-y-4">
              {/* Trust Graph Overview */}
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                <h3 className="text-sm font-semibold mb-3 text-blue-600">&#128274; Trust Graph Overview</h3>
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
                    &#9888;&#65039; No trust connections. Use Quick Setup or configure below.
                  </div>
                )}
                
                {totalConnections > 0 && (
                  <div className="mt-3 text-xs text-[var(--foreground)]/60 text-center">
                    Trust connections shown as gray lines on the map.
                  </div>
                )}
              </div>

              {/* Manual Connections */}
              {availableNodes.length >= 2 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Manual Trust Connections</label>
                    <span className="text-xs text-[var(--foreground)]/60">
                      Bidirectional
                    </span>
                  </div>

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
              )}
            </div>
          </div>
        )}

      </div>

      {/* Stats Footer */}
      <div className="flex-none px-4 py-3 border-t border-[var(--foreground)]/10 bg-[var(--foreground)]/5">
        <div className="text-xs text-[var(--foreground)]/70">
          Total Nodes: {nodes.length} | Malicious:{" "}
          {nodes.filter((n) => n.label?.startsWith("[MAL]")).length} | Anchors:{" "}
          {nodes.filter((n) => n.isAnchor).length}
        </div>
      </div>
    </div>
  );
}
