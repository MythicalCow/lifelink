/* ── MeshNode ─────────────────────────────────────────
 * Per-node protocol logic: Epidemic Gossip membership
 * + Geographic Greedy routing + RSSI Trilateration.
 * Pure state machine — no hardcoded positions.
 * ───────────────────────────────────────────────────── */

import {
  BROADCAST,
  PacketType,
  type MeshPacket,
  type NeighborEntry,
  type GossipEntry,
} from "./types";
import {
  BEACON_INTERVAL,
  BEACON_JITTER,
  MAX_GOSSIP_ENTRIES,
  MAX_TTL,
  NEIGHBOR_EXPIRY,
  DEDUP_BUFFER_SIZE,
} from "./config";
import {
  haversine,
  xorshift32,
  ftmMeasureDistance,
  trilaterate,
  type AnchorReading,
} from "./utils";

export class MeshNode {
  id: number;
  label: string;

  /**
   * TRUE position — only used by the simulator for physics (RSSI calc).
   * The node itself does NOT know this; it's "god mode" for the sim.
   */
  trueLat: number;
  trueLng: number;

  /**
   * ESTIMATED position — what the node believes based on trilateration.
   * Starts at (0,0) until enough anchor readings arrive.
   */
  estLat = 0;
  estLng = 0;

  /**
   * Position confidence: 0 = unknown, 1 = anchor (has GPS).
   * Intermediate values = trilaterated with varying certainty.
   */
  posConfidence = 0;

  /** Is this node an anchor (has GPS/known position)? */
  isAnchor: boolean;

  neighborTable: Map<number, NeighborEntry> = new Map();

  /**
   * FTM ranging results from direct neighbors.
   * In real hardware: ESP32-S3 performs 802.11mc FTM ranging.
   * Here we simulate with true distance + noise.
   */
  private ftmReadings: Map<
    number,
    { distance: number; trueLat: number; trueLng: number; tick: number }
  > = new Map();

  private seqNum = 0;
  private packetCounter = 0;
  private nextBeaconTick: number;
  private dedup: string[] = [];
  private rng: () => number;

  /** Current radio state (reset each tick by simulator) */
  state: "idle" | "tx" | "rx" = "idle";

  /** Outbound queue — simulator pulls from this */
  txQueue: MeshPacket[] = [];

  constructor(
    id: number,
    trueLat: number,
    trueLng: number,
    label: string,
    isAnchor: boolean,
  ) {
    this.id = id;
    this.trueLat = trueLat;
    this.trueLng = trueLng;
    this.label = label;
    this.isAnchor = isAnchor;

    // Anchors know their true position; others start unknown
    if (isAnchor) {
      this.estLat = trueLat;
      this.estLng = trueLng;
      this.posConfidence = 1;
    }

    this.rng = xorshift32(id * 7919 + 1);
    this.nextBeaconTick =
      Math.floor(this.rng() * BEACON_INTERVAL) + BEACON_JITTER;
  }

  /* ── Tick ──────────────────────────────────────────── */

  /** Called once per simulation tick. May enqueue a heartbeat. */
  tick(currentTick: number): void {
    // Expire old neighbors and FTM readings
    for (const [nid, entry] of this.neighborTable) {
      if (currentTick - entry.lastSeenTick > NEIGHBOR_EXPIRY) {
        this.neighborTable.delete(nid);
        this.ftmReadings.delete(nid);
      }
    }

    // Attempt trilateration if not an anchor and we have readings
    if (!this.isAnchor) {
      this.attemptTrilateration();
    }

    // Beacon timer
    if (currentTick >= this.nextBeaconTick) {
      this.txQueue.push(this.createHeartbeat());
      this.nextBeaconTick =
        currentTick +
        BEACON_INTERVAL +
        Math.floor(this.rng() * BEACON_JITTER);
    }
  }

  /**
   * Perform FTM ranging to a neighbor.
   * Called by the simulator when this node can "see" another node.
   * In real hardware: ESP32-S3 initiates 802.11mc FTM request.
   *
   * @param neighborId - ID of the neighbor node
   * @param trueDistance - Actual distance in meters (simulator knows this)
   * @param neighborTrueLat - Neighbor's true lat (for anchor reference)
   * @param neighborTrueLng - Neighbor's true lng (for anchor reference)
   * @param currentTick - Current simulation tick
   */
  performFtmRanging(
    neighborId: number,
    trueDistance: number,
    neighborTrueLat: number,
    neighborTrueLng: number,
    currentTick: number,
  ): void {
    // Simulate FTM measurement with realistic noise (~1-2m accuracy)
    const measuredDistance = ftmMeasureDistance(trueDistance, this.rng);

    this.ftmReadings.set(neighborId, {
      distance: measuredDistance,
      trueLat: neighborTrueLat,
      trueLng: neighborTrueLng,
      tick: currentTick,
    });
  }

  /* ── Trilateration (FTM-based) ────────────────────────
   * Uses 802.11mc Fine Timing Measurement distances.
   * Much more accurate than RSSI (~1-2m vs ~5-10m error).
   * ─────────────────────────────────────────────────── */

  private attemptTrilateration(): void {
    // Collect anchor readings from direct neighbors with known positions
    const anchors: AnchorReading[] = [];

    for (const [nid, entry] of this.neighborTable) {
      // Only use direct neighbors (hopsAway === 1) with confident positions
      if (entry.hopsAway !== 1) continue;
      if (entry.posConfidence < 0.5) continue;

      // Get FTM ranging result for this neighbor
      const ftm = this.ftmReadings.get(nid);
      if (!ftm) continue;

      // Use the neighbor's ANNOUNCED position (from gossip) for trilateration
      // This is what they claim their position is
      anchors.push({
        lat: entry.lat,
        lng: entry.lng,
        distance: ftm.distance,
      });
    }

    // Need at least 3 anchors for trilateration
    if (anchors.length < 3) return;

    const result = trilaterate(anchors);
    if (!result) return;

    // Update estimated position with some smoothing
    // FTM is accurate enough that we can use less smoothing
    const alpha = 0.5; // higher alpha = faster convergence (FTM is reliable)
    if (this.posConfidence > 0) {
      this.estLat = this.estLat * (1 - alpha) + result.lat * alpha;
      this.estLng = this.estLng * (1 - alpha) + result.lng * alpha;
    } else {
      this.estLat = result.lat;
      this.estLng = result.lng;
    }

    // Confidence based on number of anchors
    // FTM gives higher confidence than RSSI would
    this.posConfidence = Math.min(0.5 + anchors.length * 0.1, 0.95);
  }

  /* ── Receive ───────────────────────────────────────── */

  /**
   * Process an incoming packet. Returns a packet to forward/ack,
   * or null if nothing to send.
   */
  receive(
    packet: MeshPacket,
    rssi: number,
    currentTick: number,
  ): MeshPacket | null {
    // Dedup
    if (this.dedup.includes(packet.id)) return null;
    this.dedup.push(packet.id);
    if (this.dedup.length > DEDUP_BUFFER_SIZE) this.dedup.shift();

    // Ignore our own packets
    if (packet.sourceId === this.id) return null;
    // Honor explicit next-hop addressing for unicast flow.
    if (packet.nextHop !== BROADCAST && packet.nextHop !== this.id) return null;

    switch (packet.type) {
      case PacketType.HEARTBEAT:
        this.processHeartbeat(packet, rssi, currentTick);
        return null;

      case PacketType.DATA:
        return this.processData(packet);

      case PacketType.ACK:
        // ACKs are consumed silently (logged by simulator)
        return null;
    }
  }

  /* ── Heartbeat / Gossip ─────────────────────────────  */

  private createHeartbeat(): MeshPacket {
    this.seqNum++;
    const entries = this.getGossipEntries();
    return {
      id: `${this.id}-${this.packetCounter++}`,
      type: PacketType.HEARTBEAT,
      sourceId: this.id,
      destId: BROADCAST,
      nextHop: BROADCAST,
      ttl: 1,
      hopCount: 0,
      payload: "",
      // Use ESTIMATED position in packets (what we believe, not truth)
      originLat: this.estLat,
      originLng: this.estLng,
      gossipEntries: entries,
    };
  }

  private processHeartbeat(
    packet: MeshPacket,
    rssi: number,
    currentTick: number,
  ): void {
    // Note: FTM ranging is done separately by the simulator.
    // RSSI is still used for link quality estimation but not positioning.

    // Resolve sender's info from their self-entry in gossip
    const senderSelf = packet.gossipEntries.find(
      (e) => e.nodeId === packet.sourceId,
    );
    const senderLabel = senderSelf?.label ?? `Node ${packet.sourceId}`;
    const senderConfidence = senderSelf?.posConfidence ?? 0;

    // Direct neighbor entry — position from gossip (their estimate)
    this.neighborTable.set(packet.sourceId, {
      nodeId: packet.sourceId,
      sequenceNum: this.seqNum,
      hopsAway: 1,
      lastSeenTick: currentTick,
      rssi,
      lat: packet.originLat,
      lng: packet.originLng,
      posConfidence: senderConfidence,
      viaNode: packet.sourceId,
      label: senderLabel,
    });

    // Process piggybacked gossip
    for (const entry of packet.gossipEntries) {
      if (entry.nodeId === this.id) continue;
      const newHops = entry.hopsAway + 1;
      const existing = this.neighborTable.get(entry.nodeId);

      const shouldUpdate =
        !existing ||
        existing.sequenceNum < entry.sequenceNum ||
        (existing.sequenceNum === entry.sequenceNum &&
          existing.hopsAway > newHops);

      if (shouldUpdate) {
        this.neighborTable.set(entry.nodeId, {
          nodeId: entry.nodeId,
          sequenceNum: entry.sequenceNum,
          hopsAway: newHops,
          lastSeenTick: currentTick,
          rssi: rssi * 0.6, // degraded estimate
          lat: entry.lat,
          lng: entry.lng,
          posConfidence: entry.posConfidence * 0.9, // degrade confidence
          viaNode: packet.sourceId,
          label: entry.label,
        });
      }
    }
  }

  private getGossipEntries(): GossipEntry[] {
    const entries: GossipEntry[] = [];
    // Include self — announce our estimated position
    entries.push({
      nodeId: this.id,
      sequenceNum: this.seqNum,
      hopsAway: 0,
      lat: this.estLat,
      lng: this.estLng,
      posConfidence: this.posConfidence,
      label: this.label,
    });
    // Include most recently updated neighbors (up to limit)
    const sorted = [...this.neighborTable.values()]
      .sort((a, b) => b.lastSeenTick - a.lastSeenTick)
      .slice(0, MAX_GOSSIP_ENTRIES - 1);
    for (const n of sorted) {
      entries.push({
        nodeId: n.nodeId,
        sequenceNum: n.sequenceNum,
        hopsAway: n.hopsAway,
        lat: n.lat,
        lng: n.lng,
        posConfidence: n.posConfidence,
        label: n.label,
      });
    }
    return entries;
  }

  /* ── Data Routing ──────────────────────────────────── */

  private processData(packet: MeshPacket): MeshPacket | null {
    // Delivered!
    if (packet.destId === this.id) {
      return {
        ...packet,
        id: `${this.id}-ack-${this.packetCounter++}`,
        type: PacketType.ACK,
        sourceId: this.id,
        destId: packet.sourceId,
        nextHop: BROADCAST, // ACK is best-effort broadcast
        ttl: MAX_TTL,
        hopCount: 0,
        payload: `ACK:${packet.id}`,
        originLat: this.estLat,
        originLng: this.estLng,
        gossipEntries: [],
      };
    }

    // TTL exhausted
    if (packet.ttl <= 0) return null;

    // Find next hop
    const nextHop = this.getNextHop(packet.destId);
    if (nextHop === null) return null;

    // Forward
    return {
      ...packet,
      nextHop,
      ttl: packet.ttl - 1,
      hopCount: packet.hopCount + 1,
    };
  }

  /** Geographic + Gradient routing to pick next hop */
  getNextHop(destId: number): number | null {
    // 1. Direct neighbor?
    const direct = this.neighborTable.get(destId);
    if (direct && direct.hopsAway === 1) return destId;

    // 2. Geographic greedy forwarding (using estimated positions)
    const destEntry = this.neighborTable.get(destId);
    if (destEntry && destEntry.posConfidence > 0.3) {
      const myDist = haversine(
        this.estLat,
        this.estLng,
        destEntry.lat,
        destEntry.lng,
      );
      let bestId: number | null = null;
      let bestDist = myDist; // must improve on our distance

      for (const [nid, n] of this.neighborTable) {
        if (n.hopsAway !== 1) continue; // direct neighbors only
        if (n.posConfidence < 0.3) continue; // need confident position
        const d = haversine(n.lat, n.lng, destEntry.lat, destEntry.lng);
        if (d < bestDist) {
          bestDist = d;
          bestId = nid;
        }
      }
      if (bestId !== null) return bestId;

      // 3. Gradient fallback — learned-via neighbor
      if (destEntry.viaNode !== this.id) {
        const via = this.neighborTable.get(destEntry.viaNode);
        if (via && via.hopsAway === 1) return destEntry.viaNode;
      }

      // 4. Last resort — closest neighbor to dest even if no improvement
      bestDist = Infinity;
      for (const [nid, n] of this.neighborTable) {
        if (n.hopsAway !== 1) continue;
        const d = haversine(n.lat, n.lng, destEntry.lat, destEntry.lng);
        if (d < bestDist) {
          bestDist = d;
          bestId = nid;
        }
      }
      return bestId;
    }

    // 5. No position info — fall back to gradient (via node)
    if (destEntry && destEntry.viaNode !== this.id) {
      const via = this.neighborTable.get(destEntry.viaNode);
      if (via && via.hopsAway === 1) return destEntry.viaNode;
    }

    return null; // no knowledge of destination
  }

  /* ── Public helpers for UI ─────────────────────────── */

  get directNeighborCount(): number {
    return [...this.neighborTable.values()].filter((n) => n.hopsAway === 1)
      .length;
  }

  get knownNodeCount(): number {
    return this.neighborTable.size;
  }

  /** Enqueue a data packet to send */
  enqueueData(destId: number, payload: string): void {
    this.txQueue.push({
      id: `${this.id}-${this.packetCounter++}`,
      type: PacketType.DATA,
      sourceId: this.id,
      destId,
      nextHop: this.getNextHop(destId) ?? BROADCAST,
      ttl: MAX_TTL,
      hopCount: 0,
      payload,
      originLat: this.estLat,
      originLng: this.estLng,
      gossipEntries: [],
    });
  }
}
