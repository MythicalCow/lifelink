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
  lat: number;
  lng: number;
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
}

/** One row in a node's neighbor/routing table */
export interface NeighborEntry {
  nodeId: number;
  sequenceNum: number;
  hopsAway: number;
  lastSeenTick: number;
  rssi: number;
  lat: number;
  lng: number;
  /** Direct neighbor we learned this entry from */
  viaNode: number;
}

/** Visual state of a node for the UI layer */
export interface NodeVisualState {
  id: number;
  lat: number;
  lng: number;
  state: "idle" | "tx" | "rx";
  neighborCount: number;
  knownNodes: number;
  label?: string;
}

/** An in-flight transmission for the UI */
export interface Transmission {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  packetType: PacketType;
  /** Whether this on-air attempt was received or collided */
  status: "ok" | "collision" | "captured";
  createdTick: number;
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
}
