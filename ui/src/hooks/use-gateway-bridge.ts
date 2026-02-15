"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface GatewayState {
  connected: boolean;
  ble_name: string;
  ble_address: string;
  node_id: string;
  node_name: string;
  hop_leader: string;
  hop_seed: string;
  hop_seq: number;
  hop_channel: number;
  hop_frequency_mhz: number;
  last_response: string;
}

export interface GatewayDevice {
  name: string;
  address: string;
  rssi: number;
}

export interface GatewayMessageHistory {
  idx: number;
  direction: "S" | "R";
  peer: string;
  msg_id: number;
  vital: boolean;
  intent: string;
  urgency: number;
  body: string;
}

export interface GatewayMember {
  idx: number;
  node_id: string;
  name: string;
  age_ms: number;
  heartbeat_seq: number;
  hop_seed: string;
  hops_away: number;
}

const GATEWAY_BASE = "http://127.0.0.1:8765";

const DEFAULT_STATE: GatewayState = {
  connected: false,
  ble_name: "",
  ble_address: "",
  node_id: "",
  node_name: "",
  hop_leader: "",
  hop_seed: "",
  hop_seq: 0,
  hop_channel: 0,
  hop_frequency_mhz: 0,
  last_response: "",
};

/* ── Shallow-equality helpers (prevent needless React re-renders) ── */

function statesEqual(a: GatewayState, b: GatewayState): boolean {
  return (
    a.connected === b.connected &&
    a.node_id === b.node_id &&
    a.node_name === b.node_name &&
    a.ble_address === b.ble_address &&
    a.hop_seq === b.hop_seq &&
    a.hop_channel === b.hop_channel &&
    a.last_response === b.last_response
  );
}

function membersEqual(a: GatewayMember[], b: GatewayMember[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].node_id !== b[i].node_id ||
      a[i].name !== b[i].name ||
      a[i].hops_away !== b[i].hops_away
    )
      return false;
  }
  return true;
}

function messagesEqual(
  a: GatewayMessageHistory[],
  b: GatewayMessageHistory[],
): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  const la = a[a.length - 1];
  const lb = b[b.length - 1];
  return la.idx === lb.idx && la.msg_id === lb.msg_id && la.direction === lb.direction;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/* ════════════════════════════════════════════════════════════════════
 * Hook
 * ════════════════════════════════════════════════════════════════════ */

export function useGatewayBridge() {
  const [online, setOnline] = useState(false);
  const [state, setState] = useState<GatewayState>(DEFAULT_STATE);
  const [logs, setLogs] = useState<string[]>([]);
  const [devices, setDevices] = useState<GatewayDevice[]>([]);
  const [messageHistory, setMessageHistory] = useState<GatewayMessageHistory[]>([]);
  const [members, setMembers] = useState<GatewayMember[]>([]);

  /*
   * epochRef — monotonically increasing counter, bumped on every connect
   * and disconnect. Every poll tick captures the epoch at its start. If
   * connect/disconnect fires mid-tick, the epoch changes. Before each
   * setState call the tick checks `epochRef.current === myEpoch`; if not,
   * the data is stale and is discarded. This is the primary defence
   * against Bug 1 (state flicker) and Bug 2 (stale writes).
   *
   * abortRef — AbortController whose signal is threaded into every poll
   * fetch(). On connect/disconnect we abort it and create a fresh one.
   * This immediately terminates in-flight HTTP requests instead of letting
   * them complete and write stale data.
   *
   * tickRunning — simple re-entrancy guard. Because the abort kills any
   * in-flight await, the finally block runs quickly and the ref is freed.
   * Bug 3 (stuck ref) is eliminated because the abort ensures the tick
   * cannot stay alive across a connect/disconnect boundary.
   */
  const epochRef = useRef(0);
  const abortRef = useRef<AbortController>(new AbortController());
  const tickRunning = useRef(false);
  const bleConnected = useRef(false);

  /* ── Raw fetch helper ── */
  const rawFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(`${GATEWAY_BASE}${path}`, {
        ...init,
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<T>;
    },
    [],
  );

  /* ── User actions ── */

  const scan = useCallback(async () => {
    const data = await rawFetch<{ devices: GatewayDevice[] }>("/devices?timeout=2.2");
    setDevices(data.devices);
    return data.devices;
  }, [rawFetch]);

  const connect = useCallback(
    async (address: string) => {
      // 1. Bump epoch — any in-flight poll writes become stale
      const myEpoch = ++epochRef.current;

      // 2. Abort in-flight poll fetches so they can't write stale data
      abortRef.current.abort();
      abortRef.current = new AbortController();

      // 3. Pause BLE branch of poll loop
      bleConnected.current = false;

      // 4. Clear stale data synchronously (same microtask as setState batch)
      setMessageHistory([]);
      setMembers([]);

      // 5. BLE connect (takes 1-5s, no AbortSignal — we want this to finish)
      const data = await rawFetch<{ ok: boolean; state: GatewayState }>("/connect", {
        method: "POST",
        body: JSON.stringify({ address }),
      });

      // 6. Stale? Another connect/disconnect happened while we were waiting
      if (epochRef.current !== myEpoch) return;

      if (data.state) {
        setState(data.state);
        setOnline(true);
        bleConnected.current = data.state.connected;
      }

      if (!bleConnected.current || epochRef.current !== myEpoch) return;

      // 7. Immediate fetch — user sees members + messages RIGHT AWAY
      try {
        const md = await rawFetch<{ members: GatewayMember[] }>("/members?limit=60");
        if (epochRef.current === myEpoch) setMembers(md.members);
      } catch {
        /* poll will retry */
      }
      try {
        const hd = await rawFetch<{ messages: GatewayMessageHistory[] }>("/messages?limit=60");
        if (epochRef.current === myEpoch) setMessageHistory(hd.messages);
      } catch {
        /* poll will retry */
      }
    },
    [rawFetch],
  );

  const disconnect = useCallback(async () => {
    // Bump epoch + abort BEFORE any async work
    ++epochRef.current;
    abortRef.current.abort();
    abortRef.current = new AbortController();
    bleConnected.current = false;

    // Clear synchronously — no stale poll can write after this
    setMessageHistory([]);
    setMembers([]);
    setState(DEFAULT_STATE);

    try {
      await rawFetch<{ ok: boolean }>("/disconnect", { method: "POST" });
    } catch {
      /* ignore */
    }
  }, [rawFetch]);

  const command = useCallback(
    async (cmd: string) => {
      await rawFetch<{ ok: boolean }>("/command", {
        method: "POST",
        body: JSON.stringify({ command: cmd }),
      });
    },
    [rawFetch],
  );

  /* ── Single polling loop ──
   *
   * Dependencies: [rawFetch] — stable (no deps itself), so this effect is
   * created once and never torn down. No React state in the dep array.
   * The connected check uses a ref, not state.connected.
   */
  useEffect(() => {
    abortRef.current = new AbortController();

    const tick = async () => {
      if (tickRunning.current) return;
      tickRunning.current = true;

      // Capture epoch + signal at tick start
      const myEpoch = epochRef.current;
      const signal = abortRef.current.signal;

      try {
        // ── 1. State (lightweight GET, no BLE lock) ──
        try {
          const data = await rawFetch<{ state: GatewayState; logs: string[] }>("/state", {
            signal,
          });
          if (epochRef.current !== myEpoch) return; // stale
          setOnline(true);
          setState((prev) => (statesEqual(prev, data.state) ? prev : data.state));
          setLogs(data.logs);
          bleConnected.current = data.state.connected;
        } catch (e) {
          if (isAbort(e) || epochRef.current !== myEpoch) return;
          setOnline(false);
          bleConnected.current = false;
        }

        if (!bleConnected.current || epochRef.current !== myEpoch) return;

        // ── 2. Members ──
        try {
          const md = await rawFetch<{ members: GatewayMember[] }>("/members?limit=60", {
            signal,
          });
          if (epochRef.current !== myEpoch) return;
          setMembers((prev) => (membersEqual(prev, md.members) ? prev : md.members));
        } catch (e) {
          if (isAbort(e) || epochRef.current !== myEpoch) return;
        }

        // ── 3. Messages ──
        try {
          const hd = await rawFetch<{ messages: GatewayMessageHistory[] }>("/messages?limit=60", {
            signal,
          });
          if (epochRef.current !== myEpoch) return;
          setMessageHistory((prev) =>
            messagesEqual(prev, hd.messages) ? prev : hd.messages,
          );
        } catch (e) {
          if (isAbort(e) || epochRef.current !== myEpoch) return;
        }
      } finally {
        tickRunning.current = false;
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 800);
    return () => {
      window.clearInterval(id);
      abortRef.current.abort();
    };
  }, [rawFetch]);

  return {
    online,
    state,
    logs,
    devices,
    messageHistory,
    members,
    scan,
    connect,
    disconnect,
    command,
  };
}
