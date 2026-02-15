"use client";

import {
  useState,
  useRef,
  useEffect,
  useMemo,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from "react";
import type { SensorNode } from "@/types/sensor";
import type { SimState } from "@/simulation/types";
import { haversine } from "@/simulation/utils";

/* ── Exported types ────────────────────────────────────── */

/**
 * ChatMessage represents a message in the mesh network.
 * 
 * TTL (Time-To-Live) logic:
 * - Messages include a TTL field (in ticks) and a sentAt timestamp (modulo day)
 * - The sentAt timestamp is embedded in the message payload for network transmission
 * - Mesh nodes should check the TTL and drop expired messages during routing
 * - The UI also marks messages as failed client-side when TTL expires
 * - This prevents stale messages from consuming network resources
 */
export interface ChatMessage {
  id: string;
  fromNodeId: number; // gateway node ID (BLE)
  toNodeId: number; // destination node ID (LoRa)
  text: string;
  timestamp: number; // tick when sent
  direction: "sent" | "received";
  status: "sending" | "routing" | "delivered" | "failed";
  hops?: number;
  ttl?: number; // time-to-live in ticks
  sentAt?: number; // timestamp modulo day (for network transmission)
}

/* ── Props ─────────────────────────────────────────────── */

interface MessengerProps {
  nodes: SensorNode[];
  simState: SimState | null;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  msgCounterRef: MutableRefObject<number>;
  onSendMessage: (from: number, to: number, text?: string, trackingId?: string) => void;
  onRefresh?: () => void;
  variant?: "full" | "panel";
  allowAnyGateway?: boolean;
}

/* ── Constants ─────────────────────────────────────────── */

/** Simulated user position (Stanford Main Quad area) */
const USER_LAT = 37.4275;
const USER_LNG = -122.1697;

/**
 * BLE range in meters for gateway connection.
 * Real hardware ≈ 30-50m; bumped for simulation demo.
 */
const BLE_RANGE_M = 250;

const QUICK_OPS = [
  { id: "ping", label: "Ping", template: "op:ping" },
  { id: "status", label: "Status", template: "op:status-check" },
  { id: "rekey", label: "Rekey", template: "op:rekey-trust" },
  { id: "rescan", label: "Rescan", template: "op:channel-scan" },
  { id: "sync", label: "Sync", template: "op:time-sync" },
  { id: "throttle", label: "Throttle", template: "op:rate-limit" },
];

/* ── Helpers ────────────────────────────────────────────── */

function getDistance(node: SensorNode): number {
  return haversine(USER_LAT, USER_LNG, node.lat, node.lng);
}

/** BLE signal strength — shorter range thresholds than LoRa */
function bleSignal(dist: number): { filled: number; label: string } {
  if (dist < 60) return { filled: 3, label: "Strong" };
  if (dist < 130) return { filled: 2, label: "Good" };
  if (dist < BLE_RANGE_M) return { filled: 1, label: "Weak" };
  return { filled: 0, label: "Out of range" };
}

function BleIndicator({ dist }: { dist: number }) {
  const { filled } = bleSignal(dist);
  return (
    <span className="inline-flex items-center gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`inline-block rounded-full transition-colors ${
            i < filled
              ? "h-1.5 w-1.5 bg-blue-500"
              : "h-1.5 w-1.5 bg-[var(--foreground)]/10"
          }`}
        />
      ))}
    </span>
  );
}

function LoraIndicator({ discovered }: { discovered: boolean }) {
  // If discovered via gossip, show signal; otherwise show unknown
  return (
    <span className="inline-flex items-center gap-[2px]">
      {discovered ? (
        [0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1.5 w-1.5 rounded-full bg-green-700"
          />
        ))
      ) : (
        <>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--foreground)]/10" />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--foreground)]/10" />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--foreground)]/10" />
        </>
      )}
    </span>
  );
}

/** Derive transient display status */
function displayStatus(
  msg: ChatMessage,
  simState: SimState | null,
): ChatMessage["status"] {
  if (msg.status === "delivered" || msg.status === "failed") return msg.status;
  if (!simState) return msg.status;
  if (simState.tick - msg.timestamp > 2) return "routing";
  return "sending";
}

/* ── Selection types ───────────────────────────────────── */
type DestSelection = number | "all" | null;

/* ── Component ──────────────────────────────────────────── */

export function Messenger({
  nodes,
  simState,
  messages,
  setMessages,
  msgCounterRef,
  onSendMessage,
  onRefresh,
  variant = "full",
  allowAnyGateway = false,
}: MessengerProps) {
  const [selectedGateway, setSelectedGateway] = useState<number | null>(null);
  const [selectedDest, setSelectedDest] = useState<DestSelection>(null);
  const [draft, setDraft] = useState("");
  const [gatewayMode, setGatewayMode] = useState<"ble" | "any">(
    allowAnyGateway ? "any" : "ble",
  );
  const [scheduledMessages, setScheduledMessages] = useState<
    Array<{
      fromNodeId: number;
      toNodeId: number;
      text: string;
      sendTick: number;
    }>
  >([]);
  const [quickCount, setQuickCount] = useState(6);
  const [quickMinOffset, setQuickMinOffset] = useState(2);
  const [quickMaxOffset, setQuickMaxOffset] = useState(20);
  const [quickMinBytes, setQuickMinBytes] = useState(8);
  const [quickMaxBytes, setQuickMaxBytes] = useState(32);
  const [quickTTL, setQuickTTL] = useState(5); // TTL in ticks (default 5)
  const [quickSamplingMode, setQuickSamplingMode] = useState<"uniform" | "random">("uniform");
  const [quickSenderMode, setQuickSenderMode] = useState<"selected" | "random">(
    "selected",
  );
  const [quickOps, setQuickOps] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const op of QUICK_OPS) initial[op.id] = true;
    return initial;
  });
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sort nodes by distance from user
  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => getDistance(a) - getDistance(b)),
    [nodes],
  );

  // BLE-range gateways
  const bleGateways = useMemo(
    () => sortedNodes.filter((n) => getDistance(n) <= BLE_RANGE_M),
    [sortedNodes],
  );

  const availableGateways = gatewayMode === "any" ? sortedNodes : bleGateways;

  const activeGatewayId =
    selectedGateway ?? (availableGateways[0]?.id ?? null);
  const gatewayNode = nodes.find((n) => n.id === activeGatewayId) ?? null;
  const gatewayDist = gatewayNode ? Math.round(getDistance(gatewayNode)) : 0;

  /* ── Label resolver ──────────────────────────────────
   * Labels come from what the GATEWAY has discovered via
   * gossip heartbeats — not from a hardcoded config.
   * If the gateway hasn't heard about a node yet, we show
   * "Node <id>" (undiscovered).
   * ─────────────────────────────────────────────────── */
  const gatewayState = simState?.nodeStates.find(
    (n) => n.id === activeGatewayId,
  );

  const discovered = gatewayState?.discoveredLabels ?? {};
  const resolveLabel = (nodeId: number): string => {
    if (nodeId === activeGatewayId && gatewayNode) {
      return gatewayNode.label ?? `Node ${nodeId}`;
    }
    if (discovered[nodeId]) return discovered[nodeId];
    return `Node ${nodeId}`;
  };

  // How many nodes has the gateway discovered?
  const discoveredCount = Object.keys(
    gatewayState?.discoveredLabels ?? {},
  ).length;

  // All nodes except gateway, annotated with discovery status
  const destinations = useMemo(() => {
    const discovered = gatewayState?.discoveredLabels ?? {};
    return sortedNodes
      .filter((n) => n.id !== activeGatewayId)
      .map((n) => ({
        ...n,
        discoveredLabel: discovered[n.id] ?? null,
        isDiscovered: n.id in discovered,
      }));
  }, [sortedNodes, activeGatewayId, gatewayState?.discoveredLabels]);

  // Auto-scroll
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, selectedDest]);

  // Enrich with transient statuses
  const enrichedMessages = messages.map((msg) => ({
    ...msg,
    status: displayStatus(msg, simState),
  }));

  // Filter for current thread
  const threadMessages =
    selectedDest === "all"
      ? enrichedMessages
      : selectedDest !== null
        ? enrichedMessages.filter(
            (m) =>
              (m.toNodeId === selectedDest &&
                m.fromNodeId === activeGatewayId) ||
              (m.fromNodeId === selectedDest &&
                m.toNodeId === activeGatewayId),
          )
        : [];

  const sentMessages = enrichedMessages.filter(
    (msg) => msg.direction === "sent",
  );
  const receivedMessages = enrichedMessages.filter(
    (msg) => msg.direction === "received",
  );

  const handleSend = () => {
    if (
      !draft.trim() ||
      selectedDest === null ||
      selectedDest === "all" ||
      !gatewayNode
    )
      return;

    const currentTick = simState?.tick ?? 0;
    const sentAt = currentTick % 86400; // timestamp modulo day
    const id = `msg-${++msgCounterRef.current}`;
    const msg: ChatMessage = {
      id,
      fromNodeId: gatewayNode.id,
      toNodeId: selectedDest,
      text: draft.trim(),
      timestamp: currentTick,
      direction: "sent",
      status: "sending",
      ttl: quickTTL,
      sentAt,
    };

    setMessages((prev) => [...prev, msg]);
    onSendMessage(gatewayNode.id, selectedDest, draft.trim(), id);
    setDraft("");
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (!simState || scheduledMessages.length === 0) return;
    const tick = simState.tick;
    const due = scheduledMessages.filter((msg) => msg.sendTick <= tick);
    if (due.length === 0) return;

    const timer = setTimeout(() => {
      setScheduledMessages((prev) =>
        prev.filter((msg) => msg.sendTick > tick),
      );

      for (const msg of due) {
        const id = `msg-${++msgCounterRef.current}`;
        const sentAt = msg.sendTick % 86400;
        const entry: ChatMessage = {
          id,
          fromNodeId: msg.fromNodeId,
          toNodeId: msg.toNodeId,
          text: msg.text,
          timestamp: msg.sendTick,
          direction: "sent",
          status: "sending",
          ttl: quickTTL,
          sentAt,
        };
        setMessages((prev) => [...prev, entry]);
        onSendMessage(msg.fromNodeId, msg.toNodeId, msg.text, id);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [simState, scheduledMessages, onSendMessage, setMessages, msgCounterRef, quickTTL]);

  // Check for expired messages based on TTL
  useEffect(() => {
    if (!simState) return;
    const currentTick = simState.tick;
    
    setMessages((prev) => {
      let hasChanges = false;
      const updated = prev.map((msg) => {
        // Only check messages that are still in transit
        if (msg.status !== "sending" && msg.status !== "routing") {
          return msg;
        }
        
        // Check if message has expired
        if (msg.ttl && currentTick - msg.timestamp >= msg.ttl) {
          hasChanges = true;
          return { ...msg, status: "failed" as const };
        }
        
        return msg;
      });
      
      return hasChanges ? updated : prev;
    });
  }, [simState, setMessages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectedNodeLabel =
    selectedDest === "all"
      ? "All Messages"
      : selectedDest !== null
        ? resolveLabel(selectedDest)
        : "Unknown";

  const pendingCount = messages.filter(
    (m) => m.status === "sending" || m.status === "routing",
  ).length;
  const deliveredCount = messages.filter(
    (m) => m.status === "delivered",
  ).length;

  const canSend =
    draft.trim() &&
    selectedDest !== null &&
    selectedDest !== "all" &&
    gatewayNode !== null;

  const quickOpChoices = QUICK_OPS.filter((op) => quickOps[op.id]);
  const canQuickAdd =
    quickCount > 0 &&
    quickMinOffset >= 0 &&
    quickMaxOffset >= quickMinOffset &&
    quickMinBytes > 0 &&
    quickMaxBytes >= quickMinBytes &&
    quickTTL > 0 &&
    quickOpChoices.length > 0 &&
    nodes.length > 0;
  const isPanel = variant === "panel";

  const handleQueueRandomMessages = () => {
    if (!simState || !canQuickAdd) return;
    const tick = simState.tick;
    const newMessages: Array<{
      fromNodeId: number;
      toNodeId: number;
      text: string;
      sendTick: number;
    }> = [];

    for (let i = 0; i < quickCount; i++) {
      let offset: number;
      if (quickSamplingMode === "uniform") {
        // Distribute offsets uniformly across the selected range so messages
        // are spaced evenly instead of clustering due to random selection.
        if (quickCount === 1) {
          offset = quickMinOffset;
        } else {
          // Compute inclusive evenly-spaced integer offsets between min and max
          const span = quickMaxOffset - quickMinOffset;
          offset =
            quickMinOffset +
            Math.round((i * span) / Math.max(1, quickCount - 1));
        }
      } else {
        // Random sampling within the inclusive range
        offset =
          quickMinOffset +
          Math.floor(Math.random() * (quickMaxOffset - quickMinOffset + 1));
      }
      const op =
        quickOpChoices[Math.floor(Math.random() * quickOpChoices.length)];

      // Generate random bytes
      const byteLength =
        quickMinBytes +
        Math.floor(Math.random() * (quickMaxBytes - quickMinBytes + 1));
      const randomBytes = Array.from({ length: byteLength }, () =>
        Math.floor(Math.random() * 256)
          .toString(16)
          .padStart(2, "0")
      ).join("");

      let fromNodeId: number;
      if (quickSenderMode === "selected" && activeGatewayId !== null) {
        fromNodeId = activeGatewayId;
      } else {
        const sender = nodes[Math.floor(Math.random() * nodes.length)];
        fromNodeId = sender.id;
      }

      const candidates = nodes.filter((n) => n.id !== fromNodeId);
      if (candidates.length === 0) continue;
      const dest = candidates[Math.floor(Math.random() * candidates.length)];
      
      // Calculate timestamp modulo day (86400 ticks) for network transmission
      const sentAt = (tick + offset) % 86400;
      
      newMessages.push({
        fromNodeId,
        toNodeId: dest.id,
        text: `${op.template}:ts=${sentAt}:ttl=${quickTTL}:${randomBytes}`,
        sendTick: tick + offset,
      });
    }

    setScheduledMessages((prev) => [...prev, ...newMessages]);
  };



  return (
    <div
      className={`relative flex flex-col ${
        variant === "panel"
          ? "h-full w-full"
          : "absolute inset-0 top-16 bottom-10 z-[500]"
      }`}
    >
      {/* ── Refresh button ──────────────────────────────── */}
      {onRefresh && messages.length > 0 && (
        <div className="absolute top-2 right-4 z-[1000]">
          <button
            onClick={onRefresh}
            className="rounded-lg bg-[var(--accent)]/10 px-3 py-1.5 text-[10px] font-medium text-[var(--accent)] shadow-sm backdrop-blur-sm transition-colors hover:bg-[var(--accent)]/20"
          >
            🔄 Clear Messages
          </button>
        </div>
      )}

      <div className={isPanel ? "flex min-h-0 flex-1 gap-5 px-4 pb-4 pt-2" : "flex flex-col"}>
        <div className={isPanel ? "flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto" : ""}>
          {/* ── Gateway selector (BLE) ──────────────────────── */}
          <div className={isPanel ? "w-full" : "mx-auto w-full max-w-lg px-4 pt-2"}>
            {allowAnyGateway && (
              <div className="flex items-center justify-between pb-2">
                <span className="text-[10px] font-semibold tracking-wide text-[var(--muted)] uppercase">
                  Gateway Mode
                </span>
                <div className="flex items-center gap-2 rounded-full bg-[var(--foreground)]/[0.06] p-0.5">
                  <button
                    onClick={() => setGatewayMode("ble")}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                      gatewayMode === "ble"
                        ? "bg-white text-[var(--foreground)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    BLE Range
                  </button>
                  <button
                    onClick={() => setGatewayMode("any")}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                      gatewayMode === "any"
                        ? "bg-white text-[var(--foreground)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    Any Node
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pb-1.5">
              <span className="text-[10px] font-semibold tracking-wide text-blue-500/80 uppercase">
                {gatewayMode === "any" ? "🧭 Act as node" : "📱 Your gateway"}
              </span>
              <span className="text-[10px] text-[var(--muted)]/50">
                {gatewayMode === "any" ? "override" : "BLE"}
              </span>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none">
              {availableGateways.length === 0 ? (
                <span className="text-[11px] text-[var(--muted)]">
                  {gatewayMode === "any"
                    ? "No nodes available"
                    : `No nodes in BLE range (${BLE_RANGE_M}m)`}
                </span>
              ) : (
                availableGateways.map((node) => {
                  const dist = Math.round(getDistance(node));
                  const isSelected = activeGatewayId === node.id;
                  return (
                    <button
                      key={node.id}
                      onClick={() => setSelectedGateway(node.id)}
                      className={`flex shrink-0 flex-col items-start gap-1 rounded-xl px-4 py-2.5 transition-all duration-150 ${
                        isSelected
                          ? "bg-blue-500/10 ring-1.5 ring-blue-500/40"
                          : "bg-[var(--foreground)]/[0.03] hover:bg-[var(--foreground)]/[0.06]"
                      }`}
                    >
                      <span
                        className={`text-[11px] font-medium leading-tight ${
                          isSelected
                            ? "text-blue-600"
                            : "text-[var(--foreground)]"
                        }`}
                      >
                        {node.label}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-[10px] tabular-nums text-[var(--muted)]">
                          {dist}m
                        </span>
                        {gatewayMode === "ble" && <BleIndicator dist={dist} />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Quick add random messages ────────────────── */}
          <div className={isPanel ? "w-full" : "mx-auto w-full max-w-lg px-4"}>
            <div className="flex items-center justify-between pb-1.5">
              <span className="text-[10px] font-semibold tracking-wide text-[var(--accent)]/80 uppercase">
                ⚡ Quick add
              </span>
              <span className="text-[10px] text-[var(--muted)]/50">
                {scheduledMessages.length} queued
              </span>
            </div>

            <div className="rounded-xl border border-[var(--foreground)]/[0.06] bg-[var(--foreground)]/[0.03] p-3">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]/70">Count messages</span>
              </div>

              <div className="grid grid-cols-1 gap-2 text-[10px]">
                <label className="flex w-24 flex-col gap-1">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={quickCount}
                    onChange={(e) => setQuickCount(parseInt(e.target.value) || 1)}
                    className="h-7 w-24 rounded-md border border-[var(--foreground)]/[0.08] bg-white/80 px-2 text-[11px] text-[var(--foreground)]"
                  />
                </label>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)] text-[9px]">Min</span>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={quickMinOffset}
                    onChange={(e) => setQuickMinOffset(parseInt(e.target.value) || 0)}
                    className="h-7 rounded-md border border-[var(--foreground)]/[0.08] bg-white/80 px-2 text-[11px] text-[var(--foreground)]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)] text-[9px]">Max</span>
                  <input
                    type="number"
                    min={quickMinOffset}
                    max={999}
                    value={quickMaxOffset}
                    onChange={(e) => setQuickMaxOffset(parseInt(e.target.value) || quickMinOffset)}
                    className="h-7 rounded-md border border-[var(--foreground)]/[0.08] bg-white/80 px-2 text-[11px] text-[var(--foreground)]"
                  />
                </label>
              </div>

              <div className="mt-1 text-center">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]/70">Send delay range (ticks)</span>
              </div>

              <div className="mt-2 flex items-center gap-2 text-[10px]">
                <span className="text-[9px] text-[var(--muted)]">Distribution</span>
                <div className="flex items-center gap-1 rounded-full bg-[var(--foreground)]/[0.06] p-0.5">
                  <button
                    onClick={() => setQuickSamplingMode("uniform")}
                    className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                      quickSamplingMode === "uniform"
                        ? "bg-white text-[var(--foreground)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    Uniform
                  </button>
                  <button
                    onClick={() => setQuickSamplingMode("random")}
                    className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                      quickSamplingMode === "random"
                        ? "bg-white text-[var(--foreground)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    Random
                  </button>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Min bytes</span>
                  <input
                    type="number"
                    min={1}
                    max={256}
                    value={quickMinBytes}
                    onChange={(e) => setQuickMinBytes(parseInt(e.target.value) || 1)}
                    className="h-7 rounded-md border border-[var(--foreground)]/[0.08] bg-white/80 px-2 text-[11px] text-[var(--foreground)]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Max bytes</span>
                  <input
                    type="number"
                    min={quickMinBytes}
                    max={256}
                    value={quickMaxBytes}
                    onChange={(e) => setQuickMaxBytes(parseInt(e.target.value) || quickMinBytes)}
                    className="h-7 rounded-md border border-[var(--foreground)]/[0.08] bg-white/80 px-2 text-[11px] text-[var(--foreground)]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">TTL (ticks)</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={quickTTL}
                    onChange={(e) => setQuickTTL(parseInt(e.target.value) || 1)}
                    className="h-7 rounded-md border border-[var(--foreground)]/[0.08] bg-white/80 px-2 text-[11px] text-[var(--foreground)]"
                    title="Time-to-live: messages expire after this many ticks"
                  />
                </label>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--muted)]">Sender</span>
                  <div className="flex items-center gap-1 rounded-full bg-[var(--foreground)]/[0.06] p-0.5">
                    <button
                      onClick={() => setQuickSenderMode("selected")}
                      className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                        quickSenderMode === "selected"
                          ? "bg-white text-[var(--foreground)]"
                          : "text-[var(--muted)]"
                      }`}
                    >
                      Selected
                    </button>
                    <button
                      onClick={() => setQuickSenderMode("random")}
                      className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                        quickSenderMode === "random"
                          ? "bg-white text-[var(--foreground)]"
                          : "text-[var(--muted)]"
                      }`}
                    >
                      Random
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleQueueRandomMessages}
                  disabled={!canQuickAdd}
                  className={`rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors ${
                    canQuickAdd
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--foreground)]/[0.06] text-[var(--muted)]/50 cursor-not-allowed"
                  }`}
                >
                  Queue Messages
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK_OPS.map((op) => (
                  <label
                    key={op.id}
                    className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] ${
                      quickOps[op.id]
                        ? "border-blue-500/40 bg-blue-500/10 text-blue-600"
                        : "border-[var(--foreground)]/[0.08] text-[var(--muted)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={quickOps[op.id]}
                      onChange={(e) =>
                        setQuickOps((prev) => ({
                          ...prev,
                          [op.id]: e.target.checked,
                        }))
                      }
                      className="h-3 w-3"
                    />
                    {op.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* ── Global message queue ───────────────────────── */}
          <div className={isPanel ? "w-full" : "mx-auto w-full max-w-lg px-4"}>
            <div className="flex items-center justify-between pb-1.5">
              <span className="text-[10px] font-semibold tracking-wide text-[var(--foreground)]/70 uppercase">
                📬 Message Queue
              </span>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-[var(--suggest)]">
                  {messages.filter(m => m.status === "sending" || m.status === "routing").length} active
                </span>
                {messages.filter(m => m.status === "failed").length > 0 && (
                  <>
                    <span className="text-[var(--muted)]/30">·</span>
                    <span className="text-red-500/70">
                      {messages.filter(m => m.status === "failed").length} failed
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="max-h-[320px] overflow-y-auto rounded-xl border border-[var(--foreground)]/[0.06] bg-[var(--foreground)]/[0.02] scrollbar-thin">
              {/* Queued messages (not yet sent) */}
              {scheduledMessages.length > 0 && (
                <div className="border-b border-[var(--foreground)]/[0.04] p-2">
                  <div className="pb-1.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]/60">
                    Queued ({scheduledMessages.length})
                  </div>
                  {scheduledMessages
                    .sort((a, b) => a.sendTick - b.sendTick)
                    .slice(0, 10)
                    .map((msg, idx) => {
                      const node = nodes.find(n => n.id === msg.fromNodeId);
                      const dest = nodes.find(n => n.id === msg.toNodeId);
                      const currentTick = simState?.tick ?? 0;
                      const ticksUntil = msg.sendTick - currentTick;
                      return (
                        <div
                          key={`queued-${idx}`}
                          className="mb-1.5 rounded-lg bg-white/40 p-2 text-[10px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-[9px] text-[var(--foreground)]/60">
                                <span className="font-medium">{node?.label ?? `Node ${msg.fromNodeId}`}</span>
                                <span className="text-[var(--muted)]/40">→</span>
                                <span className="font-medium">{dest?.label ?? `Node ${msg.toNodeId}`}</span>
                              </div>
                              <div className="truncate text-[9px] text-[var(--muted)]/70">
                                {msg.text}
                              </div>
                              <div className="mt-1 text-[8px] text-[var(--muted)]/50">
                                Sends at tick {msg.sendTick} ({ticksUntil > 0 ? `in ${ticksUntil}t` : 'now'})
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  {scheduledMessages.length > 10 && (
                    <div className="text-center text-[9px] text-[var(--muted)]/40">
                      +{scheduledMessages.length - 10} more
                    </div>
                  )}
                </div>
              )}

              {/* In-flight messages */}
              {messages.filter(m => m.status === "sending" || m.status === "routing").length > 0 && (
                <div className="border-b border-[var(--foreground)]/[0.04] p-2">
                  <div className="pb-1.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--suggest)]/70">
                    In Flight ({messages.filter(m => m.status === "sending" || m.status === "routing").length})
                  </div>
                  {messages
                    .filter(m => m.status === "sending" || m.status === "routing")
                    .slice(-8)
                    .reverse()
                    .map((msg) => {
                      const sender = nodes.find(n => n.id === msg.fromNodeId);
                      const receiver = nodes.find(n => n.id === msg.toNodeId);
                      const ticksInFlight = (simState?.tick ?? 0) - msg.timestamp;
                      const messageBytes = Math.ceil(msg.text.length / 2);
                      const estimatedTotalTicks = Math.max(3, Math.ceil(messageBytes / 8));
                      const progress = Math.min(100, (ticksInFlight / estimatedTotalTicks) * 100);
                      const bytesSent = Math.min(messageBytes, Math.floor((ticksInFlight / estimatedTotalTicks) * messageBytes));
                      const ttlRemaining = msg.ttl ? msg.ttl - ticksInFlight : null;
                      const isNearExpiry = ttlRemaining !== null && ttlRemaining <= 2;
                      
                      return (
                        <div
                          key={msg.id}
                          className={`mb-1.5 rounded-lg p-2 text-[10px] ${
                            isNearExpiry 
                              ? "bg-red-500/10 ring-1 ring-red-500/20" 
                              : "bg-[var(--suggest)]/5"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-[9px]">
                                <span className="font-medium text-[var(--foreground)]/70">
                                  {sender?.label ?? `Node ${msg.fromNodeId}`}
                                </span>
                                <span className="text-[var(--muted)]/40">→</span>
                                <span className="font-medium text-[var(--foreground)]/70">
                                  {receiver?.label ?? `Node ${msg.toNodeId}`}
                                </span>
                                {ttlRemaining !== null && (
                                  <span className={`text-[8px] tabular-nums ${
                                    isNearExpiry ? "text-red-500 font-bold" : "text-[var(--muted)]/50"
                                  }`}>
                                    {ttlRemaining}⏱
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[9px] text-[var(--muted)]/60">
                                {msg.text}
                              </div>
                              <div className="mt-1.5 flex items-center gap-2">
                                <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--foreground)]/[0.08]">
                                  <div
                                    className={`h-full transition-all duration-300 ${
                                      isNearExpiry ? "bg-red-500" : "bg-[var(--suggest)]"
                                    }`}
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                <span className="shrink-0 text-[8px] tabular-nums text-[var(--muted)]/50">
                                  {bytesSent}/{messageBytes}B
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Failed messages */}
              {messages.filter(m => m.status === "failed").length > 0 && (
                <div className="border-b border-[var(--foreground)]/[0.04] p-2">
                  <div className="pb-1.5 text-[9px] font-semibold uppercase tracking-wide text-red-500/70">
                    Failed / Expired ({messages.filter(m => m.status === "failed").length})
                  </div>
                  {messages
                    .filter(m => m.status === "failed")
                    .slice(-5)
                    .reverse()
                    .map((msg) => {
                      const sender = nodes.find(n => n.id === msg.fromNodeId);
                      const receiver = nodes.find(n => n.id === msg.toNodeId);
                      const messageBytes = Math.ceil(msg.text.length / 2);
                      
                      return (
                        <div
                          key={msg.id}
                          className="mb-1 rounded-lg bg-red-500/5 p-1.5 text-[10px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-[9px] text-red-500/70">
                                <span>{sender?.label ?? `Node ${msg.fromNodeId}`}</span>
                                <span>→</span>
                                <span>{receiver?.label ?? `Node ${msg.toNodeId}`}</span>
                                <span className="text-[8px]">✗</span>
                                {msg.ttl && <span className="text-[8px]">TTL:{msg.ttl}</span>}
                              </div>
                            </div>
                            <span className="shrink-0 text-[8px] tabular-nums text-red-500/40">
                              {messageBytes}B
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  {messages.filter(m => m.status === "failed").length > 5 && (
                    <div className="text-center text-[9px] text-[var(--muted)]/40">
                      +{messages.filter(m => m.status === "failed").length - 5} more
                    </div>
                  )}
                </div>
              )}

              {/* Delivered messages */}
              {messages.filter(m => m.status === "delivered").length > 0 && (
                <div className="p-2">
                  <div className="pb-1.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--accent)]/60">
                    Delivered ({messages.filter(m => m.status === "delivered").length})
                  </div>
                  {messages
                    .filter(m => m.status === "delivered")
                    .slice(-5)
                    .reverse()
                    .map((msg) => {
                      const sender = nodes.find(n => n.id === msg.fromNodeId);
                      const receiver = nodes.find(n => n.id === msg.toNodeId);
                      const messageBytes = Math.ceil(msg.text.length / 2);
                      
                      return (
                        <div
                          key={msg.id}
                          className="mb-1 rounded-lg bg-[var(--accent)]/5 p-1.5 text-[10px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-[9px] text-[var(--muted)]/50">
                                <span>{sender?.label ?? `Node ${msg.fromNodeId}`}</span>
                                <span>→</span>
                                <span>{receiver?.label ?? `Node ${msg.toNodeId}`}</span>
                                <span className="text-[8px]">✓</span>
                              </div>
                            </div>
                            <span className="shrink-0 text-[8px] tabular-nums text-[var(--muted)]/40">
                              {messageBytes}B
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  {messages.filter(m => m.status === "delivered").length > 5 && (
                    <div className="text-center text-[9px] text-[var(--muted)]/40">
                      +{messages.filter(m => m.status === "delivered").length - 5} more
                    </div>
                  )}
                </div>
              )}

              {/* Empty state */}
              {messages.length === 0 && scheduledMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-1 p-6 text-center">
                  <span className="text-lg">📭</span>
                  <span className="text-[10px] text-[var(--muted)]/50">
                    No messages queued
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={isPanel ? "flex min-w-0 flex-1 flex-col" : ""}>
          {/* ── Destination selector (LoRa mesh) ───────────── */}
          <div className={isPanel ? "w-full" : "mx-auto w-full max-w-lg px-4"}>
        <div className="flex items-center gap-2 pb-1.5">
          <span className="text-[10px] font-semibold tracking-wide text-[var(--accent)]/80 uppercase">
            📡 Send to
          </span>
          <span className="text-[10px] text-[var(--muted)]/50">LoRa mesh</span>
          <span className="text-[10px] text-[var(--muted)]/40">
            · {discoveredCount} discovered
          </span>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none">
          {/* Log chip */}
          <button
            onClick={() => setSelectedDest("all")}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 transition-all duration-150 ${
              selectedDest === "all"
                ? "bg-[var(--foreground)]/[0.08] ring-1.5 ring-[var(--foreground)]/20"
                : "bg-[var(--foreground)]/[0.03] hover:bg-[var(--foreground)]/[0.06]"
            }`}
          >
            <span
              className={`text-[11px] font-medium leading-tight ${
                selectedDest === "all"
                  ? "text-[var(--foreground)]"
                  : "text-[var(--muted)]"
              }`}
            >
              Log
            </span>
            {messages.length > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--foreground)]/10 px-1 text-[9px] font-semibold tabular-nums text-[var(--muted)]">
                {messages.length}
              </span>
            )}
          </button>

          {/* Destination chips — labels come from gossip discovery */}
          {destinations.map((node) => {
            const isSelected = selectedDest === node.id;
            const displayLabel = node.discoveredLabel ?? `Node ${node.id}`;
            const threadCount = messages.filter(
              (m) =>
                (m.toNodeId === node.id &&
                    m.fromNodeId === activeGatewayId) ||
                  (m.fromNodeId === node.id &&
                    m.toNodeId === activeGatewayId),
            ).length;
            return (
              <button
                key={node.id}
                onClick={() => setSelectedDest(node.id)}
                className={`flex shrink-0 flex-col items-start gap-1 rounded-xl px-4 py-2.5 transition-all duration-150 ${
                  isSelected
                    ? "bg-[var(--accent)]/10 ring-1.5 ring-[var(--accent)]"
                    : node.isDiscovered
                      ? "bg-[var(--foreground)]/[0.03] hover:bg-[var(--foreground)]/[0.06]"
                      : "bg-[var(--foreground)]/[0.02] opacity-50 hover:opacity-70"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`text-[11px] font-medium leading-tight ${
                      isSelected
                        ? "text-[var(--accent)]"
                        : node.isDiscovered
                          ? "text-[var(--foreground)]"
                          : "text-[var(--muted)]"
                    }`}
                  >
                    {displayLabel}
                  </span>
                  {!node.isDiscovered && (
                    <span className="text-[9px] text-[var(--muted)]/40">?</span>
                  )}
                  {threadCount > 0 && (
                    <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--accent)]/20 px-0.5 text-[8px] font-bold tabular-nums text-[var(--accent)]">
                      {threadCount}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {node.isDiscovered ? (
                    <span className="text-[10px] text-[var(--muted)]/60">
                      via gossip
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--muted)]/40">
                      undiscovered
                    </span>
                  )}
                  <LoraIndicator discovered={node.isDiscovered} />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Divider ────────────────────────────────────── */}
      <div className={isPanel ? "w-full px-1" : "mx-auto w-full max-w-lg px-6"}>
        <div className="h-px bg-[var(--foreground)]/[0.06]" />
      </div>

      {/* ── Thread / log area ──────────────────────────── */}
      <div
        ref={threadRef}
        className={`flex w-full flex-1 flex-col gap-2 overflow-y-auto scrollbar-none ${
          isPanel
            ? "min-h-0 px-2 py-4"
            : "mx-auto max-w-lg px-6 py-4"
        }`}
      >
        {selectedDest === null ? (
          <EmptyState
            icon="📡"
            title="Select a destination"
            description="Pick a gateway above (BLE), then choose where to send via the LoRa mesh. Node names appear as gossip heartbeats propagate."
          />
        ) : selectedDest === "all" ? (
          threadMessages.length === 0 ? (
            <EmptyState
              icon="📋"
              title="No messages yet"
              description="Send a message to any node and it will appear in the log."
            />
          ) : (
            threadMessages.map((msg) => (
              <LogEntry
                key={msg.id}
                message={msg}
                resolveLabel={resolveLabel}
              />
            ))
          )
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-blue-500/20">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  Send
                </h3>
                <span className="text-xs text-[var(--foreground)]/60">
                  {sentMessages.length} total
                </span>
              </div>
              {sentMessages.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--foreground)]/60">
                  No outgoing messages yet
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {sentMessages.map((msg) => {
                    const status = getStatusDisplay(msg.status);
                    return (
                      <div
                        key={msg.id}
                        className="rounded-md border border-blue-500/20 bg-[var(--surface)]/60 p-3"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs text-[var(--foreground)]/60">
                          <span className={`font-semibold ${status.color}`}>
                            {status.text}
                          </span>
                          <span>Tick {msg.timestamp}</span>
                        </div>
                        <div className="mt-2 text-sm font-mono text-[var(--foreground)] break-words">
                          {msg.text || "(empty)"}
                        </div>
                        <div className="mt-2 text-xs text-[var(--foreground)]/60">
                          To: {resolveLabel(msg.toNodeId)} | Hops: {msg.hops ?? 0}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-green-500/20">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  Receive
                </h3>
                <span className="text-xs text-[var(--foreground)]/60">
                  {receivedMessages.length} total
                </span>
              </div>
              {receivedMessages.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--foreground)]/60">
                  No incoming messages yet
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {receivedMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className="rounded-md border border-green-500/20 bg-[var(--surface)]/60 p-3"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-[var(--foreground)]/60">
                        <span className="font-semibold text-green-500">
                          RECEIVED
                        </span>
                        <span>Tick {msg.timestamp}</span>
                      </div>
                      <div className="mt-2 text-sm font-mono text-[var(--foreground)] break-words">
                        {msg.text || "(empty)"}
                      </div>
                      <div className="mt-2 text-xs text-[var(--foreground)]/60">
                        From: {resolveLabel(msg.fromNodeId)} | Hops: {msg.hops ?? 0}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* ── Summary bar ────────────────────────────────── */}
      {messages.length > 0 && (
        <div
          className={`flex w-full items-center justify-center gap-4 py-1.5 ${
            isPanel ? "px-2" : "mx-auto max-w-lg px-6"
          }`}
        >
          <span className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            {deliveredCount} delivered
          </span>
          {pendingCount > 0 && (
            <span className="flex items-center gap-1.5 text-[10px] text-[var(--suggest)]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--suggest)]" />
              {pendingCount} in transit
            </span>
          )}
          <span className="text-[10px] text-[var(--muted)]/50">
            tick {simState?.tick ?? 0}
          </span>
        </div>
      )}

      {/* ── Route path + Composer ───────────────────────── */}
      <div className={isPanel ? "w-full px-2 pb-2" : "mx-auto w-full max-w-lg px-4 pb-2"}>
        {/* Route visualization */}
        {gatewayNode &&
          selectedDest !== null &&
          selectedDest !== "all" && (
            <div className="mb-2 flex items-center justify-center gap-1.5 text-[10px] text-[var(--muted)]">
              <span className="text-blue-500">📱 You</span>
              <span className="text-[var(--muted)]/30">—</span>
              <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-blue-600">
                BLE
              </span>
              <span className="text-[var(--muted)]/30">→</span>
              <span className="font-medium text-[var(--foreground)]/70">
                {gatewayNode.label}
              </span>
              <span className="text-[var(--muted)]/30">—</span>
              <span className="rounded-md bg-[var(--accent)]/10 px-1.5 py-0.5 text-[var(--accent)]">
                LoRa
              </span>
              <span className="text-[var(--muted)]/30">→</span>
              <span className="font-medium text-[var(--foreground)]/70">
                {selectedNodeLabel}
              </span>
            </div>
          )}

        {/* Input bar */}
        <div
          className={`flex items-center gap-2 rounded-2xl px-4 py-2 transition-colors ${
            canSend || (selectedDest !== null && selectedDest !== "all")
              ? "bg-white shadow-sm ring-1 ring-[var(--foreground)]/[0.06]"
              : "bg-[var(--foreground)]/[0.03]"
          }`}
        >
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={
              selectedDest === null ||
              selectedDest === "all" ||
              !gatewayNode
            }
            placeholder={
              !gatewayNode
                ? gatewayMode === "any"
                  ? "Select a node to act as"
                  : "No gateway in BLE range"
                : selectedDest !== null && selectedDest !== "all"
                  ? `Message ${selectedNodeLabel} via ${gatewayNode.label}…`
                  : selectedDest === "all"
                    ? "Viewing message log"
                    : "Select a destination above"
            }
            className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/60 outline-none disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150 ${
              canSend
                ? "bg-[var(--accent)] text-white shadow-sm hover:opacity-90"
                : "bg-[var(--foreground)]/[0.06] text-[var(--muted)]/40"
            }`}
            aria-label="Send message"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>

        {/* BLE connection hint */}
        {gatewayNode && (
          <p className="mt-1 text-center text-[10px] text-[var(--muted)]/40">
            {gatewayMode === "ble"
              ? `${gatewayDist}m to ${gatewayNode.label} via Bluetooth · ${bleSignal(gatewayDist).label}`
              : `Acting as ${gatewayNode.label} (simulation override)`}
          </p>
        )}
      </div>
        </div>
      </div>
    </div>
  );
}

/* ── Empty State ───────────────────────────────────────── */

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <span className="text-3xl">{icon}</span>
      <span className="text-sm font-medium text-[var(--foreground)]/60">
        {title}
      </span>
      <span className="max-w-64 text-xs leading-relaxed text-[var(--muted)]">
        {description}
      </span>
    </div>
  );
}

/* ── Log Entry (all-messages view) ─────────────────────── */

function LogEntry({
  message,
  resolveLabel,
}: {
  message: ChatMessage;
  resolveLabel: (id: number) => string;
}) {
  const fromLabel = resolveLabel(message.fromNodeId);
  const toLabel = resolveLabel(message.toNodeId);

  const {
    text: statusText,
    color: statusColor,
    bg: statusBg,
    icon: statusIcon,
  } = getStatusDisplay(message.status);

  return (
    <div className="flex items-start gap-3 rounded-xl bg-[var(--foreground)]/[0.02] px-4 py-3 transition-colors hover:bg-[var(--foreground)]/[0.04]">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ${statusBg}`}
      >
        {statusIcon}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1 text-[10px]">
          <span className="rounded bg-blue-500/10 px-1 text-blue-600">
            BLE
          </span>
          <span className="font-medium text-[var(--foreground)]">
            {fromLabel}
          </span>
          <span className="text-[var(--muted)]/40">→</span>
          <span className="rounded bg-[var(--accent)]/10 px-1 text-[var(--accent)]">
            LoRa
          </span>
          <span className="font-medium text-[var(--foreground)]">
            {toLabel}
          </span>
        </div>

        <p className="truncate text-[11px] text-[var(--foreground)]/70">
          {message.text}
        </p>

        <div className="flex items-center gap-2">
          <span className={`text-[10px] ${statusColor}`}>{statusText}</span>
          <span className="text-[10px] text-[var(--muted)]/40">
            tick {message.timestamp}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Status display helpers ────────────────────────────── */

function getStatusDisplay(status: ChatMessage["status"]) {
  const map = {
    sending: {
      text: "Sending…",
      color: "text-[var(--muted)]",
      icon: "↑",
      bg: "bg-[var(--foreground)]/[0.06] text-[var(--muted)]",
    },
    routing: {
      text: "Routing across mesh…",
      color: "text-[var(--suggest)]",
      icon: "↗",
      bg: "bg-[var(--suggest)]/10 text-[var(--suggest)]",
    },
    delivered: {
      text: "Delivered ✓",
      color: "text-[var(--accent)]",
      icon: "✓",
      bg: "bg-[var(--accent)]/10 text-[var(--accent)]",
    },
    failed: {
      text: "Failed to deliver",
      color: "text-red-500",
      icon: "✗",
      bg: "bg-red-500/10 text-red-500",
    },
  } as const;
  return map[status];
}
