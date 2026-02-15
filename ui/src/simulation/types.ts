/* ── Mesh Protocol Types ───────────────────────────────
 * Pure data structures — no DOM/React deps.
 * Designed to map 1:1 to C structs for ESP32 port.
 * ───────────────────────────────────────────────────── */

export const BROADCAST = -1;

export enum PacketType {
  HEARTBEAT = 0,
  DATA = 1,
  ACK = 2,
}

/** A gossip entry piggybacked inside a HEARTBEAT */
export interface GossipEntry {
  nodeId: number;
  sequenceNum: number;
  hopsAway: number;
  /** Estimated position (from trilateration, not GPS) */
  lat: number;
  lng: number;
  /** Confidence: 0 = unknown, 1 = anchor (GPS), 0.1-0.9 = trilaterated */
  posConfidence: number;
  /** Self-assigned node name, propagated through gossip */
  label: string;
}

/** A packet on the air */
export interface MeshPacket {
  id: string;
  type: PacketType;
  sourceId: number;
  destId: number;
  nextHop: number;
  ttl: number;
  hopCount: number;
  payload: string;
  /** Sender's position */
  originLat: number;
  originLng: number;
  /** Gossip payload (heartbeat only) */
  gossipEntries: GossipEntry[];
  /** Radio type used for transmission (BLE for short range, LoRa for long range) */
  radioType: "BLE" | "LoRa";
}

/** One row in a node's neighbor/routing table */
export interface NeighborEntry {
  nodeId: number;
  sequenceNum: number;
  hopsAway: number;
  lastSeenTick: number;
  rssi: number;
  /** Estimated position (from gossip) */
  lat: number;
  lng: number;
  posConfidence: number;
  /** Direct neighbor we learned this entry from */
  viaNode: number;
  /** Name learned from gossip heartbeat */
  label: string;
}

/** Visual state of a node for the UI layer */
export interface NodeVisualState {
  id: number;
  /** True position (for physics/rendering — "god mode") */
  trueLat: number;
  trueLng: number;
  /** Estimated position (what the node believes via trilateration) */
  estLat: number;
  estLng: number;
  /** Position confidence: 0 = unknown, 1 = anchor/GPS */
  posConfidence: number;
  state: "idle" | "tx" | "rx";
  neighborCount: number;
  knownNodes: number;
  /** This node's own name (from its config) */
  label: string;
  /** Node IDs this node currently trusts */
  trustedPeers: number[];
  /** Names of remote nodes this node has discovered via gossip.
   *  Key = nodeId, Value = label learned from heartbeats. */
  discoveredLabels: Record<number, string>;
  /** Messages received by this node */
  receivedMessages: Array<{
    id: string;
    fromNodeId: number;
    text: string;
    timestamp: number;
    hopCount: number;
  }>;
  /** Bandit stats for message delivery: key = "frequency:recipientId" */
  banditStats?: Record<string, {
    successCount: number;
    failureCount: number;
    totalAttempts: number;
    successRate: number;
  }>;
}

/** An in-flight transmission for the UI */
export interface Transmission {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  packetType: PacketType;
  /** Whether this on-air attempt was received or collided */
  status: "ok" | "collision" | "captured" | "jammed";
  createdTick: number;
  /** Channel the transmission was on (0-7) */
  channel: number;
  /** Whether the sender is a malicious node */
  isMalicious: boolean;
  /** Radio type used for transmission (BLE for short range, LoRa for long range) */
  radioType: "BLE" | "LoRa";
}

/** A log event for the UI */
export interface SimEvent {
  tick: number;
  message: string;
  level: "info" | "success" | "warn";
}

/** Aggregate stats */
export interface SimStats {
  tick: number;
  totalSent: number;
  totalDelivered: number;
  totalDropped: number;
  totalCollisions: number;
  avgHops: number;
  membershipCoverage: number; // 0–1
}

/** Full snapshot for the UI to render */
export interface SimState {
  tick: number;
  running: boolean;
  speed: number;
  nodeStates: NodeVisualState[];
  transmissions: Transmission[];
  events: SimEvent[];
  stats: SimStats;
  /** Tracking IDs of user messages confirmed delivered */
  deliveredTrackingIds: string[];
}
