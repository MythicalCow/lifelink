"use client";

import { useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { SensorNode } from "@/types/sensor";
import type {
  GatewayDevice,
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
  status: "sending" | "routing" | "delivered" | "failed";
}

interface MessengerProps {
  nodes: SensorNode[];
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  msgCounterRef: MutableRefObject<number>;
  gatewayOnline: boolean;
  gatewayState: GatewayState;
  gatewayDevices: GatewayDevice[];
  gatewayLogs: string[];
  gatewayMessageHistory: GatewayMessageHistory[];
  onGatewayScan: () => Promise<GatewayDevice[]>;
  onGatewayConnect: (address: string) => Promise<void>;
  onGatewayDisconnect: () => Promise<void>;
  onGatewayCommand: (command: string) => Promise<void>;
  onGatewayFetchMessages: () => Promise<GatewayMessageHistory[]>;
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
  gatewayLogs,
  gatewayMessageHistory,
  onGatewayScan,
  onGatewayConnect,
  onGatewayDisconnect,
  onGatewayCommand,
  onGatewayFetchMessages,
}: MessengerProps) {
  const [selectedAddress, setSelectedAddress] = useState("");
  const [selectedReceiverHex, setSelectedReceiverHex] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connectedSenderHex = gatewayState.node_id?.toUpperCase() || "";

  const hardwareNodes = useMemo(
    () => nodes.filter((n) => Boolean(n.hardwareIdHex)),
    [nodes],
  );

  const senderNode = useMemo(
    () => hardwareNodes.find((n) => n.hardwareIdHex?.toUpperCase() === connectedSenderHex) ?? null,
    [connectedSenderHex, hardwareNodes],
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

  const receiverNodes = useMemo(
    () =>
      hardwareNodes.filter(
        (n) => n.hardwareIdHex && n.hardwareIdHex.toUpperCase() !== connectedSenderHex,
      ),
    [connectedSenderHex, hardwareNodes],
  );

  const resolveNodeLabel = (nodeIdNum: number): string => {
    const hex = toHex(nodeIdNum);
    const node = hardwareNodes.find((n) => n.hardwareIdHex?.toUpperCase() === hex);
    return node ? nodeDisplayName(node) : hex;
  };

  const canSend = Boolean(
    gatewayOnline &&
      gatewayState.connected &&
      connectedSenderHex &&
      selectedReceiverHex &&
      draft.trim() &&
      !busy,
  );

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
      await onGatewayCommand("WHOAMI");
      await onGatewayCommand("STATUS");
      await onGatewayFetchMessages();
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
    const localMessage: ChatMessage = {
      id: messageId,
      fromNodeId: fromNum,
      toNodeId: toNum,
      text,
      timestamp: Date.now(),
      direction: "sent",
      status: "routing",
    };

    setMessages((prev) => [...prev, localMessage]);
    setBusy(true);
    setError("");
    try {
      await onGatewayCommand(`SEND|${selectedReceiverHex}|${text}`);
      await onGatewayCommand("STATUS");
      await onGatewayFetchMessages();
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status: "delivered" } : m)),
      );
      setDraft("");
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status: "failed" } : m)),
      );
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 top-16 bottom-10 z-[500] flex flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-[var(--foreground)]/[0.06]">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold text-[var(--foreground)]">Send</div>
            <button
              onClick={handleScan}
              disabled={!gatewayOnline || busy}
              className="rounded-lg bg-[var(--foreground)]/[0.06] px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] disabled:opacity-40"
            >
              Scan
            </button>
          </div>

          <div className="text-[10px] font-medium tracking-wide text-[var(--muted)] uppercase">
            To
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {receiverNodes.map((n) => {
              const hex = (n.hardwareIdHex || "").toUpperCase();
              const active = selectedReceiverHex === hex;
              return (
                <button
                  key={`rx-${n.id}`}
                  onClick={() => setSelectedReceiverHex(hex)}
                  className={`rounded-full px-3 py-1.5 text-[11px] ring-1 transition-colors ${
                    active
                      ? "bg-[var(--accent)] text-white ring-[var(--accent)]"
                      : "bg-white text-[var(--foreground)] ring-[var(--foreground)]/[0.12] hover:bg-[var(--foreground)]/[0.03]"
                  }`}
                >
                  {nodeDisplayName(n)}
                </button>
              );
            })}
            {receiverNodes.length === 0 && (
              <div className="text-[11px] text-[var(--muted)]">No receivers</div>
            )}
          </div>

          <div className="mt-3 text-[10px] font-medium tracking-wide text-[var(--muted)] uppercase">
            From
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {gatewayDevices.map((d) => {
              const upperAddress = d.address.toUpperCase();
              const node = nodeByAddress.get(upperAddress);
              const isConnectedSender =
                gatewayState.connected && gatewayState.ble_address.toUpperCase() === upperAddress;
              const isSelected = selectedAddress.toUpperCase() === upperAddress;
              return (
                <button
                  key={`sender-${d.address}`}
                  disabled={!gatewayOnline || busy}
                  onClick={() => {
                    if (isConnectedSender) {
                      void onGatewayDisconnect();
                      return;
                    }
                    void handleConnect(d.address);
                  }}
                  className={`rounded-full px-3 py-1.5 text-[11px] ring-1 transition-colors disabled:opacity-40 ${
                    isConnectedSender
                      ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30"
                      : isSelected
                        ? "bg-blue-500/10 text-blue-700 ring-blue-500/30"
                        : "bg-white text-[var(--foreground)] ring-[var(--foreground)]/[0.12] hover:bg-[var(--foreground)]/[0.03]"
                  }`}
                >
                  {node ? nodeDisplayName(node) : d.name || "LifeLink"}
                </button>
              );
            })}
            {gatewayDevices.length === 0 && (
              <div className="text-[11px] text-[var(--muted)]">No senders</div>
            )}
          </div>

          <div className="mt-2 text-[10px] text-[var(--muted)]">
            {gatewayOnline
              ? gatewayState.connected
                ? `Connected · 0x${connectedSenderHex}`
                : "Gateway online"
              : "Gateway offline"}
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-4">
        <div className="mb-3 max-h-28 overflow-y-auto rounded-xl bg-white p-3 shadow-sm ring-1 ring-[var(--foreground)]/[0.06]">
          <div className="mb-1 text-[10px] font-semibold tracking-wide text-[var(--muted)] uppercase">
            Node Message History
          </div>
          {gatewayMessageHistory.length === 0 ? (
            <div className="text-[11px] text-[var(--muted)]">No stored messages on this node yet.</div>
          ) : (
            <div className="space-y-1">
              {gatewayMessageHistory.slice().reverse().slice(0, 12).map((m) => (
                <div key={`hist-${m.idx}-${m.msg_id}`} className="text-[11px] text-[var(--foreground)]">
                  <span className={`mr-1 rounded px-1.5 py-0.5 text-[10px] ${m.direction === "S" ? "bg-blue-500/10 text-blue-700" : "bg-emerald-500/10 text-emerald-700"}`}>
                    {m.direction === "S" ? "Sent" : "Recv"}
                  </span>
                  <span className="mr-1 text-[var(--muted)]">0x{m.peer}</span>
                  <span className="mr-1 rounded bg-[var(--foreground)]/[0.06] px-1.5 py-0.5 text-[10px]">
                    {m.vital ? `VITAL ${m.intent} U${m.urgency}` : "CHAT"}
                  </span>
                  <span className="opacity-90">{m.body}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto rounded-xl bg-[var(--foreground)]/[0.02] p-3">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
              No messages yet. Connect sender, pick receiver, send once.
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className="rounded-lg bg-white px-3 py-2 text-xs shadow-sm ring-1 ring-[var(--foreground)]/[0.06]"
                >
                  <div className="text-[10px] text-[var(--muted)]">
                    BLE {resolveNodeLabel(msg.fromNodeId)} -&gt; LoRa {resolveNodeLabel(msg.toNodeId)}
                  </div>
                  <div className="mt-0.5 text-[13px] text-[var(--foreground)]">{msg.text}</div>
                  <div
                    className={`mt-0.5 text-[10px] ${
                      msg.status === "delivered"
                        ? "text-green-600"
                        : msg.status === "failed"
                          ? "text-red-600"
                          : "text-[var(--muted)]"
                    }`}
                  >
                    {msg.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-[var(--foreground)]/[0.06]">
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                senderNode
                  ? selectedReceiverHex
                    ? `Send from ${nodeDisplayName(senderNode)} to ${selectedReceiverHex}`
                    : "Select a receiver first"
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
          <div className="mt-2 max-h-20 overflow-y-auto rounded-lg bg-slate-950 p-2 font-mono text-[10px] text-green-300">
            {gatewayLogs.slice(0, 5).map((line, idx) => (
              <div key={`${idx}-${line}`}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
