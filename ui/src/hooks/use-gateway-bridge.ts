"use client";

import { useCallback, useEffect, useState } from "react";

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

export function useGatewayBridge() {
  const [online, setOnline] = useState(false);
  const [state, setState] = useState<GatewayState>(DEFAULT_STATE);
  const [logs, setLogs] = useState<string[]>([]);
  const [devices, setDevices] = useState<GatewayDevice[]>([]);
  const [messageHistory, setMessageHistory] = useState<GatewayMessageHistory[]>([]);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${GATEWAY_BASE}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json() as Promise<T>;
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const data = await api<{ state: GatewayState; logs: string[] }>("/state");
      setOnline(true);
      setState(data.state);
      setLogs(data.logs);
      return data.state;
    } catch {
      setOnline(false);
      return null;
    }
  }, [api]);

  const scan = useCallback(async () => {
    const data = await api<{ devices: GatewayDevice[] }>("/devices?timeout=2.2");
    setDevices(data.devices);
    return data.devices;
  }, [api]);

  const connect = useCallback(
    async (address: string) => {
      await api<{ ok: boolean }>("/connect", {
        method: "POST",
        body: JSON.stringify({ address }),
      });
      let latest = await refreshState();
      // Fast follow-up polling for async identity warmup after non-blocking connect.
      for (let i = 0; i < 8; i += 1) {
        if (latest?.node_id) break;
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        latest = await refreshState();
      }
    },
    [api, refreshState],
  );

  const disconnect = useCallback(async () => {
    await api<{ ok: boolean }>("/disconnect", { method: "POST" });
    setMessageHistory([]);
    await refreshState();
  }, [api, refreshState]);

  const fetchMessages = useCallback(async () => {
    const data = await api<{ messages: GatewayMessageHistory[] }>("/messages?limit=60");
    setMessageHistory(data.messages);
    return data.messages;
  }, [api]);

  const command = useCallback(
    async (cmd: string) => {
      await api<{ ok: boolean }>("/command", {
        method: "POST",
        body: JSON.stringify({ command: cmd }),
      });
      await refreshState();
    },
    [api, refreshState],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshState();
    const id = window.setInterval(refreshState, 500);
    return () => window.clearInterval(id);
  }, [refreshState]);

  return {
    online,
    state,
    logs,
    devices,
    messageHistory,
    scan,
    connect,
    disconnect,
    command,
    fetchMessages,
    refreshState,
  };
}
