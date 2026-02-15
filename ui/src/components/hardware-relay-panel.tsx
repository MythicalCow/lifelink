"use client";

import { useState } from "react";
import type { GatewayState } from "@/hooks/use-gateway-bridge";

interface HardwareRelayPanelProps {
  online: boolean;
  state: GatewayState;
  logs: string[];
  onCommand: (cmd: string) => Promise<void>;
}

export function HardwareRelayPanel({ online, state, logs, onCommand }: HardwareRelayPanelProps) {
  const [dst, setDst] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="absolute right-4 top-20 z-[900] w-[360px] rounded-2xl bg-white/95 p-3 shadow-lg ring-1 ring-[var(--foreground)]/[0.08] backdrop-blur">
      <div className="text-xs font-semibold tracking-wide text-[var(--foreground)]/70 uppercase">Hardware Relay</div>
      <div className="mt-1 text-[11px] text-[var(--muted)]">
        {online ? (state.connected ? `Connected ${state.node_id} (${state.node_name || "node"})` : "Gateway online, no node connected") : "Gateway offline"}
      </div>
      <div className="mt-1 text-[10px] text-[var(--muted)]/70">
        Hopping: leader {state.hop_leader || "-"} · ch {state.hop_channel} · {state.hop_frequency_mhz.toFixed(1)} MHz
      </div>

      <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
        <input
          value={dst}
          onChange={(e) => setDst(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4).toUpperCase())}
          placeholder="Destination hex (e.g. E504)"
          className="h-9 rounded-lg border border-[var(--foreground)]/[0.12] px-2 text-xs"
        />
        <button
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onCommand("STATUS");
            } catch (err) {
              setError(String(err));
            } finally {
              setBusy(false);
            }
          }}
          disabled={!online || !state.connected || busy}
          className="rounded-lg border border-[var(--foreground)]/[0.12] px-2 text-xs disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Send over BLE->LoRa"
        className="mt-2 h-16 w-full rounded-lg border border-[var(--foreground)]/[0.12] p-2 text-xs"
      />
      <button
        onClick={async () => {
          if (!dst || !text.trim()) return;
          setBusy(true);
          setError("");
          try {
            await onCommand(`SEND|${dst}|${text.trim()}`);
            setText("");
          } catch (err) {
            setError(String(err));
          } finally {
            setBusy(false);
          }
        }}
        disabled={!online || !state.connected || !dst || !text.trim() || busy}
        className="mt-2 h-9 w-full rounded-lg bg-[var(--accent)] text-xs font-semibold text-white disabled:opacity-40"
      >
        Send via Hardware Mesh
      </button>
      {error && <div className="mt-2 text-[10px] text-red-600">{error}</div>}

      <div className="mt-2 max-h-24 overflow-y-auto rounded-lg bg-slate-950 p-2 font-mono text-[10px] text-green-300">
        {(logs.slice(0, 6)).map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}
