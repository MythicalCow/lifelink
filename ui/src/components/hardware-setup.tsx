"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { MAP_CENTER, MAP_ZOOM } from "@/config/nodes";
import type { GatewayDevice, GatewayState } from "@/hooks/use-gateway-bridge";

const LocationPicker = dynamic(
  () => import("@/components/location-picker").then((m) => m.LocationPicker),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-[var(--foreground)]/[0.05]" /> },
);

interface HardwareSetupProps {
  state: GatewayState;
  online: boolean;
  devices: GatewayDevice[];
  onScan: () => Promise<GatewayDevice[]>;
  onConnect: (address: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onCommand: (cmd: string) => Promise<void>;
  onNodeConfigured?: (config: {
    name: string;
    lat: number;
    lng: number;
    isAnchor: boolean;
    hardwareIdHex: string;
    bleAddress: string;
  }) => void;
}

export function HardwareSetup({
  state,
  online,
  devices,
  onScan,
  onConnect,
  onDisconnect,
  onCommand,
  onNodeConfigured,
}: HardwareSetupProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [nodeName, setNodeName] = useState("");
  const [isAnchor, setIsAnchor] = useState(false);
  const [selectedLat, setSelectedLat] = useState<number | null>(null);
  const [selectedLng, setSelectedLng] = useState<number | null>(null);
  const [error, setError] = useState("");

  const connected = state.connected;

  useEffect(() => {
    if (connected && state.node_name) {
      setNodeName(state.node_name);
    }
  }, [connected, state.node_name]);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.address === selectedAddress) ?? null,
    [devices, selectedAddress],
  );

  const handleScan = useCallback(async () => {
    setError("");
    setIsScanning(true);
    try {
      const found = await onScan();
      if (!selectedAddress && found.length > 0) {
        setSelectedAddress(found[0].address);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsScanning(false);
    }
  }, [onScan, selectedAddress]);

  const handleConnect = useCallback(async () => {
    if (!selectedAddress) return;
    setError("");
    setIsConnecting(true);
    try {
      await onConnect(selectedAddress);
      if (!state.node_id) {
        await onCommand("WHOAMI");
        await onCommand("STATUS");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsConnecting(false);
    }
  }, [onCommand, onConnect, selectedAddress, state.node_id]);

  const handleSaveConfig = useCallback(async () => {
    if (!connected || !state.node_id || !nodeName.trim() || selectedLat === null || selectedLng === null) return;
    setError("");
    try {
      await onCommand(`NAME|${nodeName.trim()}`);
      await onCommand("STATUS");
      onNodeConfigured?.({
        name: nodeName.trim(),
        lat: selectedLat,
        lng: selectedLng,
        isAnchor,
        hardwareIdHex: state.node_id.toUpperCase(),
        bleAddress: state.ble_address,
      });
      // Streamline multi-node setup: save, then disconnect/reset for next node.
      await onDisconnect();
      setSelectedAddress("");
      setSelectedLat(null);
      setSelectedLng(null);
      setIsAnchor(false);
      setNodeName("");
    } catch (err) {
      setError(String(err));
    }
  }, [connected, isAnchor, nodeName, onCommand, onDisconnect, onNodeConfigured, selectedLat, selectedLng, state.ble_address, state.node_id]);

  return (
    <div className="absolute inset-0 top-16 bottom-10 z-[500] flex">
      <div className="flex-1 p-4">
        {connected ? (
          <div className="h-full flex flex-col">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">Set Node Location</h3>
                <p className="text-[11px] text-[var(--muted)]">
                  {isAnchor ? "Click exact GPS location for this anchor node" : "Pick rough node location for map and setup"}
                </p>
              </div>
              {selectedLat !== null && (
                <div className="rounded-lg bg-[var(--accent)]/10 px-3 py-1.5 text-[11px] font-medium tabular-nums text-[var(--accent)]">
                  {selectedLat.toFixed(5)}, {selectedLng?.toFixed(5)}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0">
              <LocationPicker
                center={MAP_CENTER}
                zoom={MAP_ZOOM}
                selectedLat={selectedLat}
                selectedLng={selectedLng}
                existingNodes={[]}
                onSelect={(lat, lng) => {
                  setSelectedLat(lat);
                  setSelectedLng(lng);
                }}
              />
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-[var(--muted)]">
            Connect to a BLE node from the right panel to configure it.
          </div>
        )}
      </div>

      <div className="w-[400px] border-l border-[var(--foreground)]/[0.06] overflow-y-auto p-4">
        <div className="mb-3 rounded-lg bg-[var(--foreground)]/[0.03] p-3 text-xs">
          Gateway: {online ? "online" : "offline"} · {connected ? "connected" : "disconnected"}
        </div>

        <div className="mb-3 space-y-2">
          <button
            onClick={handleScan}
            disabled={!online || isScanning}
            className="w-full rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {isScanning ? "Scanning..." : "Scan BLE Devices"}
          </button>
          <select
            value={selectedAddress}
            onChange={(e) => setSelectedAddress(e.target.value)}
            className="h-10 w-full rounded-lg border border-[var(--foreground)]/[0.12] bg-white px-3 text-xs"
          >
            <option value="">Select device</option>
            {devices.map((d) => (
              <option key={d.address} value={d.address}>
                {d.name} ({d.address}) RSSI {d.rssi}
              </option>
            ))}
          </select>
          {!connected ? (
            <button
              onClick={handleConnect}
              disabled={!online || !selectedAddress || isConnecting}
              className="w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {isConnecting ? "Connecting..." : "Connect Node"}
            </button>
          ) : (
            <button
              onClick={onDisconnect}
              className="w-full rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600"
            >
              Disconnect Node
            </button>
          )}
        </div>

        <div className="mb-3 rounded-xl bg-[var(--foreground)]/[0.03] p-3 text-xs">
          <div>Node ID: {state.node_id || "-"}</div>
          <div>Name: {state.node_name || "-"}</div>
          <div>BLE: {state.ble_address || selectedDevice?.address || "-"}</div>
          <div className="mt-1 text-[var(--muted)]">
            Hop leader {state.hop_leader || "-"} · ch {state.hop_channel} · {state.hop_frequency_mhz.toFixed(1)} MHz
          </div>
        </div>

        <div className="mb-3 rounded-xl bg-[var(--foreground)]/[0.03] p-3">
          <label className="mb-1 block text-[11px] font-medium text-[var(--foreground)]/70">Node Name</label>
          <input
            value={nodeName}
            onChange={(e) => setNodeName(e.target.value)}
            placeholder={state.node_name || "Node name"}
            className="mb-2 h-10 w-full rounded-lg border border-[var(--foreground)]/[0.12] bg-white px-3 text-sm"
          />
          <label className="flex items-center gap-2 text-xs text-[var(--foreground)]/70">
            <input type="checkbox" checked={isAnchor} onChange={(e) => setIsAnchor(e.target.checked)} />
            GPS Anchor Node
          </label>
          <button
            onClick={handleSaveConfig}
            disabled={!connected || !state.node_id || !nodeName.trim() || selectedLat === null || selectedLng === null}
            className="mt-3 h-10 w-full rounded-lg bg-[var(--accent)] text-xs font-semibold text-white disabled:opacity-40"
          >
            Save Node Config
          </button>
        </div>

        {error && <div className="rounded-lg bg-red-500/10 p-2 text-xs text-red-600">{error}</div>}
      </div>
    </div>
  );
}
