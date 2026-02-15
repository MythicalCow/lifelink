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
        radioType: "LoRa",
      });
    }
  }

  /**
   * Lying: Broadcast false position and misleading information.
   */
  private executeLying(currentTick: number): void {
    // Randomly decide to lie this tick
    if (this.rng() < this.intensity * 0.1) {
      // Send heartbeat with false position as a DATA message
      const fakeLat = this.estLat + (this.rng() - 0.5) * 0.01;
      const fakeLng = this.estLng + (this.rng() - 0.5) * 0.01;

      const gossipEntries = [
        {
          nodeId: this.id,
          sequenceNum: currentTick,
          hopsAway: 0,
          lat: fakeLat,
          lng: fakeLng,
          posConfidence: 1.0, // Claim high confidence
          label: this.label,
        },
      ];

      const gossipPayload = JSON.stringify(gossipEntries);
      const packetId = `${this.id}-lie-${currentTick}`;

      this.txQueue.push({
        id: packetId,
        type: PacketType.DATA,
        sourceId: this.id,
        destId: BROADCAST,
        nextHop: BROADCAST,
        ttl: 1,
        hopCount: 0,
        payload: `[GOSSIP]${gossipPayload}`,
        originLat: fakeLat,
        originLng: fakeLng,
        gossipEntries: [],
        radioType: "LoRa",
      });

      // Track as pending (though attacks don't expect ACKs)
      this.pendingMessages.set(packetId, {
        destId: BROADCAST,
        recipientId: BROADCAST,
        sentTick: currentTick,
        frequency: 1,
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

    // Broadcast gossip messages for each fake identity
    for (const sybilId of this.sybilIdentities) {
      if (this.rng() < 0.1) {
        // 10% chance per tick per identity
        const fakePos = {
          lat: this.estLat + (this.rng() - 0.5) * 0.005,
          lng: this.estLng + (this.rng() - 0.5) * 0.005,
        };

        const gossipEntries = [
          {
            nodeId: sybilId,
            sequenceNum: currentTick,
            hopsAway: 0,
            lat: fakePos.lat,
            lng: fakePos.lng,
            posConfidence: 1.0,
            label: `[SYBIL]${sybilId}`,
          },
        ];

        const gossipPayload = JSON.stringify(gossipEntries);
        const packetId = `${sybilId}-sybil-${currentTick}`;

        this.txQueue.push({
          id: packetId,
          type: PacketType.DATA,
          sourceId: sybilId,
          destId: BROADCAST,
          nextHop: BROADCAST,
          ttl: 1,
          hopCount: 0,
          payload: `[GOSSIP]${gossipPayload}`,
          originLat: fakePos.lat,
          originLng: fakePos.lng,
          gossipEntries: [],
          radioType: "LoRa",
        });

        // Track as pending
        this.pendingMessages.set(packetId, {
          destId: BROADCAST,
          recipientId: BROADCAST,
          sentTick: currentTick,
          frequency: 1,
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
