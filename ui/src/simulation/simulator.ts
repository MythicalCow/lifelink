/* ── MeshSimulator ────────────────────────────────────
 * Orchestrates ticks, models the radio channel, and
 * collects visual state for the UI.
 * Now uses Environment for RF physics and supports
 * MaliciousNode variants.
 * ───────────────────────────────────────────────────── */

import { MeshNode } from "./mesh-node";
import { MaliciousNode } from "./malicious-node";
import { Environment } from "./environment";
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
  FTM_RANGE_M,
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
  channel: number;
}

export class MeshSimulator {
  nodes: Map<number, MeshNode> = new Map();
  tick = 0;
  
  /** RF environment simulator */
  environment: Environment;

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
    this.environment = new Environment();
    
    for (const sn of sensorNodes) {
      // Use explicit isAnchor flag if provided, otherwise default to false
      const isAnchor = sn.isAnchor ?? false;
      
      // Check if this should be a malicious node (detect by label prefix)
      const isMalicious = sn.label?.startsWith("[MAL]") ?? false;
      
      if (isMalicious) {
        this.nodes.set(
          sn.id,
          new MaliciousNode(
            sn.id,
            sn.lat,
            sn.lng,
            sn.label ?? `Node ${sn.id}`,
            isAnchor,
            "jammer", // default strategy
          ),
        );
      } else {
        this.nodes.set(
          sn.id,
          new MeshNode(
            sn.id,
            sn.lat,
            sn.lng,
            sn.label ?? `Node ${sn.id}`,
            isAnchor,
          ),
        );
      }
    }
  }

  /* ── Tick ──────────────────────────────────────────── */

  /** Advance simulation by one tick. Returns full state snapshot. */
  step(): SimState {
    this.tick++;

    // Start new environment tick
    this.environment.startTick();

    // Reset visual states
    for (const node of this.nodes.values()) {
      node.state = "idle";
    }

    // 0. Perform FTM ranging between nearby nodes
    // In real hardware: ESP32-S3 does 802.11mc ranging via Wi-Fi
    // Here we simulate by providing true distances + noise
    this.performFtmRangingPhase();

    // 1. Each node runs its loop (beacon timers, expiry, trilateration, attacks)
    for (const node of this.nodes.values()) {
      node.loop(this.tick);
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

        // Use TRUE positions for physics (radio propagation)
        const dist = haversine(
          sender.trueLat,
          sender.trueLng,
          receiver.trueLat,
          receiver.trueLng,
        );
        if (dist > RADIO_RANGE_M) continue;

        // RSSI model: simple log-distance path loss
        const rssi = -40 - 20 * Math.log10(Math.max(dist, 1));
        heardByAnyReceiver = true;

        const list = receptionMap.get(receiver.id) ?? [];
        list.push({ sender, receiver, packet, rssi, channel: sender.loraChannel });
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
    this.environment = new Environment(); // Reset environment
    
    for (const sn of sensorNodes) {
      const isAnchor = sn.isAnchor ?? false;
      const isMalicious = sn.label?.startsWith("[MAL]") ?? false;
      
      if (isMalicious) {
        this.nodes.set(
          sn.id,
          new MaliciousNode(
            sn.id,
            sn.lat,
            sn.lng,
            sn.label ?? `Node ${sn.id}`,
            isAnchor,
            "jammer",
          ),
        );
      } else {
        this.nodes.set(
          sn.id,
          new MeshNode(
            sn.id,
            sn.lat,
            sn.lng,
            sn.label ?? `Node ${sn.id}`,
            isAnchor,
          ),
        );
      }
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
        trueLat: node.trueLat,
        trueLng: node.trueLng,
        estLat: node.estLat,
        estLng: node.estLng,
        posConfidence: node.posConfidence,
        state: node.state,
        neighborCount: node.directNeighborCount,
        knownNodes: node.knownNodeCount,
        label: node.label,
        trustedPeers: [...node.storage.trustedPeers.keys()],
        discoveredLabels,
        receivedMessages: [...node.receivedMessages],
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

  /**
   * Simulate FTM (802.11mc) ranging phase.
   * Each node performs Wi-Fi RTT ranging to nearby nodes.
   * This happens before the main tick so trilateration has fresh data.
   */
  private performFtmRangingPhase(): void {
    for (const node of this.nodes.values()) {
      // Only non-anchors need to range (anchors know their position)
      if (node.isAnchor) continue;

      // Find all nodes in FTM range and perform ranging
      for (const other of this.nodes.values()) {
        if (other.id === node.id) continue;

        const dist = haversine(
          node.trueLat,
          node.trueLng,
          other.trueLat,
          other.trueLng,
        );

        if (dist <= FTM_RANGE_M) {
          // Perform FTM ranging — node measures distance to other
          node.performFtmRanging(
            other.id,
            dist,
            other.trueLat,
            other.trueLng,
            this.tick,
          );
        }
      }
    }
  }

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
    const { sender, receiver, packet, rssi, channel } = candidate;
    receiver.state = "rx";

    this.transmissions.push({
      fromLat: sender.trueLat,
      fromLng: sender.trueLng,
      toLat: receiver.trueLat,
      toLng: receiver.trueLng,
      packetType: packet.type,
      status,
      createdTick: this.tick,
      channel,
      isMalicious: sender instanceof MaliciousNode,
    });

    // Record transmission result on sender node
    sender.recordTransmissionResult(packet.id, status);

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
    const { sender, receiver, packet, channel } = candidate;

    this.transmissions.push({
      fromLat: sender.trueLat,
      fromLng: sender.trueLng,
      toLat: receiver.trueLat,
      toLng: receiver.trueLng,
      packetType: packet.type,
      status: "collision",
      createdTick: this.tick,
      channel,
      isMalicious: sender instanceof MaliciousNode,
    });

    // Record collision status on sender node
    sender.recordTransmissionResult(packet.id, "collision");

    if (packet.type === PacketType.DATA || packet.type === PacketType.ACK) {
      this.totalDropped++;
      this.log(
        `✗ Collision drop: ${sender.label} → ${receiver.label}`,
        "warn",
      );
    }
  }

  /* ── New API: Trust Management ──────────────────────── */

  /**
   * Establish trust between two nodes (bidirectional).
   */
  establishTrust(nodeId1: number, nodeId2: number): void {
    const node1 = this.nodes.get(nodeId1);
    const node2 = this.nodes.get(nodeId2);
    
    if (!node1 || !node2) return;
    
    // Exchange public keys
    node1.trustPeer(nodeId2, node2.getPublicKey());
    node2.trustPeer(nodeId1, node1.getPublicKey());
    
    this.log(
      `🤝 Trust established between ${node1.label} and ${node2.label}`,
      "info",
    );
  }

  /**
   * Configure trust graph with specified density.
   * @param nodeIds - Nodes to include in trust graph
   * @param density - 0-1, percentage of possible connections to create
   */
  configureTrustGraph(nodeIds: number[], density: number): void {
    const d = Math.max(0, Math.min(1, density));

    for (const nodeId of nodeIds) {
      const node = this.nodes.get(nodeId);
      if (node) node.clearTrustedPeers();
    }
    
    // Create connections based on density
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        if (Math.random() < d) {
          this.establishTrust(nodeIds[i], nodeIds[j]);
        }
      }
    }
    
    const possibleConnections = (nodeIds.length * (nodeIds.length - 1)) / 2;
    const actualConnections = Math.floor(possibleConnections * d);
    
    this.log(
      `🌐 Trust graph configured: ${actualConnections} connections at ${(d * 100).toFixed(0)}% density`,
      "info",
    );
  }

  /**
   * Configure trust graph explicitly with a map of connections.
   */
  setTrustGraphFromMap(trustMap: Record<number, number[]>): void {
    const nodeIds = Object.keys(trustMap).map((id) => Number(id));
    const existingNodeIds = nodeIds.filter((id) => this.nodes.has(id));

    for (const nodeId of existingNodeIds) {
      const node = this.nodes.get(nodeId);
      if (node) node.clearTrustedPeers();
    }

    let connectionCount = 0;
    const seenPairs = new Set<string>();

    for (const nodeId of existingNodeIds) {
      const peers = trustMap[nodeId] ?? [];
      for (const peerId of peers) {
        if (!this.nodes.has(peerId)) continue;
        const a = Math.min(nodeId, peerId);
        const b = Math.max(nodeId, peerId);
        const key = `${a}-${b}`;
        if (a === b || seenPairs.has(key)) continue;
        seenPairs.add(key);
        this.establishTrust(a, b);
        connectionCount++;
      }
    }

    this.log(
      `🔗 Trust graph updated: ${connectionCount} explicit connections`,
      "info",
    );
  }

  /**
   * Get node instance (for direct access).
   */
  getNode(nodeId: number): MeshNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Get environment (for UI access to spectrum, jammers, etc.).
   */
  getEnvironment(): Environment {
    return this.environment;
  }

  /**
   * Add a jammer to the environment.
   */
  addJammer(
    lat: number,
    lng: number,
    radiusM: number,
    powerDbm: number,
    channels: number[],
  ): void {
    this.environment.addJammer(lat, lng, radiusM, powerDbm, channels);
    this.log(
      `🔇 Jammer deployed at (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      "warn",
    );
  }

  /**
   * Clear all jammers.
   */
  clearJammers(): void {
    this.environment.clearJammers();
    this.log("Jammers cleared", "info");
  }
}
