"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ManagedNode = {
  nodeId: string;
  name: string;
  bleName: string;
  addedAt: number;
};

const STORAGE_KEY = "lifelink-managed-nodes";
const GATEWAY_BASE = "http://127.0.0.1:8765";

type DiscoveredDevice = {
  name: string;
  address: string;
  rssi: number;
};

type GatewayState = {
  connected: boolean;
  ble_name: string;
  ble_address: string;
  node_id: string;
  node_name: string;
  last_response: string;
};

export default function BridgePage() {
  const [managedNodes, setManagedNodes] = useState<ManagedNode[]>([]);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [gatewayState, setGatewayState] = useState<GatewayState>({
    connected: false,
    ble_name: "",
    ble_address: "",
    node_id: "",
    node_name: "",
    last_response: "",
  });
  const [nameDraft, setNameDraft] = useState("");
  const [destinationNodeId, setDestinationNodeId] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [manualDestination, setManualDestination] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [gatewayOnline, setGatewayOnline] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as ManagedNode[];
      if (Array.isArray(parsed)) {
        setManagedNodes(parsed);
      }
    } catch {
      // Ignore malformed local cache.
    }
  }, []);

  const persistNodes = useCallback((next: ManagedNode[]) => {
    setManagedNodes(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => [line, ...prev].slice(0, 120));
  }, []);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${GATEWAY_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const data = await api<{ state: GatewayState; logs: string[] }>("/state");
      setGatewayOnline(true);
      setGatewayState(data.state);
      setLogs(data.logs);
      if (data.state.node_name) {
        setNameDraft((prev) => prev || data.state.node_name);
      }
    } catch {
      setGatewayOnline(false);
    }
  }, [api]);

  const sendCommand = useCallback(
    async (cmd: string) => {
      try {
        await api<{ ok: boolean }>("/command", {
          method: "POST",
          body: JSON.stringify({ command: cmd }),
        });
        await refreshState();
      } catch (error) {
        appendLog(`ERR: ${String(error)}`);
      }
    },
    [api, appendLog, refreshState],
  );

  const scanDevices = useCallback(async () => {
    try {
      setIsScanning(true);
      const result = await api<{ devices: DiscoveredDevice[] }>("/devices?timeout=5");
      setDevices(result.devices);
      if (!selectedAddress && result.devices.length > 0) {
        setSelectedAddress(result.devices[0].address);
      }
      appendLog(`Scan found ${result.devices.length} LifeLink device(s).`);
    } catch (error) {
      appendLog(`ERR: ${String(error)}`);
    } finally {
      setIsScanning(false);
    }
  }, [api, appendLog, selectedAddress]);

  const connect = useCallback(async () => {
    if (!selectedAddress) {
      appendLog("Select a scanned device first.");
      return;
    }
    try {
      setIsConnecting(true);
      await api<{ ok: boolean }>("/connect", {
        method: "POST",
        body: JSON.stringify({ address: selectedAddress }),
      });
      await refreshState();
    } catch (error) {
      appendLog(`ERR: ${String(error)}`);
    } finally {
      setIsConnecting(false);
    }
  }, [api, appendLog, refreshState, selectedAddress]);

  const disconnect = useCallback(async () => {
    try {
      await api<{ ok: boolean }>("/disconnect", { method: "POST" });
      await refreshState();
    } catch (error) {
      appendLog(`ERR: ${String(error)}`);
    }
  }, [api, appendLog, refreshState]);

  useEffect(() => {
    refreshState();
    const timer = window.setInterval(refreshState, 1500);
    return () => window.clearInterval(timer);
  }, [refreshState]);

  const canRegister = Boolean(gatewayState.connected && gatewayState.node_id);
  const canSend = Boolean(
    gatewayState.connected && messageDraft.trim() && (destinationNodeId || manualDestination),
  );

  const resolvedDestination = useMemo(
    () => (manualDestination.trim() ? manualDestination.trim().toUpperCase() : destinationNodeId),
    [destinationNodeId, manualDestination],
  );

  const registerConnectedNode = useCallback(() => {
    if (!gatewayState.node_id) return;
    const next = [...managedNodes];
    const existingIdx = next.findIndex((n) => n.nodeId === gatewayState.node_id);
    const record: ManagedNode = {
      nodeId: gatewayState.node_id,
      name: gatewayState.node_name || gatewayState.node_id,
      bleName: gatewayState.ble_name || "LifeLink",
      addedAt: Date.now(),
    };
    if (existingIdx >= 0) {
      next[existingIdx] = record;
    } else {
      next.push(record);
    }
    persistNodes(next);
    appendLog(`Saved node ${record.nodeId} (${record.name}) to manager list.`);
  }, [appendLog, gatewayState, managedNodes, persistNodes]);

  const sendRename = useCallback(async () => {
    if (!nameDraft.trim()) return;
    await sendCommand(`NAME|${nameDraft.trim()}`);
  }, [nameDraft, sendCommand]);

  const sendMeshMessage = useCallback(async () => {
    if (!resolvedDestination || !messageDraft.trim()) return;
    await sendCommand(`SEND|${resolvedDestination}|${messageDraft.trim()}`);
    setMessageDraft("");
  }, [messageDraft, resolvedDestination, sendCommand]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 md:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-4 md:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-semibold">LifeLink BLE Bridge Test</h1>
          <p className="mt-1 text-sm text-slate-600">
            Uses a local BLE gateway service (not browser BLE). Connect one node, then relay over LoRa.
          </p>

          <div className="mt-3 rounded-lg bg-slate-100 p-2 text-xs">
            <span className="font-semibold">Gateway:</span> {gatewayOnline ? "Online" : "Offline"} at {GATEWAY_BASE}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={scanDevices}
              disabled={isScanning || !gatewayOnline}
              className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isScanning ? "Scanning..." : "Scan BLE Devices"}
            </button>
            <button
              onClick={connect}
              disabled={isConnecting || gatewayState.connected || !selectedAddress || !gatewayOnline}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isConnecting ? "Connecting..." : "Connect BLE Node"}
            </button>
            <button
              onClick={disconnect}
              disabled={!gatewayState.connected || !gatewayOnline}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Disconnect
            </button>
            <button
              onClick={() => sendCommand("WHOAMI")}
              disabled={!gatewayState.connected || !gatewayOnline}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              Refresh Identity
            </button>
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-600">Scanned Devices</label>
            <select
              value={selectedAddress}
              onChange={(e) => setSelectedAddress(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
            >
              <option value="">Choose BLE device</option>
              {devices.map((d) => (
                <option key={d.address} value={d.address}>
                  {d.name} ({d.address}) RSSI {d.rssi}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 rounded-xl bg-slate-100 p-3 text-sm">
            <div><span className="font-medium">BLE Device:</span> {gatewayState.ble_name || "-"}</div>
            <div><span className="font-medium">BLE Address:</span> {gatewayState.ble_address || "-"}</div>
            <div><span className="font-medium">Node ID:</span> {gatewayState.node_id || "-"}</div>
            <div><span className="font-medium">Node Name:</span> {gatewayState.node_name || "-"}</div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Set node name"
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
            />
            <button
              onClick={sendRename}
              disabled={!gatewayState.connected || !nameDraft.trim()}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Save Name
            </button>
            <button
              onClick={registerConnectedNode}
              disabled={!canRegister}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Add/Update Node
            </button>
          </div>

          <div className="mt-6">
            <h2 className="text-sm font-semibold">Relay Message Over LoRa</h2>
            <p className="text-xs text-slate-500">Command format: <code>SEND|DEST_HEX|text</code></p>

            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <select
                value={destinationNodeId}
                onChange={(e) => setDestinationNodeId(e.target.value)}
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              >
                <option value="">Pick saved destination</option>
                {managedNodes.map((node) => (
                  <option key={node.nodeId} value={node.nodeId}>
                    {node.name} ({node.nodeId})
                  </option>
                ))}
              </select>
              <input
                value={manualDestination}
                onChange={(e) => setManualDestination(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4))}
                placeholder="Or destination hex (e.g. 1A2B)"
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              />
            </div>

            <textarea
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              placeholder="Type message to send over mesh..."
              className="mt-2 h-24 w-full rounded-lg border border-slate-300 p-3 text-sm"
            />

            <button
              onClick={sendMeshMessage}
              disabled={!canSend}
              className="mt-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Send via Connected Node
            </button>
          </div>
        </section>

        <section className="grid gap-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Managed Nodes (Step 1)</h2>
            <p className="mt-1 text-xs text-slate-500">Add nodes by connecting over BLE and pressing Add/Update Node.</p>
            <div className="mt-3 space-y-2">
              {managedNodes.length === 0 ? (
                <div className="rounded-lg bg-slate-100 p-3 text-xs text-slate-500">No nodes saved yet.</div>
              ) : (
                managedNodes.map((node) => (
                  <div key={node.nodeId} className="rounded-lg border border-slate-200 p-3 text-xs">
                    <div className="font-medium">{node.name}</div>
                    <div className="text-slate-500">ID: {node.nodeId} · BLE: {node.bleName}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold">Bridge Logs</h2>
            <div className="mt-3 h-[360px] overflow-y-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-green-300">
              {logs.length === 0 ? (
                <div className="text-slate-400">No log events yet.</div>
              ) : (
                logs.map((line, idx) => <div key={`${line}-${idx}`}>{line}</div>)
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
