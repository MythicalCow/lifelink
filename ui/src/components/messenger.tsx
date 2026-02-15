"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { SensorNode } from "@/types/sensor";
import type {
  GatewayDevice,
  GatewayMember,
  GatewayState,
} from "@/hooks/use-gateway-bridge";

export interface ChatMessage {
  id: string;
  fromNodeId: number;
  toNodeId: number;
  text: string;
  timestamp: number;
  direction: "sent" | "received";
  status: "queued" | "sent" | "failed";
  vital?: boolean;
  intent?: string;
  urgency?: number;
}

interface MessengerProps {
  nodes: SensorNode[];
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  msgCounterRef: MutableRefObject<number>;
  gatewayOnline: boolean;
  gatewayState: GatewayState;
  gatewayDevices: GatewayDevice[];
  gatewayMembers: GatewayMember[];
  gatewayLogs: string[];
  onGatewayScan: () => Promise<GatewayDevice[]>;
  onGatewayConnect: (address: string) => Promise<void>;
  onGatewayDisconnect: () => Promise<void>;
  onGatewayCommand: (command: string) => Promise<void>;
}

function toHex(nodeIdNum: number): string {
  return nodeIdNum.toString(16).toUpperCase().padStart(4, "0");
}

function nodeDisplayName(node: SensorNode): string {
  return node.label || node.hardwareIdHex || `Node ${node.id}`;
}

/* ── Inline spinner ── */
function Spinner({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export function Messenger({
  nodes,
  messages,
  setMessages,
  msgCounterRef,
  gatewayOnline,
  gatewayState,
  gatewayDevices,
  gatewayMembers,
  gatewayLogs,
  onGatewayScan,
  onGatewayConnect,
  onGatewayDisconnect,
  onGatewayCommand,
}: MessengerProps) {
  const [selectedAddress, setSelectedAddress] = useState("");
  const [selectedReceiverHex, setSelectedReceiverHex] = useState("");
  const [draft, setDraft] = useState("");
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const connectedSenderHex = gatewayState.node_id?.toUpperCase() || "";

  const hardwareNodes = useMemo(
    () => nodes.filter((n) => Boolean(n.hardwareIdHex)),
    [nodes],
  );

  const nodeByAddress = useMemo(
    () =>
      new Map(
        hardwareNodes
          .filter((n) => n.bleAddress)
          .map((n) => [(n.bleAddress || "").toUpperCase(), n] as const),
      ),
    [hardwareNodes],
  );

  /* Receiver list: mesh members excluding the connected node itself. */
  const receiverMembers = useMemo(
    () => gatewayMembers.filter((m) => m.node_id.toUpperCase() !== connectedSenderHex),
    [connectedSenderHex, gatewayMembers],
  );

  const resolveNodeLabel = (hex: string): string => {
    const node = hardwareNodes.find((n) => n.hardwareIdHex?.toUpperCase() === hex);
    if (node) return nodeDisplayName(node);
    const member = gatewayMembers.find((m) => m.node_id.toUpperCase() === hex);
    if (member && member.name) return member.name;
    return `0x${hex}`;
  };

  // Reset on EVERY connectedSenderHex change — no guards, no skipping.
  useEffect(() => {
    setMessages([]);
    setSelectedReceiverHex("");
  }, [connectedSenderHex, setMessages]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  /* ── Derived ── */
  const canSend = Boolean(
    gatewayOnline &&
      gatewayState.connected &&
      connectedSenderHex &&
      selectedReceiverHex &&
      draft.trim() &&
      !busyLabel,
  );

  /* ── Handlers ── */
  const handleRefreshMessages = async () => {
    setBusyLabel("Refreshing messages…");
    setError("");
    try {
      const res = await fetch("http://127.0.0.1:8765/messages?limit=60", {
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data: {
        messages: {
          idx: number;
          direction: string;
          peer: string;
          msg_id: number;
          vital: boolean;
          intent: string;
          urgency: number;
          body: string;
        }[];
      } = await res.json();
      console.log("Refresh Messages response:", data);

      if (!connectedSenderHex || !data.messages || data.messages.length === 0) return;

      const now = Date.now();

      const refreshed: ChatMessage[] = data.messages.map((h) => {
        const peerHex = h.peer.toUpperCase();
        const isSent = h.direction === "S";
        const key = `hw-${connectedSenderHex}-${h.direction}-${peerHex}-${h.msg_id}`;
        const fromNodeId = isSent ? parseInt(connectedSenderHex, 16) : parseInt(peerHex, 16);
        const toNodeId = isSent ? parseInt(peerHex, 16) : parseInt(connectedSenderHex, 16);
        return {
          id: key,
          fromNodeId,
          toNodeId,
          text: h.body,
          timestamp: now,
          direction: isSent ? ("sent" as const) : ("received" as const),
          status: "sent" as const,
          vital: h.vital,
          intent: h.intent,
          urgency: h.urgency,
        };
      });

      setMessages(refreshed);
    } catch (err) {
      setError(String(err));
      console.error("Failed to refresh messages:", err);
    } finally {
      setBusyLabel(null);
    }
  };

  const handleScan = async () => {
    setBusyLabel("Scanning for devices…");
    setError("");
    try {
      const found = await onGatewayScan();
      if (!selectedAddress && found.length > 0) {
        setSelectedAddress(found[0].address);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyLabel(null);
    }
  };

  const handleConnect = async (address?: string) => {
    const target = address || selectedAddress;
    if (!target) return;
    setBusyLabel("Connecting…");
    setError("");
    try {
      await onGatewayConnect(target);
      setSelectedAddress(target);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyLabel(null);
    }
  };

  const handleDisconnect = async () => {
    setBusyLabel("Disconnecting…");
    setError("");
    try {
      await onGatewayDisconnect();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyLabel(null);
    }
  };

  const handleSend = async () => {
    if (!canSend) return;
    const text = draft.trim();
    const messageId = `msg-${++msgCounterRef.current}`;
    const fromNum = parseInt(connectedSenderHex, 16) || 0;
    const toNum = parseInt(selectedReceiverHex, 16) || 0;

    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        fromNodeId: fromNum,
        toNodeId: toNum,
        text,
        timestamp: Date.now(),
        direction: "sent",
        status: "queued",
      },
    ]);
    setDraft("");
    setBusyLabel("Sending…");
    setError("");

    try {
      await onGatewayCommand(`SEND|${selectedReceiverHex}|${text}`);
      // Bug 5: ESP32 accepted the message into its TX queue. This does NOT
      // mean the destination received it. Label as "sent" (not "delivered").
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status: "sent" } : m)),
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status: "failed" } : m)),
      );
      setError(String(err));
    } finally {
      setBusyLabel(null);
    }
  };

  /* ── Render ── */
  return (
    <div className="absolute inset-0 top-16 bottom-10 z-[500] flex flex-col">
      {/* ── Loading overlay ── */}
      {busyLabel && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-xl bg-white/70 backdrop-blur-sm">
          <Spinner size={32} />
          <span className="text-sm font-medium text-[var(--foreground)]">
            {busyLabel}
          </span>
        </div>
      )}

      {/* ── Connection / Receiver bar ── */}
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-[var(--foreground)]/[0.06]">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold text-[var(--foreground)]">
              {gatewayState.connected
                ? `Connected · ${gatewayState.node_name || `0x${connectedSenderHex}`}`
                : "Not connected"}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleRefreshMessages()}
                disabled={!!busyLabel}
                className="rounded-lg bg-[var(--foreground)]/[0.06] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] hover:bg-[var(--foreground)]/[0.10] active:scale-95 transition disabled:pointer-events-none"
              >
                Refresh Messages
              </button>
              <button
                onClick={() => void handleScan()}
                disabled={!!busyLabel}
                className="rounded-lg bg-[var(--foreground)]/[0.06] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] hover:bg-[var(--foreground)]/[0.10] active:scale-95 transition disabled:pointer-events-none"
              >
                Scan
              </button>
            </div>
          </div>

          <div className="text-[10px] font-medium tracking-wide text-[var(--muted)] uppercase">
            From
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {gatewayDevices.map((d) => {
              const upperAddr = d.address.toUpperCase();
              const node = nodeByAddress.get(upperAddr);
              const isActive =
                gatewayState.connected && gatewayState.ble_address.toUpperCase() === upperAddr;
              return (
                <button
                  key={`from-${d.address}`}
                  disabled={!!busyLabel}
                  onClick={() => {
                    if (isActive) {
                      void handleDisconnect();
                      return;
                    }
                    void handleConnect(d.address);
                  }}
                  className={`rounded-full px-3 py-1.5 text-[11px] ring-1 transition active:scale-95 disabled:pointer-events-none ${
                    isActive
                      ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30"
                      : "bg-white text-[var(--foreground)] ring-[var(--foreground)]/[0.12] hover:bg-[var(--foreground)]/[0.03]"
                  }`}
                >
                  {node ? nodeDisplayName(node) : d.name || "LifeLink"}
                </button>
              );
            })}
            {gatewayDevices.length === 0 && (
              <div className="text-[11px] text-[var(--muted)]">No senders — hit Scan</div>
            )}
          </div>

          <div className="mt-3 text-[10px] font-medium tracking-wide text-[var(--muted)] uppercase">
            To
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {receiverMembers.map((m) => {
              const hex = m.node_id.toUpperCase();
              const active = selectedReceiverHex === hex;
              const label = m.name || `0x${hex}`;
              return (
                <button
                  key={`to-${hex}`}
                  disabled={!!busyLabel}
                  onClick={() => setSelectedReceiverHex(hex)}
                  className={`rounded-full px-3 py-1.5 text-[11px] ring-1 transition active:scale-95 disabled:pointer-events-none ${
                    active
                      ? "bg-[var(--accent)] text-white ring-[var(--accent)]"
                      : "bg-white text-[var(--foreground)] ring-[var(--foreground)]/[0.12] hover:bg-[var(--foreground)]/[0.03]"
                  }`}
                >
                  {label}
                  {m.hops_away > 0 && (
                    <span className="ml-1 text-[9px] opacity-60">{m.hops_away}h</span>
                  )}
                </button>
              );
            })}
            {receiverMembers.length === 0 && (
              <div className="text-[11px] text-[var(--muted)]">
                {gatewayState.connected ? "No mesh peers yet" : "Connect a sender to see mesh peers"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Chat ── */}
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-4">
        <div className="flex-1 overflow-y-auto rounded-xl bg-[var(--foreground)]/[0.02] p-3">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
              No messages yet. Connect a sender, pick a receiver, and send.
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((msg) => {
                const isSent = msg.direction === "sent";
                const fromHex = toHex(msg.fromNodeId);
                const toHex_ = toHex(msg.toNodeId);
                return (
                  <div
                    key={msg.id}
                    className={`rounded-lg px-3 py-2 text-xs shadow-sm ring-1 ring-[var(--foreground)]/[0.06] ${
                      isSent ? "bg-blue-50 ml-8" : "bg-white mr-8"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
                      <span
                        className={`rounded px-1.5 py-0.5 font-medium ${
                          isSent
                            ? "bg-blue-500/10 text-blue-700"
                            : "bg-emerald-500/10 text-emerald-700"
                        }`}
                      >
                        {isSent ? "Sent" : "Recv"}
                      </span>
                      <span>
                        {resolveNodeLabel(fromHex)} → {resolveNodeLabel(toHex_)}
                      </span>
                      {msg.vital && (
                        <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-semibold text-red-600">
                          VITAL {msg.intent} U{msg.urgency}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[13px] text-[var(--foreground)]">{msg.text}</div>
                    <div
                      className={`mt-0.5 text-[10px] ${
                        msg.status === "sent"
                          ? "text-green-600"
                          : msg.status === "failed"
                            ? "text-red-600"
                            : "text-[var(--muted)]"
                      }`}
                    >
                      {msg.status === "queued" ? "sending…" : msg.status === "sent" ? "sent ✓" : msg.status}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* ── Compose bar ── */}
        <div className="mt-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-[var(--foreground)]/[0.06]">
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                gatewayState.connected
                  ? selectedReceiverHex
                    ? `Message to ${receiverMembers.find((m) => m.node_id.toUpperCase() === selectedReceiverHex)?.name || `0x${selectedReceiverHex}`}`
                    : "Select a receiver above"
                  : "Connect a sender first"
              }
              disabled={!!busyLabel}
              className="h-10 flex-1 rounded-lg border border-[var(--foreground)]/[0.12] px-3 text-sm disabled:pointer-events-none"
            />
            <button
              onClick={() => void handleSend()}
              disabled={!canSend}
              className="h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-40"
            >
              Send
            </button>
          </div>
          {error && <div className="mt-2 text-[11px] text-red-600">{error}</div>}
          <div className="mt-2 max-h-16 overflow-y-auto rounded-lg bg-slate-950 p-2 font-mono text-[10px] text-green-300">
            {gatewayLogs.slice(0, 4).map((line, idx) => (
              <div key={`${idx}-${line}`}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
