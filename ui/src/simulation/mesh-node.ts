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
  BLE_RANGE_M,
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
import { BanditTracker } from "./bandit-tracker";

/** Radio interface type */
export type RadioType = "LoRa" | "BLE";

/** Local persistent storage for trust/crypto data */
export interface NodeStorage {
  /** This node's public key */
  publicKey: string;
  /** This node's private key (never transmitted) */
  privateKey: string;
  /** Trusted peer public keys: nodeId -> publicKey */
  trustedPeers: Map<number, string>;
  /** Reputation scores: nodeId -> score (0-1) */
  reputationScores: Map<number, number>;
  /** Message history for verification */
  messageHistory: Array<{
    from: number;
    content: string;
    timestamp: number;
    verified: boolean;
  }>;
}

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

  /** Current LoRa channel (0-7) */
  loraChannel = 0;

  /** BLE enabled for phone connections */
  bleEnabled = true;

  /** Local storage for trust/crypto data */
  storage: NodeStorage;

  /** Callback for UI notifications (e.g., message received) */
  onNotification?: (message: string, level: "info" | "warn" | "error") => void;

  /** Messages received by this node (for UI display) */
  receivedMessages: Array<{
    id: string;
    fromNodeId: number;
    text: string;
    timestamp: number;
    hopCount: number;
  }> = [];

  /** Messages sent by this node with delivery status (for UI display) */
  sentMessages: Array<{
    id: string;
    toNodeId: number;
    text: string;
    timestamp: number;
    status: "sent" | "ok" | "collision" | "captured" | "jammed";
    hopCount: number;
  }> = [];

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
  protected rng: () => number; // Protected so MaliciousNode can access

  /** Current tick (updated each tick for message timestamping) */
  private currentTick = 0;

  /** Current radio state (reset each tick by simulator) */
  state: "idle" | "tx" | "rx" = "idle";

  /** When true, only route through trusted peers */
  private trustedOnlyRouting = false;

  /** Outbound queue — simulator pulls from this */
  txQueue: MeshPacket[] = [];

  /** Bandit tracker for message delivery success/failure on (frequency, recipient) pairs */
  bandit: BanditTracker = new BanditTracker();

  /** Track pending sends for correlation with delivery confirmations */
  protected pendingMessages: Map<string, { 
    destId: number; 
    recipientId: number; 
    sentTick: number;
    frequency: number; 
  }> = new Map();

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

    // Initialize crypto/trust storage
    this.storage = {
      publicKey: this.generatePublicKey(),
      privateKey: this.generatePrivateKey(),
      trustedPeers: new Map(),
      reputationScores: new Map(),
      messageHistory: [],
    };

    this.rng = xorshift32(id * 7919 + 1);
    this.nextBeaconTick =
      Math.floor(this.rng() * BEACON_INTERVAL) + BEACON_JITTER;
  }

  /* ── Tick ──────────────────────────────────────────── */

  /** Called once per simulation tick. May enqueue a heartbeat message. */
  tick(currentTick: number): void {
    // Store current tick for message timestamping
    this.currentTick = currentTick;
    
    // Expire old neighbors and FTM readings
    for (const [nid, entry] of this.neighborTable) {
      if (currentTick - entry.lastSeenTick > NEIGHBOR_EXPIRY) {
        this.neighborTable.delete(nid);
        this.ftmReadings.delete(nid);
      }
    }

    // Check for pending messages that have timed out (no ACK received)
    const pendingTimeout = 100; // ticks
    for (const [packetId, pending] of this.pendingMessages) {
      if (currentTick - pending.sentTick > pendingTimeout) {
        // Message didn't get ACK within timeout, record as failure
        this.bandit.recordAttempt(pending.frequency, pending.recipientId, false, currentTick);
        this.pendingMessages.delete(packetId);
      }
    }

    // Attempt trilateration if not an anchor and we have readings
    if (!this.isAnchor) {
      this.attemptTrilateration();
    }

    // Beacon timer: send heartbeat as a regular broadcast message
    if (currentTick >= this.nextBeaconTick) {
      this.enqueueHeartbeatMessage();
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
      case PacketType.DATA:
        return this.processData(packet);

      case PacketType.ACK:
        // ACKs are consumed and update bandit tracker
        this.processAck(packet, currentTick);
        return null;

      // HEARTBEAT is no longer used - heartbeats are now regular DATA messages
      default:
        return null;
    }
  }

  /**
   * Process an incoming ACK to update delivery success in bandit tracker
   */
  private processAck(packet: MeshPacket, currentTick: number): void {
    // ACK payload is "ACK:<originalPacketId>"
    const ackMatch = packet.payload.match(/ACK:(.+)/);
    if (!ackMatch) return;
    
    const originalPacketId = ackMatch[1];
    const pending = this.pendingMessages.get(originalPacketId);
    
    if (!pending) return;
    
    // Update bandit tracker with success using stored frequency
    this.bandit.recordAttempt(pending.frequency, pending.recipientId, true, currentTick);
    
    // Clean up pending message
    this.pendingMessages.delete(originalPacketId);
  }

  /* ── Heartbeat as Regular Message ──────────────────── */

  /**
   * Enqueue a heartbeat as a regular broadcast DATA message.
   * This triggers normal ACK-based delivery confirmation and bandit learning.
   * The message payload contains gossip information.
   */
  private enqueueHeartbeatMessage(): void {
    // Build gossip entries
    const gossipEntries = this.getGossipEntries();
    
    // Serialize gossip into payload (JSON)
    const gossipPayload = JSON.stringify(gossipEntries);
    
    // Send as broadcast DATA message
    // Using BROADCAST as destination, which will be sent to all neighbors
    const packetId = `${this.id}-${this.packetCounter++}`;
    const frequency = 1; // Direct broadcast to neighbors
    
    // Track as pending for delivery confirmation
    // Use a special marker in payload to identify heartbeat
    this.pendingMessages.set(packetId, {
      destId: BROADCAST,
      recipientId: BROADCAST, // We'll track success if any neighbor acks
      sentTick: this.currentTick,
      frequency,
    });
    
    this.txQueue.push({
      id: packetId,
      type: PacketType.DATA,
      sourceId: this.id,
      destId: BROADCAST,
      nextHop: BROADCAST,
      ttl: 1, // Heartbeats don't relay
      hopCount: 0,
      payload: `[GOSSIP]${gossipPayload}`,
      originLat: this.estLat,
      originLng: this.estLng,
      gossipEntries: [], // Gossip is in payload, not in packet metadata
      radioType: "LoRa",
    });

    this.sentMessages.push({
      id: packetId,
      toNodeId: BROADCAST,
      text: "[Gossip Heartbeat]",
      timestamp: this.currentTick,
      status: "sent",
      hopCount: 0,
    });
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
    // Check if this is a gossip heartbeat message
    if (packet.payload.startsWith("[GOSSIP]")) {
      try {
        const gossipJson = packet.payload.substring(8); // Remove "[GOSSIP]" prefix
        const gossipEntries: GossipEntry[] = JSON.parse(gossipJson);
        
        // Process gossip from heartbeat
        this.processGossipHeartbeat(packet, gossipEntries, this.currentTick);
      } catch {
        // Malformed gossip, ignore but still ACK
      }
      
      // Still return ACK so the sender learns this heartbeat message was delivered
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
        radioType: packet.radioType,
      };
    }

    // Regular message delivery
    // Delivered!
    if (packet.destId === this.id) {
      // Store the received message (strip tracking ID from payload)
      const cleanPayload = packet.payload.replace(/\[trk:[^\]]+\]/, '');
      
      this.receivedMessages.push({
        id: packet.id,
        fromNodeId: packet.sourceId,
        text: cleanPayload,
        timestamp: this.currentTick,
        hopCount: packet.hopCount,
      });

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
        // ACKs use the same radio that the incoming packet came on
        radioType: packet.radioType,
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

  /**
   * Process gossip entries from a heartbeat message
   */
  private processGossipHeartbeat(
    packet: MeshPacket,
    gossipEntries: GossipEntry[],
    currentTick: number,
  ): void {
    // Update neighbor entry for sender
    const senderSelf = gossipEntries.find(
      (e) => e.nodeId === packet.sourceId,
    );
    const senderLabel = senderSelf?.label ?? `Node ${packet.sourceId}`;
    const senderConfidence = senderSelf?.posConfidence ?? 0;

    this.neighborTable.set(packet.sourceId, {
      nodeId: packet.sourceId,
      sequenceNum: senderSelf?.sequenceNum ?? 0,
      hopsAway: 1,
      lastSeenTick: currentTick,
      rssi: 0, // Not available from DATA packet
      lat: packet.originLat,
      lng: packet.originLng,
      posConfidence: senderConfidence,
      viaNode: packet.sourceId,
      label: senderLabel,
    });

    // Process piggybacked gossip from other nodes
    for (const entry of gossipEntries) {
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
          rssi: 0, // degraded estimate not applicable
          lat: entry.lat,
          lng: entry.lng,
          posConfidence: entry.posConfidence * 0.9, // degrade confidence
          viaNode: packet.sourceId,
          label: entry.label,
        });
      }
    }
  }

  /** Geographic + Gradient routing to pick next hop */
  getNextHop(destId: number): number | null {
    // Filter neighbors by trust if trusted-only routing is enabled
    const candidateNeighbors = new Map<number, NeighborEntry>();
    for (const [nid, entry] of this.neighborTable) {
      if (this.trustedOnlyRouting && !this.storage.trustedPeers.has(nid)) {
        continue; // Skip untrusted neighbors when trust-only mode is on
      }
      candidateNeighbors.set(nid, entry);
    }

    // 1. Direct neighbor?
    const direct = candidateNeighbors.get(destId);
    if (direct && direct.hopsAway === 1) return destId;

    // 2. Geographic greedy forwarding (using estimated positions)
    const destEntry = candidateNeighbors.get(destId);
    if (destEntry && destEntry.posConfidence > 0.3) {
      const myDist = haversine(
        this.estLat,
        this.estLng,
        destEntry.lat,
        destEntry.lng,
      );
      let bestId: number | null = null;
      let bestDist = myDist; // must improve on our distance

      for (const [nid, n] of candidateNeighbors) {
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
        const via = candidateNeighbors.get(destEntry.viaNode);
        if (via && via.hopsAway === 1) return destEntry.viaNode;
      }

      // 4. Last resort — closest neighbor to dest even if no improvement
      bestDist = Infinity;
      for (const [nid, n] of candidateNeighbors) {
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
      const via = candidateNeighbors.get(destEntry.viaNode);
      if (via && via.hopsAway === 1) return destEntry.viaNode;
    }

    return null; // no knowledge of destination
  }

  /**
   * BLE/LoRa optimization algorithm:
   * Determines which radio to use for a transmission based on distance to target.
   * 
   * - If destination is a direct neighbor within BLE range (~100m): use BLE
   * - Otherwise: use LoRa for longer range
   * 
   * BLE advantages: Reliable short range, less power, doesn't trigger interference
   * LoRa advantages: Long range, penetrates obstacles, but noisier
   */
  private determineRadioType(targetNodeId: number): "BLE" | "LoRa" {
    const neighbor = this.neighborTable.get(targetNodeId);
    
    // If no position info, default to LoRa
    if (!neighbor) return "LoRa";
    
    // Calculate distance to this neighbor
    const distance = haversine(
      this.estLat,
      this.estLng,
      neighbor.lat,
      neighbor.lng,
    );
    
    // If within BLE range AND it's a direct neighbor, use BLE to reduce LoRa noise
    if (distance <= BLE_RANGE_M && neighbor.hopsAway === 1) {
      return "BLE";
    }
    
    // For longer distances or multi-hop, use LoRa
    return "LoRa";
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
    const packetId = `${this.id}-${this.packetCounter++}`;
    const cleanPayload = payload.replace(/\[trk:[^\]]+\]/, '');
    
    // Determine which radio to use based on distance to next hop
    const nextHop = this.getNextHop(destId) ?? BROADCAST;
    const radioType = nextHop !== BROADCAST 
      ? this.determineRadioType(nextHop)
      : "LoRa"; // Broadcast fallback uses LoRa
    
    // Determine frequency: 1 for direct (single hop), 2 for routed/broadcast (multihop)
    const neighbor = this.neighborTable.get(nextHop);
    const frequency = (nextHop !== BROADCAST && neighbor && neighbor.hopsAway === 1) ? 1 : 2;
    
    // Track pending message for delivery confirmation
    this.pendingMessages.set(packetId, {
      destId,
      recipientId: destId,
      sentTick: this.currentTick,
      frequency,
    });
    
    this.txQueue.push({
      id: packetId,
      type: PacketType.DATA,
      sourceId: this.id,
      destId,
      nextHop,
      ttl: MAX_TTL,
      hopCount: 0,
      payload,
      originLat: this.estLat,
      originLng: this.estLng,
      gossipEntries: [],
      radioType,
    });

    // Track sent message
    this.sentMessages.push({
      id: packetId,
      toNodeId: destId,
      text: cleanPayload,
      timestamp: this.currentTick,
      status: "sent",
      hopCount: 0,
    });
  }

  /**
   * Update the status of a sent message (called by simulator when transmission completes).
   */
  recordTransmissionResult(
    packetId: string,
    status: "ok" | "collision" | "captured" | "jammed",
  ): void {
    const msg = this.sentMessages.find((m) => m.id === packetId);
    if (msg) {
      msg.status = status;
    }
  }

  /* ── New Interface: loop() and userSend() ─────────────
   * These methods provide the clean abstraction requested:
   * - loop() runs each tick for background operations
   * - userSend() simulates a user action
   * ───────────────────────────────────────────────────── */

  /**
   * Main loop - runs every tick in the background.
   * Handles protocol operations: beacons, routing, trust updates.
   * This is called by the simulator each tick.
   */
  loop(currentTick: number): void {
    // This wraps the existing tick() logic but provides 
    // a cleaner interface for future extensions
    this.tick(currentTick);

    // Additional background tasks can go here
    // E.g., trust score decay, security checks, etc.
    this.updateReputationScores();
  }

  /**
   * User-initiated send (e.g., from phone app via BLE).
   * This is the interface for external message injection.
   * 
   * @param destId - Destination node ID
   * @param message - Message text
   * @param radio - Which radio to use ("BLE" for phone, "LoRa" for mesh)
   */
  userSend(destId: number, message: string, radio: RadioType = "LoRa"): void {
    if (radio === "BLE" && !this.bleEnabled) {
      this.notify("BLE is disabled on this node", "warn");
      return;
    }

    // Sign message with our private key (simplified - in real impl would use actual crypto)
    const signedMessage = this.signMessage(message);

    // Enqueue for transmission
    this.enqueueData(destId, signedMessage);

    this.notify(`Sent message to Node ${destId} via ${radio}`, "info");
  }

  /* ── Trust & Crypto ───────────────────────────────────
   * Simple trust system for demo purposes.
   * Real implementation would use proper Ed25519 or similar.
   * ───────────────────────────────────────────────────── */

  private generatePublicKey(): string {
    // Simplified: In reality would use proper crypto lib
    return `PUB_${this.id}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private generatePrivateKey(): string {
    return `PRIV_${this.id}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private signMessage(message: string): string {
    // Simplified signing (in reality would use Ed25519 or ECDSA)
    const signature = `SIG:${this.storage.privateKey.slice(0, 8)}`;
    return `${message}|${signature}`;
  }

  /**
   * Verify a message from another node using their public key.
   */
  verifyMessage(fromNodeId: number, signedMessage: string): boolean {
    const peerKey = this.storage.trustedPeers.get(fromNodeId);
    if (!peerKey) {
      // Unknown peer - cannot verify
      return false;
    }

    // Simplified verification
    const [, signature] = signedMessage.split("|");
    return signature?.startsWith("SIG:");
  }

  /**
   * Add a trusted peer (manual trust establishment).
   */
  trustPeer(nodeId: number, publicKey: string): void {
    this.storage.trustedPeers.set(nodeId, publicKey);
    this.storage.reputationScores.set(nodeId, 0.5); // Start neutral
    this.notify(`Added Node ${nodeId} to trusted peers`, "info");
  }

  /**
   * Remove trust from a peer.
   */
  untrustPeer(nodeId: number): void {
    this.storage.trustedPeers.delete(nodeId);
    this.storage.reputationScores.delete(nodeId);
    this.notify(`Removed Node ${nodeId} from trusted peers`, "warn");
  }

  /**
   * Clear all trusted peers for this node.
   */
  clearTrustedPeers(): void {
    this.storage.trustedPeers.clear();
    this.storage.reputationScores.clear();
    this.notify("Cleared all trusted peers", "warn");
  }

  /**
   * Background reputation score updates.
   */
  private updateReputationScores(): void {
    // Decay all reputation scores slightly over time
    for (const [nodeId, score] of this.storage.reputationScores) {
      // Decay toward 0.5 (neutral)
      const newScore = score * 0.99 + 0.5 * 0.01;
      this.storage.reputationScores.set(nodeId, newScore);
    }
  }

  /**
   * Get reputation score for a peer.
   */
  getReputation(nodeId: number): number {
    return this.storage.reputationScores.get(nodeId) ?? 0.5;
  }

  /**
   * Update reputation based on observed behavior.
   */
  updateReputation(nodeId: number, delta: number): void {
    const current = this.getReputation(nodeId);
    const updated = Math.max(0, Math.min(1, current + delta));
    this.storage.reputationScores.set(nodeId, updated);
  }

  /**
   * Check if a peer is trusted.
   */
  isTrusted(nodeId: number): boolean {
    return this.storage.trustedPeers.has(nodeId);
  }

  /**
   * Get this node's public key for sharing.
   */
  getPublicKey(): string {
    return this.storage.publicKey;
  }

  /* ── Radio Management ─────────────────────────────────── */

  /**
   * Switch LoRa channel (for interference avoidance).
   */
  setLoRaChannel(channel: number): void {
    if (channel < 0 || channel > 7) {
      this.notify(`Invalid channel ${channel}`, "error");
      return;
    }
    this.loraChannel = channel;
    this.notify(`Switched to LoRa channel ${channel}`, "info");
  }

  /**
   * Toggle BLE radio.
   */
  setBleEnabled(enabled: boolean): void {
    this.bleEnabled = enabled;
    this.notify(`BLE ${enabled ? "enabled" : "disabled"}`, "info");
  }

  /**
   * Enable or disable trusted-only routing.
   * When enabled, this node only routes through trusted peers.
   */
  setTrustedOnlyRouting(enabled: boolean): void {
    this.trustedOnlyRouting = enabled;
  }

  /* ── Helpers ──────────────────────────────────────────── */

  protected notify(message: string, level: "info" | "warn" | "error"): void {
    if (this.onNotification) {
      this.onNotification(message, level);
    }
  }
}
