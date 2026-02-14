/* ── MeshSimulator ────────────────────────────────────
 * Orchestrates ticks, models the radio channel, and
 * collects visual state for the UI.
 * ───────────────────────────────────────────────────── */

import { MeshNode } from "./mesh-node";
import {
  PacketType,
  type MeshPacket,
  type Transmission,
  type SimEvent,
  type SimStats,
  type NodeVisualState,
  type SimState,
} from "./types";
import {
  RADIO_RANGE_M,
  CAPTURE_THRESHOLD_DB,
  TX_VISUAL_DURATION,
  MAX_LOG_EVENTS,
} from "./config";
import { haversine } from "./utils";
import type { SensorNode } from "@/types/sensor";

interface AirPacket {
  sender: MeshNode;
  packet: MeshPacket;
}

interface ReceptionCandidate {
  sender: MeshNode;
  receiver: MeshNode;
  packet: MeshPacket;
  rssi: number;
}

export class MeshSimulator {
  nodes: Map<number, MeshNode> = new Map();
  tick = 0;

  private transmissions: Transmission[] = [];
  private events: SimEvent[] = [];
  private totalSent = 0;
  private totalDelivered = 0;
  private totalDropped = 0;
  private totalCollisions = 0;
  private hopAccumulator = 0;
  private deliveryCount = 0;
  private deliveredTrackingIds: Set<string> = new Set();

  /* ── Init ──────────────────────────────────────────── */

  constructor(sensorNodes: SensorNode[]) {
    for (const sn of sensorNodes) {
      this.nodes.set(
        sn.id,
        new MeshNode(sn.id, sn.lat, sn.lng, sn.label ?? `Node ${sn.id}`),
      );
    }
  }

  /* ── Tick ──────────────────────────────────────────── */

  /** Advance simulation by one tick. Returns full state snapshot. */
  step(): SimState {
    this.tick++;

    // Reset visual states
    for (const node of this.nodes.values()) {
      node.state = "idle";
    }

    // 1. Each node runs its internal tick (beacon timers, expiry)
    for (const node of this.nodes.values()) {
      node.tick(this.tick);
    }

    // 2. Process TX queues — one packet per node per tick (half-duplex)
    const packetsInAir: AirPacket[] = [];
    for (const node of this.nodes.values()) {
      const pkt = node.txQueue.shift();
      if (pkt) {
        node.state = "tx";
        packetsInAir.push({ sender: node, packet: pkt });
        this.totalSent++;
      }
    }

    // 3. Build per-receiver contention map for this tick.
    // If multiple packets arrive at a receiver in the same tick, we model
    // LoRa channel contention + capture effect.
    const receptionMap = new Map<number, ReceptionCandidate[]>();
    for (const air of packetsInAir) {
      const { sender, packet } = air;
      let heardByAnyReceiver = false;

      for (const receiver of this.nodes.values()) {
        if (receiver.id === sender.id) continue;
        if (receiver.state === "tx") continue; // cannot RX while TX

        const dist = haversine(
          sender.lat,
          sender.lng,
          receiver.lat,
          receiver.lng,
        );
        if (dist > RADIO_RANGE_M) continue;

        // RSSI model: simple log-distance path loss
        const rssi = -40 - 20 * Math.log10(Math.max(dist, 1));
        heardByAnyReceiver = true;

        const list = receptionMap.get(receiver.id) ?? [];
        list.push({ sender, receiver, packet, rssi });
        receptionMap.set(receiver.id, list);
      }

      this.logPacketSend(sender, packet);

      // No one in range -> drop (for data/ack payload traffic)
      if (
        !heardByAnyReceiver &&
        (packet.type === PacketType.DATA || packet.type === PacketType.ACK)
      ) {
        this.totalDropped++;
        this.log(
          `✗ Packet from ${sender.label} lost (no receivers in range)`,
          "warn",
        );
      }
    }

    // 4. Resolve each receiver's on-air contention.
    for (const candidates of receptionMap.values()) {
      if (candidates.length === 1) {
        this.deliverCandidate(candidates[0], "ok");
        continue;
      }

      // Multiple same-tick arrivals at one receiver => contention.
      // Capture effect: strongest packet may still decode if it exceeds
      // the second strongest by CAPTURE_THRESHOLD_DB.
      const sorted = [...candidates].sort((a, b) => b.rssi - a.rssi);
      const strongest = sorted[0];
      const second = sorted[1];
      const margin = strongest.rssi - second.rssi;

      this.totalCollisions++;

      if (margin >= CAPTURE_THRESHOLD_DB) {
        this.log(
          `⚡ Capture at ${strongest.receiver.label}: ${sorted.length} simultaneous packets, strongest won by ${margin.toFixed(1)} dB`,
          "warn",
        );
        this.deliverCandidate(strongest, "captured");
        for (let i = 1; i < sorted.length; i++) {
          this.dropCandidateByCollision(sorted[i]);
        }
      } else {
        this.log(
          `✗ Collision at ${strongest.receiver.label}: ${sorted.length} simultaneous packets`,
          "warn",
        );
        for (const candidate of sorted) {
          this.dropCandidateByCollision(candidate);
        }
      }
    }

    // Prune old transmissions
    this.transmissions = this.transmissions.filter(
      (t) => this.tick - t.createdTick < TX_VISUAL_DURATION,
    );

    // Prune old events
    if (this.events.length > MAX_LOG_EVENTS) {
      this.events = this.events.slice(-MAX_LOG_EVENTS);
    }

    return this.getState();
  }

  /* ── Public actions ────────────────────────────────── */

  sendMessage(
    fromId: number,
    toId: number,
    payload = "hello",
    trackingId?: string,
  ): void {
    const node = this.nodes.get(fromId);
    if (!node) return;
    // Embed tracking ID in payload so we can confirm delivery later
    const taggedPayload = trackingId
      ? `[trk:${trackingId}]${payload}`
      : payload;
    node.enqueueData(toId, taggedPayload);
    this.log(
      `📨 User sent "${payload}" from ${node.label} → Node ${toId}`,
      "info",
    );
  }

  reset(sensorNodes: SensorNode[]): void {
    this.nodes.clear();
    for (const sn of sensorNodes) {
      this.nodes.set(
        sn.id,
        new MeshNode(sn.id, sn.lat, sn.lng, sn.label ?? `Node ${sn.id}`),
      );
    }
    this.tick = 0;
    this.transmissions = [];
    this.events = [];
    this.totalSent = 0;
    this.totalDelivered = 0;
    this.totalDropped = 0;
    this.totalCollisions = 0;
    this.hopAccumulator = 0;
    this.deliveryCount = 0;
    this.deliveredTrackingIds.clear();
    this.log("Simulation reset", "info");
  }

  /* ── State snapshot ────────────────────────────────── */

  getState(): SimState {
    const nodeStates: NodeVisualState[] = [];
    let totalKnown = 0;
    const nodeCount = this.nodes.size;

    for (const node of this.nodes.values()) {
      totalKnown += node.knownNodeCount;

      // Build map of labels this node has discovered via gossip
      const discoveredLabels: Record<number, string> = {};
      for (const [nid, entry] of node.neighborTable) {
        discoveredLabels[nid] = entry.label;
      }

      nodeStates.push({
        id: node.id,
        lat: node.lat,
        lng: node.lng,
        state: node.state,
        neighborCount: node.directNeighborCount,
        knownNodes: node.knownNodeCount,
        label: node.label,
        discoveredLabels,
      });
    }

    const avgCoverage =
      nodeCount > 0
        ? totalKnown / (nodeCount * (nodeCount - 1))
        : 0;

    const stats: SimStats = {
      tick: this.tick,
      totalSent: this.totalSent,
      totalDelivered: this.totalDelivered,
      totalDropped: this.totalDropped,
      totalCollisions: this.totalCollisions,
      avgHops:
        this.deliveryCount > 0
          ? this.hopAccumulator / this.deliveryCount
          : 0,
      membershipCoverage: Math.min(avgCoverage, 1),
    };

    return {
      tick: this.tick,
      running: false, // controlled by hook
      speed: 1,
      nodeStates,
      transmissions: [...this.transmissions],
      events: [...this.events],
      stats,
      deliveredTrackingIds: [...this.deliveredTrackingIds],
    };
  }

  /* ── Internal helpers ──────────────────────────────── */

  private log(message: string, level: SimEvent["level"]): void {
    this.events.push({ tick: this.tick, message, level });
  }

  private logPacketSend(sender: MeshNode, packet: MeshPacket): void {
    if (packet.type === PacketType.HEARTBEAT) {
      if (this.tick % 10 === 0) {
        // Don't spam heartbeat logs — show every 10th tick.
        this.log(
          `📡 ${sender.label} heartbeat (${packet.gossipEntries.length} gossip entries)`,
          "info",
        );
      }
      return;
    }

    if (packet.type === PacketType.DATA) {
      this.log(`→ ${sender.label} sent DATA to Node ${packet.destId}`, "info");
      return;
    }

    if (packet.type === PacketType.ACK) {
      this.log(`↩ ${sender.label} sent ACK to Node ${packet.destId}`, "info");
    }
  }

  private deliverCandidate(
    candidate: ReceptionCandidate,
    status: Transmission["status"],
  ): void {
    const { sender, receiver, packet, rssi } = candidate;
    receiver.state = "rx";

    this.transmissions.push({
      fromLat: sender.lat,
      fromLng: sender.lng,
      toLat: receiver.lat,
      toLng: receiver.lng,
      packetType: packet.type,
      status,
      createdTick: this.tick,
    });

    const response = receiver.receive(packet, rssi, this.tick);
    if (!response) return;

    receiver.txQueue.push(response);

    if (response.type === PacketType.ACK) {
      this.totalDelivered++;
      this.hopAccumulator += packet.hopCount;
      this.deliveryCount++;

      // Extract tracking ID from payload for delivery confirmation
      const trkMatch = packet.payload.match(/\[trk:([^\]]+)\]/);
      if (trkMatch) {
        this.deliveredTrackingIds.add(trkMatch[1]);
      }

      this.log(
        `✓ Delivered to ${receiver.label} from Node ${packet.sourceId} (${packet.hopCount} hops)`,
        "success",
      );
    } else if (response.type === PacketType.DATA) {
      this.log(
        `↳ ${receiver.label} forwarding to next hop (hop ${response.hopCount})`,
        "info",
      );
    }
  }

  private dropCandidateByCollision(candidate: ReceptionCandidate): void {
    const { sender, receiver, packet } = candidate;

    this.transmissions.push({
      fromLat: sender.lat,
      fromLng: sender.lng,
      toLat: receiver.lat,
      toLng: receiver.lng,
      packetType: packet.type,
      status: "collision",
      createdTick: this.tick,
    });

    if (packet.type === PacketType.DATA || packet.type === PacketType.ACK) {
      this.totalDropped++;
      this.log(
        `✗ Collision drop: ${sender.label} → ${receiver.label}`,
        "warn",
      );
    }
  }
}
