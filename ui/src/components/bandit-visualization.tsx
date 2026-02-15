"use client";

import {
  useState,
  useMemo,
} from "react";
import type { SimState } from "@/simulation/types";
import type { SensorNode } from "@/types/sensor";

interface BanditVisualizationProps {
  simState: SimState | null;
  sensorNodes: SensorNode[];
  title?: string;
}

interface GridCell {
  recipientId: number;
  recipientLabel: string;
  frequency: number;
  frequencyLabel: string;
  successRate: number;
  successCount: number;
  failureCount: number;
  totalAttempts: number;
}

interface NodeGrid {
  nodeId: number;
  nodeLabel: string;
  cells: GridCell[];
  allRecipients: number[];
  frequencies: number[];
}

/**
 * BanditVisualization - Grid Heatmap
 *
 * Displays per-node learning preferences as a grid heatmap:
 * - X-axis: other nodes (recipients)
 * - Y-axis: frequencies (Direct 1-hop vs Routed Multi-hop)
 * - Color intensity: success rate / preference for that node at that frequency
 */
export function BanditVisualization({
  simState,
  sensorNodes,
  title = "Message Delivery Learning Preferences",
}: BanditVisualizationProps) {
  const [hoveredCell, setHoveredCell] = useState<{ nodeId: number; recipientId: number; frequency: number } | null>(null);

  // Create a map of node IDs to labels
  const nodeIdToLabel = useMemo(() => {
    const map: Record<number, string> = {};
    for (const node of sensorNodes) {
      map[node.id] = node.label || `Node ${node.id}`;
    }
    return map;
  }, [sensorNodes]);

  // Build per-node grids from bandit stats
  const nodeGrids = useMemo(() => {
    if (!simState) return [];

    const gridsMap = new Map<number, NodeGrid>();

    // Collect all unique recipients and frequencies
    const allRecipients = new Set<number>();
    const allFrequencies = new Set<number>();

    for (const nodeState of simState.nodeStates) {
      if (!nodeState.banditStats) continue;

      for (const [key] of Object.entries(nodeState.banditStats)) {
        const [freqStr, recipStr] = key.split(":");
        const frequency = parseInt(freqStr, 10);
        const recipientId = parseInt(recipStr, 10);
        allRecipients.add(recipientId);
        allFrequencies.add(frequency);
      }
    }

    const sortedRecipients = Array.from(allRecipients).sort((a, b) => a - b);
    const sortedFrequencies = Array.from(allFrequencies).sort((a, b) => a - b);

    // Build grid for each node
    for (const nodeState of simState.nodeStates) {
      if (!nodeState.banditStats || Object.keys(nodeState.banditStats).length === 0) {
        continue;
      }

      const cells: GridCell[] = [];

      for (const recipientId of sortedRecipients) {
        for (const frequency of sortedFrequencies) {
          const key = `${frequency}:${recipientId}`;
          const stats = nodeState.banditStats[key];

          if (stats) {
            cells.push({
              recipientId,
              recipientLabel: nodeIdToLabel[recipientId] || `Node ${recipientId}`,
              frequency,
              frequencyLabel: frequency === 1 ? "Direct" : "Routed",
              successRate: stats.successRate,
              successCount: stats.successCount,
              failureCount: stats.failureCount,
              totalAttempts: stats.totalAttempts,
            });
          }
        }
      }

      gridsMap.set(nodeState.id, {
        nodeId: nodeState.id,
        nodeLabel: nodeState.label,
        cells,
        allRecipients: sortedRecipients,
        frequencies: sortedFrequencies,
      });
    }

    return Array.from(gridsMap.values());
  }, [simState, nodeIdToLabel]);
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 h-full overflow-auto">
      <h2 className="text-lg font-semibold">{title}</h2>

      {nodeGrids.length === 0 ? (
        <p className="text-sm text-[var(--foreground)]/70">
          No bandit data yet. Send messages to see learning preferences.
        </p>
      ) : (
        <div className="space-y-6">
          {/* Overview stats */}
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 border border-blue-200 dark:border-blue-800">
            <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 uppercase tracking-wide mb-2">
              📊 Overview
            </p>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-blue-700 dark:text-blue-400 font-medium">
                  {nodeGrids.length}
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-500">Learner Nodes</p>
              </div>
              <div>
                <p className="text-blue-700 dark:text-blue-400 font-medium">
                  {nodeGrids.reduce((sum, g) => sum + g.allRecipients.length, 0)}
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-500">Recipients</p>
              </div>
              <div>
                <p className="text-blue-700 dark:text-blue-400 font-medium">
                  {nodeGrids.length > 0 ? nodeGrids[0].frequencies.length : 0}
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-500">Frequencies</p>
              </div>
            </div>
          </div>

          {/* Per-node grids */}
          <div className="space-y-6">
            {nodeGrids.map((grid) => (
              <div
                key={`grid-${grid.nodeId}`}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4"
              >
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">
                    {grid.nodeLabel} - Learning Preferences
                  </h3>
                  <p className="text-xs text-[var(--foreground)]/60 mt-1">
                    Grid: Recipients × Frequencies | Color: Success Rate (Green = High, Red = Low)
                  </p>
                </div>

                {/* Heatmap grid */}
                <div className="overflow-x-auto">
                  <div className="inline-block min-w-full">
                    {/* Column headers (recipient nodes) */}
                    <div className="flex">
                      <div className="w-20" /> {/* Space for row labels */}
                      {grid.allRecipients.map((recipId) => (
                        <div
                          key={`header-${recipId}`}
                          className="flex-shrink-0 w-16 h-12 flex items-center justify-center text-xs font-medium text-[var(--foreground)] border border-[var(--border)] bg-[var(--background)]"
                        >
                          <span className="text-center break-words">
                            {nodeIdToLabel[recipId] || `Node ${recipId}`}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Rows (frequencies) with cells */}
                    {grid.frequencies.map((freq) => (
                      <div key={`row-${freq}`} className="flex">
                        {/* Row label */}
                        <div className="w-20 h-16 flex items-center justify-center text-xs font-medium text-[var(--foreground)] border border-[var(--border)] bg-[var(--background)] border-r-2">
                          <span className="text-center">
                            {freq === 1 ? "Direct" : "Routed"}
                          </span>
                        </div>

                        {/* Cells */}
                        {grid.allRecipients.map((recipId) => {
                          const cell = grid.cells.find(
                            (c) => c.recipientId === recipId && c.frequency === freq
                          );

                          return (
                            <div
                              key={`cell-${recipId}-${freq}`}
                              className="flex-shrink-0 w-16 h-16 border border-[var(--border)] flex flex-col items-center justify-center cursor-pointer transition-all"
                              style={{
                                backgroundColor: cell
                                  ? `hsl(${
                                      Math.min(cell.successRate, 1) * 120
                                    }, 100%, 50%)`
                                  : "transparent",
                                opacity: cell ? 0.7 : 0.2,
                              }}
                              onMouseEnter={() => {
                                if (cell) {
                                  setHoveredCell({
                                    nodeId: grid.nodeId,
                                    recipientId: recipId,
                                    frequency: freq,
                                  });
                                }
                              }}
                              onMouseLeave={() => setHoveredCell(null)}
                              title={
                                cell
                                  ? `${Math.round(cell.successRate * 100)}% success\n${cell.successCount}✓ ${cell.failureCount}✗`
                                  : "No data"
                              }
                            >
                              {cell ? (
                                <>
                                  <span className="text-xs font-bold text-white drop-shadow">
                                    {Math.round(cell.successRate * 100)}%
                                  </span>
                                  <span className="text-xs text-white/80 drop-shadow text-center">
                                    ({cell.totalAttempts})
                                  </span>
                                </>
                              ) : (
                                <span className="text-xs text-[var(--foreground)]/30">-</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Detail view for selected cell */}
                {hoveredCell && hoveredCell.nodeId === grid.nodeId && (
                  <div className="mt-4 p-3 rounded bg-slate-100 dark:bg-slate-900/40 border border-[var(--border)]">
                    {(() => {
                      const cell = grid.cells.find(
                        (c) =>
                          c.recipientId === hoveredCell.recipientId &&
                          c.frequency === hoveredCell.frequency
                      );
                      if (!cell) return null;

                      return (
                        <div className="text-sm">
                          <p className="font-semibold text-[var(--foreground)] mb-2">
                            {grid.nodeLabel} → {cell.recipientLabel} ({cell.frequencyLabel})
                          </p>
                          <div className="grid grid-cols-4 gap-3">
                            <div>
                              <p className="text-xs text-[var(--foreground)]/60">Success Rate</p>
                              <p className="text-lg font-bold text-green-600 dark:text-green-400">
                                {Math.round(cell.successRate * 100)}%
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-[var(--foreground)]/60">Successes</p>
                              <p className="text-lg font-bold text-green-600 dark:text-green-400">
                                {cell.successCount}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-[var(--foreground)]/60">Failures</p>
                              <p className="text-lg font-bold text-red-600 dark:text-red-400">
                                {cell.failureCount}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-[var(--foreground)]/60">Total Attempts</p>
                              <p className="text-lg font-bold text-[var(--foreground)]">
                                {cell.totalAttempts}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Color legend */}
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 p-3 border border-[var(--border)]">
            <p className="text-xs font-semibold text-[var(--foreground)] uppercase tracking-wide mb-2">
              📈 Color Scale (Success Rate)
            </p>
            <div className="flex gap-2 flex-wrap">
              {[
                { label: "0%", color: "bg-red-500" },
                { label: "20%", color: "bg-orange-400" },
                { label: "40%", color: "bg-yellow-400" },
                { label: "60%", color: "bg-lime-400" },
                { label: "80%", color: "bg-green-500" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded ${item.color}`} />
                  <span className="text-xs text-[var(--foreground)]/70">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
