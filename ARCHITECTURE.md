# LifeLink Architecture Refactoring

## Overview

The LifeLink simulator has been refactored into a clean, modular architecture that separates concerns between node behavior, environment simulation, and UI components. This enables rapid iteration on mesh network algorithms and security mechanisms.

## New Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    UI Components                         │
│  NodeManager | TrustGraphConfig                          │
│  (Add/Delete)  (Configure Trust)                         │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │   MeshSimulator (Orchestrator) │
        │   - Coordinates ticks          │
        │   - Manages nodes + environment│
        │   - Exposes visualization data  │
        └─────┬────────────────────┬─────┘
              │                    │
    ┌─────────▼──────────┐  ┌─────▼──────────────┐
    │   Node (Base)      │  │   Environment      │
    │   - loop()         │  │   - RF channel sim │
    │   - userSend()     │  │   - Interference   │
    │   - BLE/LoRa iface │  │   - Spectrum       │
    │   - Trust storage  │  │   - Jamming        │
    └─────────┬──────────┘  └────────────────────┘
              │
    ┌─────────▼──────────┐
    │  MaliciousNode     │
    │  - extends Node    │
    │  - Attack behaviors│
    └────────────────────┘
```

## Key Components

### 1. **Environment** (`simulation/environment.ts`)

Handles all RF physics and channel simulation:
- **8 LoRa channels** (915 MHz ISM band)
- **Signal propagation** with RSSI calculation
- **Interference tracking** per channel
- **Jamming simulation** with location-based power
- **Collision detection** with capture effect
- **Spectrum analysis** for visualization

**API:**
```typescript
environment.transmit(packet, nodeId, lat, lng, channel, txPower)
environment.receive(nodeId, lat, lng, channel) // Returns received packets
environment.addJammer(lat, lng, radius, power, channels)
environment.getSpectrum() // For UI visualization
```

### 2. **Node** (`simulation/mesh-node.ts`)

Clean abstraction for node behavior:

**Core Methods:**
- `loop(tick)` - Runs every tick, handles background operations (beacons, routing, trust updates)
- `userSend(destId, message, radio)` - User-initiated message send (simulates app interaction)
- `performFtmRanging()` - Wi-Fi FTM ranging for localization
- `receive(packet, rssi, tick)` - Process incoming packets

**Radio Management:**
- `setLoRaChannel(channel)` - Switch frequency (0-7)
- `setBleEnabled(enabled)` - Toggle BLE for phone connections

**Trust & Crypto:**
- `trustPeer(nodeId, publicKey)` - Establish trust relationship
- `untrustPeer(nodeId)` - Remove trust
- `verifyMessage(fromNodeId, signedMessage)` - Verify message signature
- `getReputation(nodeId)` - Get peer reputation score (0-1)
- `updateReputation(nodeId, delta)` - Adjust reputation

**Storage:**
- Public/private keys
- Trusted peer keys
- Reputation scores
- Message history

### 3. **MaliciousNode** (`simulation/malicious-node.ts`)

Extends `MeshNode` with attack capabilities:

**Attack Strategies:**
- `jammer` - Flood channel with spurious packets
- `liar` - Broadcast false positions and misinformation
- `sybil` - Create fake node identities
- `blackhole` - Accept but don't forward packets
- `selective` - Drop packets from specific targets

**API:**
```typescript
maliciousNode.setStrategy("jammer")
maliciousNode.setIntensity(0.7) // 0-1
maliciousNode.addTarget(nodeId) // For selective attacks
```

### 4. **MeshSimulator** (`simulation/simulator.ts`)

Orchestrates the simulation:

**Core:**
- Instantiates `Environment`
- Calls `node.loop()` each tick
- Coordinates FTM ranging
- Collects visualization state

**New API:**
```typescript
simulator.establishTrust(nodeId1, nodeId2)
simulator.configureTrustGraph(nodeIds, density)
simulator.addJammer(lat, lng, radius, power, channels)
simulator.getEnvironment() // Access Environment for UI
simulator.getNode(nodeId) // Direct node access
```

## UI Components

### **NodeManager** (`components/node-manager.tsx`)

- Add/delete nodes
- Mark nodes as malicious
- Configure node properties (anchor, position)
- Configure attack strategy and intensity for malicious nodes

### **TrustGraphConfig** (`components/trust-graph-config.tsx`)

- Select nodes to include in trust network
- Set graph density (% of connections to create)
- Automatically exchanges public keys between selected nodes
- Excludes malicious nodes from trust relationships

## Usage Examples

### Adding a Normal Node

```typescript
const newNode = {
  id: 1,
  lat: 37.4275,
  lng: -122.1697,
  label: "Node Alpha",
  radius: 170,
  isAnchor: false,
};
onAddNode(newNode);
```

### Adding a Malicious Node

```typescript
const maliciousNode = {
  id: 2,
  lat: 37.4280,
  lng: -122.1700,
  label: "[MAL] Jammer Node", // Prefix triggers MaliciousNode creation
  radius: 170,
  isAnchor: false,
};
onAddNode(maliciousNode);
```

### Configuring Trust Graph

```typescript
// Select nodes 1, 2, 3, 4 with 50% density
// Creates ~3 bidirectional trust relationships
const nodeIds = [1, 2, 3, 4];
const density = 0.5;
simulator.configureTrustGraph(nodeIds, density);
```

### Sending a User Message

```typescript
const node = simulator.getNode(nodeId);
node.userSend(destNodeId, "Emergency: need water", "LoRa");
```

### Adding a Jammer

```typescript
simulator.addJammer(
  37.4275, // lat
  -122.1697, // lng
  200, // radius (meters)
  30, // power (dBm)
  [0, 1, 2] // jam channels 0, 1, 2
);
```

## Tabs Overview

1. **Map** - Visualize mesh topology and node positions
2. **Messages** - Send/receive messages via BLE gateway
3. **Nodes** - Add, delete, configure nodes (including malicious)
4. **Trust** - Configure trust relationships and public key exchange
5. **Debug** - View RF spectrum, transmissions, and statistics
6. **Setup** - Legacy BLE node configuration

## Testing Attack Scenarios

### Scenario 1: Jamming Attack

1. Go to **Nodes** tab
2. Add a malicious node with strategy `jammer`, intensity `0.8`
3. Place it near legitimate nodes
4. Go to **Debug** tab to see channel interference
5. Try sending messages from **Messages** tab
6. Observe increased collisions and failed deliveries

### Scenario 2: Sybil Attack

1. Add malicious node with strategy `sybil`
2. Watch in **Map** view as fake identities appear
3. Check **Debug** for increased heartbeat traffic
4. Observe trust system response (if implemented)

### Scenario 3: Trust Network Test

1. Add 5-6 normal nodes in **Nodes** tab
2. Go to **Trust** tab
3. Select all nodes, set density to `0.5`
4. Click "Configure Trust Graph"
5. Send signed messages between trusted nodes
6. Verify reputation scores increase for good behavior

## Backward Compatibility

All changes maintain backward compatibility with existing code:
- Existing `tick()` method still works (called by `loop()`)
- UI components render the same way
- Simulation parameters unchanged
- Map and message views unaffected

## Development Workflow

1. **Add nodes** via Nodes tab
2. **Configure trust** via Trust tab  
3. **Test algorithms** by sending messages
4. **Monitor RF environment** in Debug tab
5. **Iterate quickly** on attack/defense strategies

## Next Steps

- Implement actual Ed25519 crypto (currently simplified)
- Add message verification UI indicators
- Visualize trust graph on map
- Add attack success metrics
- Implement adaptive frequency hopping
- Add k-of-n confirmation for urgent messages
