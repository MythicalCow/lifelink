# Trust Graph Reset Issue - Root Cause Analysis & Fix

## Problem Statement
When adding a new node to the simulation after configuring trust connections, the trust relationships between existing nodes were being reset/cleared. This created a poor user experience because setting up a trust network and then adding a node would lose all the configured connections.

## Root Cause Analysis

### The Core Issue
The problem occurred due to a mismatch between the simulator state management and the trust graph persistence:

1. **Trust Configuration Not Persisted**: When `handleApplyTrustGraph()` applied trust connections to the simulator, the `trustMapRef.current` was never updated with these connections. This ref is the only persistent storage for trust relationships across simulator resets.

2. **Automatic Reset on Node Addition**: When a new node was added via `handleAddNode()`, it updated the `nodes` state. The `useSimulation` hook has an effect that watches `sensorNodes` (which is `nodes`) and automatically calls `simulator.reset()` when it changes. This is correct for major layout changes, but loses the trust graph configuration.

3. **Broken Restoration Logic**: The effect that attempted to restore the trust graph (lines 254-286) had two issues:
   - It relied on `trustMapRef.current` being populated, which never happened
   - It used a fragile condition checking if non-malicious node count increased, which wasn't reliable

### Data Flow Diagram

**Before Fix:**
```
User applies trust graph
    ↓
handleApplyTrustGraph()
    ↓
simulator.setTrustGraphFromMap(trustMap)
    × trustMapRef.current NOT updated ← BUG!
    ↓
User adds node
    ↓
handleAddNode() → setNodes(...)
    ↓
useSimulation effect triggers reset()
    ↓
simulator.reset() ← clears all trust
    ↓
Restore effect tries to use trustMapRef.current
    × trustMapRef.current is empty ← FAILS
    ↓
Trust connections are LOST ❌
```

**After Fix:**
```
User applies trust graph
    ↓
handleApplyTrustGraph()
    ↓
simulator.setTrustGraphFromMap(trustMap)
    ✓ trustMapRef.current = trustMap ← SAVED
    ↓
User adds node
    ↓
handleAddNode() → setNodes(...)
    ↓
useSimulation effect triggers reset()
    ↓
simulator.reset() ← clears nodes but trustMapRef persists
    ↓
Restore effect detects no active trust
    ✓ Restores from trustMapRef.current
    ↓
Trust connections are PRESERVED ✅
```

## Solution Overview

### Fix 1: Save Trust Map in `handleApplyTrustGraph`

**Location**: [src/app/simulation/page.tsx](src/app/simulation/page.tsx#L217-L226)

**Change**: Added one line to save the applied trust map:
```typescript
trustMapRef.current = trustMap; // ← NEW: Save for restoration after reset
simulator.setTrustGraphFromMap(trustMap);
```

**Rationale**: The trust map must be saved before applying it so that if the simulator resets (due to node changes), the restore effect can recover it.

### Fix 2: Save Trust Map After Quick Setup

**Location**: [src/app/simulation/page.tsx](src/app/simulation/page.tsx#L256-L268)

**Change**: After `configureTrustGraph()` generates random trust relationships, extract and save them:
```typescript
// Save the newly configured trust graph so it persists across resets
if (sim.state) {
  const newTrustMap: Record<number, number[]> = {};
  for (const nodeState of sim.state.nodeStates) {
    newTrustMap[nodeState.id] = nodeState.trustedPeers ?? [];
  }
  trustMapRef.current = newTrustMap;
}
```

**Rationale**: Quick setup also configures a trust graph that needs to persist. By extracting the generated trust relationships from simulator state, we ensure they're saved for restoration.

### Fix 3: Improved Trust Restoration Logic

**Location**: [src/app/simulation/page.tsx](src/app/simulation/page.tsx#L270-L300)

**Changes**:
- Replace fragile node count checking with **active trust detection**
- Check if simulator has no trust (`!hasActiveTrust`) but we have saved trust (`savedTrustExists`)
- Keep `trustMapRef.current` instead of clearing it after restoration

**Old Logic** (fragile):
```typescript
const oldNodeCount = Object.keys(trustMapRef.current).length;
const newNodeCount = nodes.filter((n) => !n.label?.startsWith("[MAL]")).length;
if (newNodeCount > oldNodeCount) { // ← Only works if nodes increased
  // restore...
  trustMapRef.current = {}; // ← Cleared after use
}
```

**New Logic** (robust):
```typescript
const hasActiveTrust = sim.state.nodeStates.some((n) => n.trustedPeers.length > 0);
const savedTrustExists = Object.values(trustMapRef.current).some((peers) => peers.length > 0);

if (!hasActiveTrust && savedTrustExists && nodes.length === sim.state.nodeStates.length) {
  // restore...
  // ← Keep trustMapRef.current for future resets
}
```

**Why This is Better**:
- Detects the actual problem (missing trust) rather than indirect signs (node count changes)
- Works for any combination of node additions/removals
- Persists the trust map for multiple sequential resets
- Handles quick reset scenarios more gracefully

## Density Preservation

The fixes also preserve trust graph **density** (connection percentage):

When `configureTrustGraph(nodeIds, density)` is called during quick setup:
1. It creates exactly `targetConnections = Math.round(allPairs.length * density)` connections
2. These connections are now saved to `trustMapRef.current`
3. When a new node is added, the old nodes retain their exact trust relationships
4. The density metric for the original nodes remains unchanged

**Example**:
- Quick setup: 10 nodes, density 0.3 → creates 13 connections among 10 nodes
- User adds 1 node: Still have 13 connections among the original 10
- Density for original nodes: 13 / (10*9/2) = 13/45 ≈ 28.9% (preserved!)

## Testing Strategy

### Test Case 1: Manual Trust Application
1. Create 5 nodes manually
2. Apply trust connections (e.g., create a triangle: 1↔2↔3↔1)
3. Add a 6th node
4. **Expected**: Nodes 1-3 still have their trust relationships, node 6 has no trust initially
5. **Verify**: Check node states in developer tools or UI

### Test Case 2: Quick Setup with Trust
1. Use Quick Setup with 10 nodes and 0.3 density
2. Wait for trust graph to configure
3. Add 1-2 more nodes
4. **Expected**: Original 10 nodes maintain their trust connections
5. **Verify**: Density of original nodes should be ~0.3

### Test Case 3: Multiple Additions
1. Set up 5 nodes with manual trust (3 connections)
2. Add node 6 (verify trust preserved)
3. Add node 7 (verify trust still preserved)
4. Add node 8 (verify trust still preserved)
5. **Expected**: Original 5 nodes maintain all connections throughout

### Test Case 4: Trust Modification
1. Set up nodes with trust
2. Add a node
3. Modify trust (add/remove connections)
4. Add another node
5. **Expected**: New modifications are preserved and not overwritten

## Edge Cases Handled

1. **Empty Trust Map**: If no trust is configured, nothing is restored ✓
2. **Node Deletion**: Trust map is filtered to only include existing nodes ✓
3. **Malicious Nodes**: Not included in trust relationships (separate system) ✓
4. **Quick Reset**: If user clicks "Clear All", `trustMapRef.current` is cleared ✓
5. **Multiple Resets**: Trust map persists across sequential resets ✓

## Files Modified

1. **[src/app/simulation/page.tsx](src/app/simulation/page.tsx)**
   - `handleApplyTrustGraph()`: Added trust map saving
   - Quick setup effect: Added trust map extraction and saving
   - Restore trust effect: Improved detection and persistence logic

## Impact Assessment

### What Changed
- Trust graphs now persist when adding nodes
- Density values are maintained for existing nodes
- More robust trust restoration logic

### What Didn't Change
- Simulator architecture
- Node addition mechanism
- Trust graph configuration algorithms
- UI/UX (same functionality, just works better)
- Trust routing behavior

### Backward Compatibility
- Fully compatible with existing setups
- No breaking changes to APIs or types
- Existing saved simulations will work correctly

## Related Code Components

- **Simulator**: [src/simulation/simulator.ts](src/simulation/simulator.ts)
  - `reset()`: Recreates nodes structure
  - `setTrustGraphFromMap()`: Applies trust relationships
  - `configureTrustGraph()`: Generates random trust via density

- **Hook**: [src/hooks/use-simulation.ts](src/hooks/use-simulation.ts)
  - Effect watching `sensorNodes` that triggers reset

- **Components**: 
  - [src/components/node-manager.tsx](src/components/node-manager.tsx): UI for configuring nodes and trust
  - [src/app/simulation/page.tsx](src/app/simulation/page.tsx): Main orchestration logic
