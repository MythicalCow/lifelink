"use client";

import { useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { SensorNode } from "@/types/sensor";
import type { GatewayDevice, GatewayState } from "@/hooks/use-gateway-bridge";

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
  gatewayLogs,
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

  const connectedSenderHex = gatewayState.node_id?.toUpperCase() || "";

  const hardwareNodes = useMemo(
    () => nodes.filter((n) => Boolean(n.hardwareIdHex)),
    [nodes],
  );

  const senderNode = useMemo(
    () => hardwareNodes.find((n) => n.hardwareIdHex?.toUpperCase() === connectedSenderHex) ?? null,
    [connectedSenderHex, hardwareNodes],
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

  const handleConnect = async () => {
    if (!selectedAddress) return;
    setBusy(true);
    setError("");
    try {
      await onGatewayConnect(selectedAddress);
      await onGatewayCommand("WHOAMI");
      await onGatewayCommand("STATUS");
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
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-[var(--foreground)]/[0.06]">
            <div className="text-[10px] font-semibold tracking-wide text-blue-600 uppercase">
              Sender (Bluetooth)
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">
              {gatewayOnline
                ? gatewayState.connected
                  ? `Connected to 0x${connectedSenderHex} (${gatewayState.node_name || "node"})`
                  : "Gateway online · not connected"
                : "Gateway offline"}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleScan}
                disabled={!gatewayOnline || busy}
                className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
              >
                Scan
              </button>
              <select
                value={selectedAddress}
                onChange={(e) => setSelectedAddress(e.target.value)}
                className="h-8 flex-1 rounded-lg border border-[var(--foreground)]/[0.12] bg-white px-2 text-[11px]"
              >
                <option value="">Pick BLE device</option>
                {gatewayDevices.map((d) => (
                  <option key={d.address} value={d.address}>
                    {d.name} ({d.address}) RSSI {d.rssi}
                  </option>
                ))}
              </select>
              {gatewayState.connected ? (
                <button
                  onClick={onGatewayDisconnect}
                  disabled={busy}
                  className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-600 disabled:opacity-40"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={!gatewayOnline || !selectedAddress || busy}
                  className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                >
                  Connect
                </button>
              )}
            </div>
            <div className="mt-2 text-[10px] text-[var(--muted)]/80">
              Hop: leader {gatewayState.hop_leader || "-"} · ch {gatewayState.hop_channel} ·{" "}
              {gatewayState.hop_frequency_mhz.toFixed(1)} MHz
            </div>
          </div>

          <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-[var(--foreground)]/[0.06]">
            <div className="text-[10px] font-semibold tracking-wide text-[var(--accent)] uppercase">
              Receiver (LoRa)
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">
              Select destination node saved from Setup.
            </div>
            <select
              value={selectedReceiverHex}
              onChange={(e) => setSelectedReceiverHex(e.target.value)}
              className="mt-2 h-8 w-full rounded-lg border border-[var(--foreground)]/[0.12] bg-white px-2 text-[11px]"
            >
              <option value="">Choose receiver</option>
              {receiverNodes.map((n) => (
                <option key={n.id} value={(n.hardwareIdHex || "").toUpperCase()}>
                  {nodeDisplayName(n)} ({(n.hardwareIdHex || "").toUpperCase()})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-4">
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
            {gatewayLogs.slice(0, 5).map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
