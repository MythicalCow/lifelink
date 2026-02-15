"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { MAP_CENTER, MAP_ZOOM } from "@/config/nodes";

const LocationPicker = dynamic(
  () => import("@/components/location-picker").then((m) => m.LocationPicker),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-[var(--foreground)]/[0.05]" /> },
);

type ConnectionState = "disconnected" | "scanning" | "connecting" | "connected";

interface DiscoveredDevice {
  id: string;
  name: string;
  rssi: number;
}

interface SensorsProps {
  onNodeConfigured?: (config: {
    name: string;
    lat: number;
    lng: number;
    isAnchor: boolean;
  }) => void;
}

export function Sensors({ onNodeConfigured }: SensorsProps) {
  // BLE connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<DiscoveredDevice | null>(null);

  // Node configuration
  const [nodeName, setNodeName] = useState("");
  const [isAnchor, setIsAnchor] = useState(false);
  const [selectedLat, setSelectedLat] = useState<number | null>(null);
  const [selectedLng, setSelectedLng] = useState<number | null>(null);

  // Simulate BLE scanning
  const handleScan = useCallback(() => {
    setConnectionState("scanning");
    setDiscoveredDevices([]);

    // Simulate discovering devices over 2 seconds
    setTimeout(() => {
      setDiscoveredDevices([
        { id: "LL:01:23:45:67:89", name: "LifeLink-Node-A7F2", rssi: -45 },
        { id: "LL:98:76:54:32:10", name: "LifeLink-Node-B3C1", rssi: -62 },
        { id: "LL:AA:BB:CC:DD:EE", name: "LifeLink-Node-NEW", rssi: -71 },
      ]);
      setConnectionState("disconnected");
    }, 2000);
  }, []);

  const handleConnect = useCallback((device: DiscoveredDevice) => {
    setConnectionState("connecting");
    
    // Simulate connection
    setTimeout(() => {
      setConnectedDevice(device);
      setConnectionState("connected");
      // Pre-fill name from device
      setNodeName(device.name.replace("LifeLink-Node-", "Node "));
    }, 1500);
  }, []);

  const handleDisconnect = useCallback(() => {
    setConnectedDevice(null);
    setConnectionState("disconnected");
    setNodeName("");
    setSelectedLat(null);
    setSelectedLng(null);
    setIsAnchor(false);
  }, []);

  const handleMapSelect = useCallback((lat: number, lng: number) => {
    setSelectedLat(lat);
    setSelectedLng(lng);
  }, []);

  const handleSaveConfig = useCallback(() => {
    if (!connectedDevice || !nodeName.trim() || selectedLat === null || selectedLng === null) return;
    
    onNodeConfigured?.({
      name: nodeName.trim(),
      lat: selectedLat,
      lng: selectedLng,
      isAnchor,
    });

    // Show success feedback (in real app, this would write to the device)
    alert(`Configuration saved to ${connectedDevice.name}!\n\nName: ${nodeName}\nPosition: ${selectedLat.toFixed(5)}, ${selectedLng.toFixed(5)}\nAnchor: ${isAnchor ? "Yes (GPS)" : "No (FTM)"}`);
  }, [connectedDevice, nodeName, selectedLat, selectedLng, isAnchor, onNodeConfigured]);

  const rssiToSignal = (rssi: number): string => {
    if (rssi > -50) return "Excellent";
    if (rssi > -60) return "Good";
    if (rssi > -70) return "Fair";
    return "Weak";
  };

  const rssiToBars = (rssi: number): number => {
    if (rssi > -50) return 4;
    if (rssi > -60) return 3;
    if (rssi > -70) return 2;
    return 1;
  };

  return (
    <div className="absolute inset-0 top-16 bottom-10 z-[500] flex">
      {/* Left panel: Map picker (only shown when connected) */}
      <div className="flex-1 p-4">
        {connectionState === "connected" ? (
          <div className="h-full flex flex-col">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  Set Node Location
                </h3>
                <p className="text-[11px] text-[var(--muted)]">
                  {isAnchor 
                    ? "Click the exact GPS position of this anchor node"
                    : "Click approximate location (will use FTM for precision)"}
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
                onSelect={handleMapSelect}
              />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="mb-4 text-6xl opacity-20">📡</div>
            <h3 className="text-lg font-semibold text-[var(--foreground)]/60">
              Connect to a Node
            </h3>
            <p className="mt-2 max-w-xs text-sm text-[var(--muted)]">
              Scan for nearby LifeLink nodes via Bluetooth to configure their settings.
            </p>
          </div>
        )}
      </div>

      {/* Right panel: BLE connection + Config */}
      <div className="w-[380px] border-l border-[var(--foreground)]/[0.06] overflow-y-auto p-4">
        
        {/* Connection status header */}
        <div className="mb-4 flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
            connectionState === "connected" 
              ? "bg-[var(--accent)]/10 text-[var(--accent)]"
              : "bg-[var(--foreground)]/[0.05] text-[var(--muted)]"
          }`}>
            {connectionState === "connected" ? "📶" : "📴"}
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-[var(--foreground)]">
              {connectionState === "connected" 
                ? connectedDevice?.name 
                : "No Device Connected"}
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              {connectionState === "connected" 
                ? `${rssiToSignal(connectedDevice?.rssi ?? -100)} signal · ${connectedDevice?.id}`
                : "Scan for nearby nodes"}
            </div>
          </div>
          {connectionState === "connected" && (
            <button
              onClick={handleDisconnect}
              className="rounded-lg bg-red-500/10 px-3 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-500/20"
            >
              Disconnect
            </button>
          )}
        </div>

        {/* Scanning / Device list */}
        {connectionState !== "connected" && (
          <div className="mb-4 rounded-xl bg-[var(--foreground)]/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-[var(--foreground)]/70 uppercase">
                Bluetooth Devices
              </span>
              <button
                onClick={handleScan}
                disabled={connectionState === "scanning"}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all ${
                  connectionState === "scanning"
                    ? "bg-blue-500/10 text-blue-500"
                    : "bg-[var(--accent)] text-white hover:opacity-90"
                }`}
              >
                {connectionState === "scanning" ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                    Scanning...
                  </span>
                ) : (
                  "Scan for Nodes"
                )}
              </button>
            </div>

            {discoveredDevices.length === 0 ? (
              <div className="py-6 text-center">
                {connectionState === "scanning" ? (
                  <div className="text-sm text-[var(--muted)]">
                    Looking for LifeLink nodes...
                  </div>
                ) : (
                  <div className="text-sm text-[var(--muted)]">
                    No devices found. Click &quot;Scan&quot; to search.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {discoveredDevices.map((device) => (
                  <button
                    key={device.id}
                    onClick={() => handleConnect(device)}
                    disabled={connectionState === "connecting"}
                    className="flex w-full items-center gap-3 rounded-lg bg-white p-3 text-left shadow-sm ring-1 ring-[var(--foreground)]/[0.06] transition-all hover:ring-[var(--accent)] disabled:opacity-50"
                  >
                    {/* Signal bars */}
                    <div className="flex h-8 w-8 items-center justify-center">
                      <div className="flex items-end gap-0.5">
                        {[1, 2, 3, 4].map((bar) => (
                          <div
                            key={bar}
                            className={`w-1 rounded-sm ${
                              bar <= rssiToBars(device.rssi)
                                ? "bg-[var(--accent)]"
                                : "bg-[var(--foreground)]/10"
                            }`}
                            style={{ height: `${bar * 4 + 4}px` }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--foreground)] truncate">
                        {device.name}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {device.rssi} dBm · {rssiToSignal(device.rssi)}
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-[var(--accent)]">
                      Connect →
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Connecting state */}
        {connectionState === "connecting" && (
          <div className="mb-4 rounded-xl bg-blue-500/5 p-6 text-center">
            <div className="mb-3 inline-block h-8 w-8 animate-spin rounded-full border-3 border-blue-500 border-t-transparent" />
            <div className="text-sm font-medium text-blue-600">Connecting...</div>
            <div className="mt-1 text-[11px] text-blue-500/70">
              Establishing secure BLE connection
            </div>
          </div>
        )}

        {/* Node configuration (only when connected) */}
        {connectionState === "connected" && (
          <>
            <div className="mb-4 rounded-xl bg-[var(--foreground)]/[0.03] p-4">
              <div className="mb-3 text-xs font-semibold tracking-wide text-[var(--foreground)]/70 uppercase">
                Node Configuration
              </div>

              {/* Name */}
              <div className="mb-3">
                <label className="mb-1.5 block text-[11px] font-medium text-[var(--foreground)]/70">
                  Node Name
                </label>
                <input
                  type="text"
                  value={nodeName}
                  onChange={(e) => setNodeName(e.target.value)}
                  placeholder="e.g. Main Quad, Bob's House"
                  className="h-10 w-full rounded-lg bg-white px-3 text-sm text-[var(--foreground)] shadow-sm ring-1 ring-[var(--foreground)]/[0.06] placeholder:text-[var(--muted)]/50 outline-none focus:ring-[var(--accent)]"
                />
              </div>

              {/* Location */}
              <div className="mb-3">
                <label className="mb-1.5 block text-[11px] font-medium text-[var(--foreground)]/70">
                  Location
                </label>
                <div className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-[var(--foreground)]/[0.06]">
                  {selectedLat !== null && selectedLng !== null ? (
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📍</span>
                      <div className="flex-1">
                        <div className="text-xs font-medium text-[var(--foreground)]">
                          Position set
                        </div>
                        <div className="text-[11px] tabular-nums text-[var(--muted)]">
                          {selectedLat.toFixed(6)}, {selectedLng.toFixed(6)}
                        </div>
                      </div>
                      <button
                        onClick={() => { setSelectedLat(null); setSelectedLng(null); }}
                        className="text-[10px] text-[var(--muted)] hover:text-red-500"
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[var(--muted)]">
                      <span className="text-lg opacity-50">📍</span>
                      <div className="text-xs">← Click on the map to set location</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Anchor toggle */}
              <div className="mb-4">
                <label className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm ring-1 ring-[var(--foreground)]/[0.06] cursor-pointer hover:ring-[var(--accent)]">
                  <input
                    type="checkbox"
                    checked={isAnchor}
                    onChange={(e) => setIsAnchor(e.target.checked)}
                    className="h-5 w-5 rounded border-[var(--muted)] text-amber-500 focus:ring-amber-500"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[var(--foreground)]">
                      GPS Anchor Node
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      This node has a fixed, known GPS position
                    </div>
                  </div>
                  <span className="text-lg">{isAnchor ? "📍" : "📡"}</span>
                </label>
              </div>

              {/* Save button */}
              <button
                onClick={handleSaveConfig}
                disabled={!nodeName.trim() || selectedLat === null}
                className="h-11 w-full rounded-lg bg-[var(--accent)] text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Save Configuration to Node
              </button>
            </div>

            {/* Info about anchor vs non-anchor */}
            <div className="rounded-xl bg-blue-500/5 p-3">
              <div className="flex items-start gap-2">
                <span className="text-sm">💡</span>
                <div className="text-[10px] leading-relaxed text-blue-900/70">
                  {isAnchor ? (
                    <>
                      <strong>Anchor nodes</strong> use their GPS module to report
                      exact position. Place at least 3 anchors to enable FTM
                      trilateration for other nodes.
                    </>
                  ) : (
                    <>
                      <strong>Regular nodes</strong> will estimate their position
                      using FTM (Fine Timing Measurement) ranging to nearby anchors.
                      ~1-2m accuracy with 3+ anchors in range.
                    </>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Help section when disconnected */}
        {connectionState === "disconnected" && discoveredDevices.length === 0 && (
          <div className="mt-4 rounded-xl bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <span className="text-lg">🔧</span>
              <div className="text-xs leading-relaxed text-amber-900/70">
                <strong>Setting up a new node?</strong>
                <ol className="mt-2 list-decimal list-inside space-y-1">
                  <li>Power on your LifeLink ESP32 device</li>
                  <li>Wait for the blue LED to blink (BLE advertising)</li>
                  <li>Click &quot;Scan for Nodes&quot; above</li>
                  <li>Select your device and configure it</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
