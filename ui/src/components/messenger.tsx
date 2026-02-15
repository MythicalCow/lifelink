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
  GatewayMessageHistory,
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
  gatewayMessageHistory: GatewayMessageHistory[];
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
  gatewayMessageHistory,
  onGatewayScan,
  onGatewayConnect,
  onGatewayDisconnect,
  onGatewayCommand,
}: MessengerProps) {
  const [selectedAddress, setSelectedAddress] = useState("");
  const [selectedReceiverHex, setSelectedReceiverHex] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
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

  /* ── Merge hardware history → chat ──
   *
   * ingestedRef tracks which hardware history entries have already been
   * merged into the chat. It must be reset whenever connectedSenderHex
   * changes — INCLUDING when it transitions through "" and back to the
   * same value (Bug 6: E504 → "" → E504 didn't clear, leaving an empty
   * chat on reconnect to the same node).
   *
   * Fix: unconditionally reset on every connectedSenderHex change.
   * No guards. No activeNodeRef equality check.
   */
  const ingestedRef = useRef(new Set<string>());

  // Reset on EVERY connectedSenderHex change — no guards, no skipping.
  useEffect(() => {
    ingestedRef.current = new Set<string>();
    setMessages([]);
    setSelectedReceiverHex("");
  }, [connectedSenderHex, setMessages]);

  // Ingest hardware message history into the chat list.
  useEffect(() => {
    if (!connectedSenderHex || gatewayMessageHistory.length === 0) return;

    setMessages((prev) => {
      let next = prev;
      const now = Date.now();

      for (const h of gatewayMessageHistory) {
        const peerHex = h.peer.toUpperCase();
        const isSent = h.direction === "S";
        const key = `hw-${connectedSenderHex}-${h.direction}-${peerHex}-${h.msg_id}`;

        if (ingestedRef.current.has(key)) continue;
        ingestedRef.current.add(key);

        const fromNodeId = isSent ? parseInt(connectedSenderHex, 16) : parseInt(peerHex, 16);
        const toNodeId = isSent ? parseInt(peerHex, 16) : parseInt(connectedSenderHex, 16);

        // Bug 4 fix: match optimistic sends on body text too, not just
        // sender/receiver/time. Without this, two quick sends to the same
        // peer get cross-matched and produce wrong vital/urgency metadata.
        if (isSent) {
          const optIdx = next.findIndex(
            (m) =>
              m.id.startsWith("msg-") &&
              m.direction === "sent" &&
              m.fromNodeId === fromNodeId &&
              m.toNodeId === toNodeId &&
              m.text === h.body &&
              now - m.timestamp < 120_000,
          );
          if (optIdx >= 0) {
            if (next === prev) next = [...prev];
            next[optIdx] = {
              ...next[optIdx],
              id: key,
              status: "sent",
              vital: h.vital,
              intent: h.intent,
              urgency: h.urgency,
            };
            continue;
          }
        }

        if (next.some((m) => m.id === key)) continue;
        if (next === prev) next = [...prev];
        next.push({
          id: key,
          fromNodeId,
          toNodeId,
          text: h.body,
          timestamp: now,
          direction: isSent ? "sent" : "received",
          status: "sent",
          vital: h.vital,
          intent: h.intent,
          urgency: h.urgency,
        });
      }
      return next;
    });
  }, [gatewayMessageHistory, connectedSenderHex, setMessages]);

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
      !busy,
  );

  /* ── Handlers ── */
  const handleScan = async () => {
    setError("");
    try {
      const found = await onGatewayScan();
      if (!selectedAddress && found.length > 0) {
        setSelectedAddress(found[0].address);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleConnect = async (address?: string) => {
    const target = address || selectedAddress;
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      await onGatewayConnect(target);
      setSelectedAddress(target);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
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
    setBusy(true);
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
      setBusy(false);
    }
  };

  /* ── Render ── */
  return (
    <div className="absolute inset-0 top-16 bottom-10 z-[500] flex flex-col">
      {/* ── Connection / Receiver bar ── */}
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-[var(--foreground)]/[0.06]">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold text-[var(--foreground)]">
              {gatewayState.connected
                ? `Connected · ${gatewayState.node_name || `0x${connectedSenderHex}`}`
                : "Not connected"}
            </div>
            <button
              onClick={handleScan}
              disabled={!gatewayOnline || busy}
              className="rounded-lg bg-[var(--foreground)]/[0.06] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] disabled:opacity-40"
            >
              Scan
            </button>
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
                  disabled={!gatewayOnline || busy}
                  onClick={() => {
                    if (isActive) {
                      void onGatewayDisconnect();
                      return;
                    }
                    void handleConnect(d.address);
                  }}
                  className={`rounded-full px-3 py-1.5 text-[11px] ring-1 transition-colors disabled:opacity-40 ${
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
                  onClick={() => setSelectedReceiverHex(hex)}
                  className={`rounded-full px-3 py-1.5 text-[11px] ring-1 transition-colors ${
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
              disabled={!gatewayState.connected || !selectedReceiverHex || busy}
              className="h-10 flex-1 rounded-lg border border-[var(--foreground)]/[0.12] px-3 text-sm disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-40"
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
