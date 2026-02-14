/* ── MaliciousNode ────────────────────────────────────
 * Extends MeshNode with attack capabilities:
 * - Jamming (flooding the channel)
 * - False messages
 * - Fake location broadcasts
 * - Reputation attacks
 * ───────────────────────────────────────────────────── */

import { MeshNode } from "./mesh-node";
import { PacketType, BROADCAST } from "./types";

export type AttackStrategy =
  | "none"
  | "jammer" // Flood channel with noise
  | "liar" // Send false location/messages
  | "sybil" // Impersonate multiple nodes
  | "blackhole" // Accept but don't forward messages
  | "selective"; // Selectively drop strategicmessages

/**
 * MaliciousNode is a variant that can perform various attacks
 * to test the network's resilience.
 */
export class MaliciousNode extends MeshNode {
  /** Current attack strategy */
  strategy: AttackStrategy = "none";

  /** Attack intensity (0-1) */
  intensity = 0.5;

  /** Whether this is a malicious node (for UI visualization) */
  isMalicious = true;

  /** Fake identities for Sybil attacks */
  private sybilIdentities: number[] = [];

  /** Packet drop probability for blackhole/selective attacks */
  private dropProbability = 0.8;

  /** Track packets seen for selective dropping */
  private targetNodeIds: Set<number> = new Set();

  constructor(
    id: number,
    trueLat: number,
    trueLng: number,
    label: string,
    isAnchor: boolean,
    strategy: AttackStrategy = "jammer",
  ) {
    super(id, trueLat, trueLng, label, isAnchor);
    this.strategy = strategy;
    this.label = `[MAL] ${label}`;
  }

  /* ── Overridden loop() ─────────────────────────────────
   * Inject malicious behavior each tick.
   * ───────────────────────────────────────────────────── */

  loop(currentTick: number): void {
    // Call parent loop first (normal protocol operations)
    super.loop(currentTick);

    // Then inject malicious behavior
    switch (this.strategy) {
      case "jammer":
        this.executeJamming(currentTick);
        break;
      case "liar":
        this.executeLying(currentTick);
        break;
      case "sybil":
        this.executeSybil(currentTick);
        break;
      case "blackhole":
        this.executeBlackhole();
        break;
      case "selective":
        this.executeSelective();
        break;
    }
  }

  /* ── Attack Implementations ───────────────────────────── */

  /**
   * Jamming: Flood the channel with spurious packets.
   */
  private executeJamming(currentTick: number): void {
    // Generate packets based on intensity
    const packetsToSend = Math.floor(this.intensity * 10);

    for (let i = 0; i < packetsToSend; i++) {
      // Send random garbage packets
      this.txQueue.push({
        id: `${this.id}-jam-${currentTick}-${i}`,
        type: PacketType.DATA,
        sourceId: this.id,
        destId: BROADCAST,
        nextHop: BROADCAST,
        ttl: 1,
        hopCount: 0,
        payload: "JAMMING",
        originLat: this.estLat,
        originLng: this.estLng,
        gossipEntries: [],
      });
    }
  }

  /**
   * Lying: Broadcast false position and misleading information.
   */
  private executeLying(currentTick: number): void {
    // Randomly decide to lie this tick
    if (this.rng() < this.intensity * 0.1) {
      // Send heartbeat with false position
      const fakeLat = this.estLat + (this.rng() - 0.5) * 0.01;
      const fakeLng = this.estLng + (this.rng() - 0.5) * 0.01;

      this.txQueue.push({
        id: `${this.id}-lie-${currentTick}`,
        type: PacketType.HEARTBEAT,
        sourceId: this.id,
        destId: BROADCAST,
        nextHop: BROADCAST,
        ttl: 1,
        hopCount: 0,
        payload: "",
        originLat: fakeLat,
        originLng: fakeLng,
        gossipEntries: [
          {
            nodeId: this.id,
            sequenceNum: currentTick,
            hopsAway: 0,
            lat: fakeLat,
            lng: fakeLng,
            posConfidence: 1.0, // Claim high confidence
            label: this.label,
          },
        ],
      });
    }
  }

  /**
   * Sybil attack: Create fake node identities.
   */
  private executeSybil(currentTick: number): void {
    // Create sybil identities if not yet done
    if (this.sybilIdentities.length === 0) {
      const count = Math.floor(this.intensity * 5) + 1;
      for (let i = 0; i < count; i++) {
        this.sybilIdentities.push(10000 + this.id * 100 + i);
      }
    }

    // Broadcast heartbeats for each fake identity
    for (const sybilId of this.sybilIdentities) {
      if (this.rng() < 0.1) {
        // 10% chance per tick per identity
        this.txQueue.push({
          id: `${sybilId}-sybil-${currentTick}`,
          type: PacketType.HEARTBEAT,
          sourceId: sybilId,
          destId: BROADCAST,
          nextHop: BROADCAST,
          ttl: 1,
          hopCount: 0,
          payload: "",
          originLat: this.estLat + (this.rng() - 0.5) * 0.005,
          originLng: this.estLng + (this.rng() - 0.5) * 0.005,
          gossipEntries: [
            {
              nodeId: sybilId,
              sequenceNum: currentTick,
              hopsAway: 0,
              lat: this.estLat,
              lng: this.estLng,
              posConfidence: 0.8,
              label: `Sybil-${sybilId}`,
            },
          ],
        });
      }
    }
  }

  /**
   * Blackhole: Accept but don't forward packets.
   */
  private executeBlackhole(): void {
    // Override by clearing TX queue of forwarded packets
    // Keep only locally-originated packets
    this.txQueue = this.txQueue.filter((pkt) => {
      return pkt.sourceId === this.id || pkt.hopCount === 0;
    });
  }

  /**
   * Selective forwarding: Drop packets from specific targets.
   */
  private executeSelective(): void {
    // Drop packets from targeted nodes
    this.txQueue = this.txQueue.filter((pkt) => {
      if (this.targetNodeIds.has(pkt.sourceId)) {
        return this.rng() > this.dropProbability;
      }
      return true;
    });
  }

  /* ── Configuration ─────────────────────────────────────── */

  /**
   * Change attack strategy at runtime.
   */
  setStrategy(strategy: AttackStrategy): void {
    this.strategy = strategy;
    this.notify(`Attack strategy changed to: ${strategy}`, "warn");
  }

  /**
   * Adjust attack intensity (0-1).
   */
  setIntensity(intensity: number): void {
    this.intensity = Math.max(0, Math.min(1, intensity));
    this.notify(`Attack intensity set to: ${(this.intensity * 100).toFixed(0)}%`, "warn");
  }

  /**
   * Add a node ID to target for selective attacks.
   */
  addTarget(nodeId: number): void {
    this.targetNodeIds.add(nodeId);
    this.notify(`Targeting node ${nodeId}`, "error");
  }

  /**
   * Remove a node from targeting.
   */
  removeTarget(nodeId: number): void {
    this.targetNodeIds.delete(nodeId);
  }

  /**
   * Get current attack status for UI display.
   */
  getAttackStatus(): {
    strategy: AttackStrategy;
    intensity: number;
    targets: number[];
    sybilCount: number;
  } {
    return {
      strategy: this.strategy,
      intensity: this.intensity,
      targets: Array.from(this.targetNodeIds),
      sybilCount: this.sybilIdentities.length,
    };
  }
}
