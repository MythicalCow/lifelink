# LifeLink UI Route Structure

## Architecture

The LifeLink UI is organized into three main modes, each with its own route:

### `/` - Home (Landing Page)
- **Purpose**: Mode selection screen
- **Path**: `src/app/page.tsx`
- **Content**: Links to Hardware and Simulation modes
- **Dependencies**: Minimal, no simulation or hardware specific code

### `/simulation` - Mesh Simulator
- **Purpose**: Test mesh protocols, malicious nodes, attack scenarios, and network resilience
- **Path**: `src/app/simulation/page.tsx`
- **Components**: 
  - `SensorField` (Leaflet map)
  - `SimControls` (play/pause/step)
  - `NodeManager` (add/delete nodes)
  - `TrustGraphConfig` (trust relationships)
  - `Messenger` (message routing)
- **Hooks**: `useSimulation` (contains all `MeshSimulator` logic)
- **Simulation Code**: `src/simulation/` directory
  - `simulator.ts` - Main orchestrator
  - `mesh-node.ts` - Base node behavior
  - `malicious-node.ts` - Attack scenarios
  - `environment.ts` - RF physics & channel simulation
  - `types.ts` - Protocol data structures

### `/hardware` - Real Hardware Mode
- **Purpose**: Connect to and interact with real ESP32 nodes
- **Path**: `src/app/hardware/page.tsx`
- **Status**: Placeholder for future hardware integration
- **Future Dev**: Will include:
  - WebSocket/BLE connection to real ESP32 devices
  - Live sensor data visualization
  - Real mesh network diagnostics
  - Hardware-specific configuration UI

## Merge Strategy

### No Conflicts Expected
1. **Separate Routes**: Hardware and simulation are isolated at the route level
2. **Shared Components**: Only shared UI components (header, etc.) are in `/components`
3. **Unique Logic**: Each mode has its own hooks and business logic
4. **Clear Separation**: No simulation code appears in hardware path and vice versa

### When Merging Hardware Implementation
1. Build hardware mode in `/app/hardware/` directory
2. Create hardware-specific hooks in `/hooks/use-hardware-*`
3. Share data models via `/types/` directory
4. Update home page with new hardware features (non-destructive)
5. Simulation code remains completely unchanged

## Component Usage

### Safe to Use in Both Modes
- `Header` - Mode selector
- `Messenger` - Message display (adapts to data source)
- Location picker, leaflet-map - Visualization only

### Simulation-Only
- `SensorField` - Requires `simState`
- `SimControls` - Requires simulator methods
- `NodeManager` - Requires simulation node management
- `TrustGraphConfig` - Requires trust graph operations

## Development Workflow

**Simulation Only**:
```bash
npm run dev
# Visit http://localhost:3000/simulation
```

**Future Hardware Development**:
```bash
# Build in /app/hardware/ independently
# Simulation continues to work without modification
```

**Testing Both**:
```bash
# Home page (/) remains clean selector
# Both modes work independently
# No competition for routes or components
```

## File Structure Summary

```
src/app/
├── page.tsx              # Home (mode selector) - CLEAN
├── simulation/
│   └── page.tsx          # Simulator UI (full original functionality)
├── hardware/
│   └── page.tsx          # Hardware placeholder (ready for expansion)
├── components/           # Shared UI components
├── hooks/
│   ├── use-simulation.ts # Simulation only
│   └── use-hardware-*.ts # Future hardware hooks
├── simulation/           # Simulation protocol code (untouched)
└── types/               # Shared data models
```

This structure allows:
- ✅ Clean separation of concerns
- ✅ Zero merge conflicts between modes
- ✅ Independent testing and development  
- ✅ Shared UI component library
- ✅ Future hardware integration without touching simulation code
