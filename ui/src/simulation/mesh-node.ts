/* ── MeshNode ─────────────────────────────────────────
 * Per-node protocol logic: Epidemic Gossip membership
 * + Geographic Greedy routing.  Pure state machine.
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
import { haversine, xorshift32 } from "./utils";

export class MeshNode {
  id: number;
  lat: number;
  lng: number;
  label: string;

  neighborTable: Map<number, NeighborEntry> = new Map();
  private seqNum = 0;
  private packetCounter = 0;
  private nextBeaconTick: number;
  private dedup: string[] = [];
  private rng: () => number;

  /** Current radio state (reset each tick by simulator) */
  state: "idle" | "tx" | "rx" = "idle";

  /** Outbound queue — simulator pulls from this */
  txQueue: MeshPacket[] = [];

  constructor(id: number, lat: number, lng: number, label: string) {
    this.id = id;
    this.lat = lat;
    this.lng = lng;
    this.label = label;
    this.rng = xorshift32(id * 7919 + 1);
    this.nextBeaconTick =
      Math.floor(this.rng() * BEACON_INTERVAL) + BEACON_JITTER;
  }

  /* ── Tick ──────────────────────────────────────────── */

  /** Called once per simulation tick. May enqueue a heartbeat. */
  tick(currentTick: number): void {
    // Expire old neighbors
    for (const [nid, entry] of this.neighborTable) {
      if (currentTick - entry.lastSeenTick > NEIGHBOR_EXPIRY) {
        this.neighborTable.delete(nid);
      }
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
      originLat: this.lat,
      originLng: this.lng,
      gossipEntries: entries,
    };
  }

  private processHeartbeat(
    packet: MeshPacket,
    rssi: number,
    currentTick: number,
  ): void {
    // Resolve sender's label from their self-entry in gossip
    const senderSelf = packet.gossipEntries.find(
      (e) => e.nodeId === packet.sourceId,
    );
    const senderLabel = senderSelf?.label ?? `Node ${packet.sourceId}`;

    // Direct neighbor entry — label learned from gossip
    this.neighborTable.set(packet.sourceId, {
      nodeId: packet.sourceId,
      sequenceNum: this.seqNum,
      hopsAway: 1,
      lastSeenTick: currentTick,
      rssi,
      lat: packet.originLat,
      lng: packet.originLng,
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
          viaNode: packet.sourceId,
          label: entry.label,
        });
      }
    }
  }

  private getGossipEntries(): GossipEntry[] {
    const entries: GossipEntry[] = [];
    // Include self — announce our own name
    entries.push({
      nodeId: this.id,
      sequenceNum: this.seqNum,
      hopsAway: 0,
      lat: this.lat,
      lng: this.lng,
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
        originLat: this.lat,
        originLng: this.lng,
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

    // 2. Geographic greedy forwarding
    const destEntry = this.neighborTable.get(destId);
    if (destEntry) {
      const myDist = haversine(this.lat, this.lng, destEntry.lat, destEntry.lng);
      let bestId: number | null = null;
      let bestDist = myDist; // must improve on our distance

      for (const [nid, n] of this.neighborTable) {
        if (n.hopsAway !== 1) continue; // direct neighbors only
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
      originLat: this.lat,
      originLng: this.lng,
      gossipEntries: [],
    });
  }
}
