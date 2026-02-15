/* ── Simulation Parameters ─────────────────────────────
 * Tunables that map to real LoRa + Wi-Fi FTM constraints.
 * ───────────────────────────────────────────────────── */

/** LoRa radio range in meters (campus w/ buildings) */
export const RADIO_RANGE_M = 450;

/** BLE radio range in meters (short range, line of sight typically) */
export const BLE_RANGE_M = 100;

/** FTM (802.11mc) ranging distance in meters.
 *  Real hardware: ~50m indoor, ~100m outdoor.
 *  Bumped for simulation demo. */
export const FTM_RANGE_M = 200;

/** Capture effect threshold in dB (strongest packet wins if above threshold) */
export const CAPTURE_THRESHOLD_DB = 6;

/** Beacon interval in ticks (1 tick ≈ 100 ms sim-time) */
export const BEACON_INTERVAL = 40; // ~4 sec

/** Random jitter added to beacon interval (ticks) */
export const BEACON_JITTER = 15;

/** Max gossip entries piggybacked per heartbeat */
export const MAX_GOSSIP_ENTRIES = 6;

/** Max packet TTL (hops) */
export const MAX_TTL = 12;

/** Neighbor expiry time in ticks (~20 sec) */
export const NEIGHBOR_EXPIRY = 200;

/** Dedup buffer size (packet IDs) */
export const DEDUP_BUFFER_SIZE = 64;

/** Transmissions stay visible for this many ticks */
export const TX_VISUAL_DURATION = 4;

/** Max recent events kept for the log panel */
export const MAX_LOG_EVENTS = 30;
