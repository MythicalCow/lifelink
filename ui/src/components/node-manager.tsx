/* ── NodeManager ──────────────────────────────────────
 * UI component for managing nodes: add, delete, configure.
 * Supports creating both normal and malicious nodes.
 * ───────────────────────────────────────────────────── */

"use client";

import { useState } from "react";
import type { SensorNode } from "@/types/sensor";
import type { AttackStrategy } from "@/simulation/malicious-node";
import type { SimState } from "@/simulation/types";

interface NodeManagerProps {
  nodes: SensorNode[];
  onAddNode: (node: SensorNode) => void;
  onDeleteNode: (nodeId: number) => void;
  onToggleMalicious: (nodeId: number, isMalicious: boolean) => void;
  onConfigureAttack?: (nodeId: number, strategy: AttackStrategy, intensity: number) => void;
  onQuickSetup?: (config: {
    nodeCount: number;
    maliciousCount: number;
    maliciousTypes: { type: AttackStrategy; count: number }[];
    density: number;
  }) => void;
  onClearAll?: () => void;
  simState?: SimState | null;
}

export function NodeManager({
  nodes,
  onAddNode,
  onDeleteNode,
  onToggleMalicious,
  onConfigureAttack,
  onQuickSetup,
  onClearAll,
  simState,
}: NodeManagerProps) {
  // Debug: log simState updates
  if (typeof console !== 'undefined' && simState) {
    const totalMessages = simState.nodeStates.reduce((sum, ns) => sum + (ns.receivedMessages?.length || 0), 0);
    if (totalMessages > 0) {
      // simState updated, total messages across all nodes: ${totalMessages}
    }
  }
  
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

  // Track expanded malicious nodes for config
  const [expandedNodeId, setExpandedNodeId] = useState<number | null>(null);
  const [editStrategy, setEditStrategy] = useState<AttackStrategy>("jammer");
  const [editIntensity, setEditIntensity] = useState(0.5);

  const regularNodeCount = Math.max(quickNodeCount - quickMaliciousCount, 0);

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
    <div className="absolute inset-0 top-16 bottom-10 flex flex-col bg-[var(--surface)] text-[var(--foreground)] overflow-hidden">
      {/* Header */}
      <div className="flex-none px-4 py-3 border-b border-[var(--foreground)]/10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Node Management</h2>
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

      {/* Node List */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-2">
          {nodes.length === 0 ? (
            <div className="text-center text-[var(--foreground)]/50 py-8">
              No nodes yet. Click &quot;Add Node&quot; to create one.
            </div>
          ) : (
            nodes.map((node) => {
              const isMal = node.label?.startsWith("[MAL]") ?? false;
              const isExpanded = expandedNodeId === node.id;
              
              // Get received messages for this node from simState
              const nodeState = simState?.nodeStates.find(ns => ns.id === node.id);
              const receivedMessages = nodeState?.receivedMessages ?? [];
              
              return (
                <div key={node.id} className="space-y-2">
                  <div
                    className={`p-3 rounded border ${
                      isMal
                        ? "border-red-500/30 bg-red-500/5"
                        : "border-[var(--foreground)]/10 bg-[var(--foreground)]/5"
                    } hover:border-[var(--foreground)]/20 transition-colors`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${isMal ? "text-red-400" : ""}`}>
                            {node.label || `Node ${node.id}`}
                          </span>
                          {node.isAnchor && (
                            <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">
                              GPS
                            </span>
                          )}
                          {isMal && (
                            <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-xs rounded">
                              MALICIOUS
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--foreground)]/50 mt-1">
                          ID: {node.id} | Pos: ({node.lat.toFixed(4)}, {node.lng.toFixed(4)})
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {isMal && onConfigureAttack && (
                          <button
                            onClick={() => {
                              if (isExpanded) {
                                setExpandedNodeId(null);
                              } else {
                                setExpandedNodeId(node.id);
                                setEditStrategy("jammer");
                                setEditIntensity(0.5);
                              }
                            }}
                            className="px-2 py-1 text-xs text-yellow-400 hover:bg-yellow-500/10 rounded transition-colors"
                          >
                            {isExpanded ? "Cancel" : "Configure"}
                          </button>
                        )}
                        {onToggleMalicious && (
                          <button
                            onClick={() => onToggleMalicious(node.id, !isMal)}
                            className={`px-2 py-1 text-xs rounded transition-colors ${
                              isMal
                                ? "text-green-400 hover:bg-green-500/10"
                                : "text-red-400 hover:bg-red-500/10"
                            }`}
                          >
                            {isMal ? "Make Normal" : "Make Malicious"}
                          </button>
                        )}
                        <button
                          onClick={() => onDeleteNode(node.id)}
                          className="px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Received Messages Display - Always show for debugging */}
                    <div className="mt-3 pt-3 border-t border-[var(--foreground)]/10">
                      <div className="text-xs font-medium text-[var(--foreground)]/70 mb-2">
                        📬 Received Messages ({receivedMessages.length})
                      </div>
                      {receivedMessages.length > 0 ? (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto">
                          {receivedMessages.slice(-5).reverse().map((msg, idx) => {
                            const fromNode = nodes.find(n => n.id === msg.fromNodeId);
                            const fromLabel = fromNode?.label ?? `Node ${msg.fromNodeId}`;
                            return (
                              <div
                                key={`${msg.id}-${idx}`}
                                className="p-2 bg-[var(--foreground)]/5 rounded text-xs"
                              >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="font-medium text-blue-500">
                                    From: {fromLabel}
                                  </span>
                                  <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]/50">
                                    <span>{msg.hopCount} hops</span>
                                    <span>•</span>
                                    <span>tick {msg.timestamp}</span>
                                  </div>
                                </div>
                                <div className="text-[var(--foreground)]/60 break-all">
                                  {msg.text || '(empty message)'}
                                </div>
                              </div>
                            );
                          })}
                          {receivedMessages.length > 5 && (
                            <div className="text-center text-[10px] text-[var(--muted)]/40 pt-1">
                              +{receivedMessages.length - 5} more messages
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[10px] text-[var(--muted)]/50 italic py-2">
                          No messages received yet. Node state: {nodeState ? 'found' : 'NOT FOUND'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Attack Configuration Panel */}
                  {isExpanded && isMal && onConfigureAttack && (
                    <div className="ml-4 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded text-sm">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium mb-1">Attack Strategy</label>
                          <select
                            value={editStrategy}
                            onChange={(e) => setEditStrategy(e.target.value as AttackStrategy)}
                            className="w-full px-2 py-1 bg-[var(--surface)] border border-[var(--foreground)]/20 rounded text-sm"
                          >
                            <option value="jammer">Jammer (Flood channel)</option>
                            <option value="liar">Liar (False positions)</option>
                            <option value="sybil">Sybil (Fake identities)</option>
                            <option value="blackhole">Blackhole (Drop all)</option>
                            <option value="selective">Selective (Target specific)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium mb-1">
                            Intensity: {(editIntensity * 100).toFixed(0)}%
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={editIntensity}
                            onChange={(e) => setEditIntensity(parseFloat(e.target.value))}
                            className="w-full"
                          />
                        </div>

                        <button
                          onClick={() => {
                            onConfigureAttack(node.id, editStrategy, editIntensity);
                            setExpandedNodeId(null);
                          }}
                          className="w-full py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white text-xs rounded transition-colors"
                        >
                          Apply Configuration
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
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
