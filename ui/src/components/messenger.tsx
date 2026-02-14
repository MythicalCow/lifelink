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

export interface ChatMessage {
  id: string;
  fromNodeId: number; // gateway node ID (BLE)
  toNodeId: number; // destination node ID (LoRa)
  text: string;
  timestamp: number; // tick when sent
  direction: "sent" | "received";
  status: "sending" | "routing" | "delivered" | "failed";
  hops?: number;
}

/* ── Props ─────────────────────────────────────────────── */

interface MessengerProps {
  nodes: SensorNode[];
  simState: SimState | null;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  msgCounter: MutableRefObject<number>;
  onSendMessage: (from: number, to: number, trackingId?: string) => void;
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
            className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
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
  msgCounter,
  onSendMessage,
}: MessengerProps) {
  const [selectedGateway, setSelectedGateway] = useState<number | null>(null);
  const [selectedDest, setSelectedDest] = useState<DestSelection>(null);
  const [draft, setDraft] = useState("");
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

  // Auto-select nearest gateway
  useEffect(() => {
    if (selectedGateway === null && bleGateways.length > 0) {
      setSelectedGateway(bleGateways[0].id);
    }
  }, [selectedGateway, bleGateways]);

  const gatewayNode = nodes.find((n) => n.id === selectedGateway) ?? null;
  const gatewayDist = gatewayNode ? Math.round(getDistance(gatewayNode)) : 0;

  /* ── Label resolver ──────────────────────────────────
   * Labels come from what the GATEWAY has discovered via
   * gossip heartbeats — not from a hardcoded config.
   * If the gateway hasn't heard about a node yet, we show
   * "Node <id>" (undiscovered).
   * ─────────────────────────────────────────────────── */
  const gatewayState = simState?.nodeStates.find(
    (n) => n.id === selectedGateway,
  );

  const resolveLabel = useMemo(() => {
    const discovered = gatewayState?.discoveredLabels ?? {};
    return (nodeId: number): string => {
      // Gateway's own name
      if (nodeId === selectedGateway && gatewayNode)
        return gatewayNode.label ?? `Node ${nodeId}`;
      // Gossip-discovered label
      if (discovered[nodeId]) return discovered[nodeId];
      // Undiscovered — show generic ID
      return `Node ${nodeId}`;
    };
  }, [gatewayState?.discoveredLabels, selectedGateway, gatewayNode]);

  // How many nodes has the gateway discovered?
  const discoveredCount = Object.keys(
    gatewayState?.discoveredLabels ?? {},
  ).length;

  // All nodes except gateway, annotated with discovery status
  const destinations = useMemo(() => {
    const discovered = gatewayState?.discoveredLabels ?? {};
    return sortedNodes
      .filter((n) => n.id !== selectedGateway)
      .map((n) => ({
        ...n,
        discoveredLabel: discovered[n.id] ?? null,
        isDiscovered: n.id in discovered,
      }));
  }, [sortedNodes, selectedGateway, gatewayState?.discoveredLabels]);

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
                m.fromNodeId === selectedGateway) ||
              (m.fromNodeId === selectedDest &&
                m.toNodeId === selectedGateway),
          )
        : [];

  const handleSend = () => {
    if (
      !draft.trim() ||
      selectedDest === null ||
      selectedDest === "all" ||
      !gatewayNode
    )
      return;

    const id = `msg-${++msgCounter.current}`;
    const msg: ChatMessage = {
      id,
      fromNodeId: gatewayNode.id,
      toNodeId: selectedDest,
      text: draft.trim(),
      timestamp: simState?.tick ?? 0,
      direction: "sent",
      status: "sending",
    };

    setMessages((prev) => [...prev, msg]);
    onSendMessage(gatewayNode.id, selectedDest, id);
    setDraft("");
    inputRef.current?.focus();
  };

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

  return (
    <div className="absolute inset-0 top-16 bottom-10 z-[500] flex flex-col">
      {/* ── Gateway selector (BLE) ──────────────────────── */}
      <div className="mx-auto w-full max-w-lg px-4 pt-2">
        <div className="flex items-center gap-2 pb-1.5">
          <span className="text-[10px] font-semibold tracking-wide text-blue-500/80 uppercase">
            📱 Your gateway
          </span>
          <span className="text-[10px] text-[var(--muted)]/50">BLE</span>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none">
          {bleGateways.length === 0 ? (
            <span className="text-[11px] text-[var(--muted)]">
              No nodes in BLE range ({BLE_RANGE_M}m)
            </span>
          ) : (
            bleGateways.map((node) => {
              const dist = Math.round(getDistance(node));
              const isSelected = selectedGateway === node.id;
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
                    <BleIndicator dist={dist} />
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Destination selector (LoRa mesh) ───────────── */}
      <div className="mx-auto w-full max-w-lg px-4">
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
                  m.fromNodeId === selectedGateway) ||
                (m.fromNodeId === node.id &&
                  m.toNodeId === selectedGateway),
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
      <div className="mx-auto w-full max-w-lg px-6">
        <div className="h-px bg-[var(--foreground)]/[0.06]" />
      </div>

      {/* ── Thread / log area ──────────────────────────── */}
      <div
        ref={threadRef}
        className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-2 overflow-y-auto px-6 py-4 scrollbar-none"
      >
        {selectedDest === null ? (
          <EmptyState
            icon="📡"
            title="Select a destination"
            description="Pick a gateway above (BLE), then choose where to send via the LoRa mesh. Node names appear as gossip heartbeats propagate."
          />
        ) : selectedDest === "all" && threadMessages.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No messages yet"
            description="Send a message to any node and it will appear in the log."
          />
        ) : selectedDest !== "all" && threadMessages.length === 0 ? (
          <EmptyState
            icon="💬"
            title="No messages yet"
            description={`Send your first message to ${selectedNodeLabel}`}
          />
        ) : selectedDest === "all" ? (
          threadMessages.map((msg) => (
            <LogEntry
              key={msg.id}
              message={msg}
              resolveLabel={resolveLabel}
            />
          ))
        ) : (
          threadMessages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              resolveLabel={resolveLabel}
              gatewayLabel={gatewayNode?.label}
            />
          ))
        )}
      </div>

      {/* ── Summary bar ────────────────────────────────── */}
      {messages.length > 0 && (
        <div className="mx-auto flex w-full max-w-lg items-center justify-center gap-4 px-6 py-1.5">
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
      <div className="mx-auto w-full max-w-lg px-4 pb-2">
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
                ? "No gateway in BLE range"
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
            {gatewayDist}m to {gatewayNode.label} via Bluetooth ·{" "}
            {bleSignal(gatewayDist).label}
          </p>
        )}
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

/* ── Message Bubble (chat view) ────────────────────────── */

function MessageBubble({
  message,
  resolveLabel,
  gatewayLabel,
}: {
  message: ChatMessage;
  resolveLabel: (id: number) => string;
  gatewayLabel?: string;
}) {
  const isSent = message.direction === "sent";
  const destLabel = resolveLabel(message.toNodeId);

  const {
    text: statusText,
    color: statusColor,
    icon: statusIcon,
  } = getStatusDisplay(message.status);

  return (
    <div
      className={`flex flex-col gap-0.5 ${isSent ? "items-end" : "items-start"}`}
    >
      {!isSent && (
        <span className="px-3 text-[10px] font-medium text-[var(--muted)]">
          {resolveLabel(message.fromNodeId)}
        </span>
      )}

      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isSent
            ? "rounded-br-md bg-[var(--accent)] text-white"
            : "rounded-bl-md bg-[var(--foreground)]/[0.06] text-[var(--foreground)]"
        }`}
      >
        <p className="text-sm leading-relaxed">{message.text}</p>
      </div>

      {isSent && (
        <span
          className={`flex items-center gap-1 px-1 text-[10px] ${statusColor}`}
        >
          <span>{statusIcon}</span>
          {statusText}
          {message.status === "delivered" && (
            <span className="text-[var(--muted)]">
              · via {gatewayLabel ?? "gateway"} → {destLabel}
            </span>
          )}
          {message.status === "routing" && gatewayLabel && (
            <span className="text-[var(--muted)]/60">
              · from {gatewayLabel}
            </span>
          )}
        </span>
      )}
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
