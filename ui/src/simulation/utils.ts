/* ── Geo Utilities ────────────────────────────────────
 * Haversine distance — maps to a C helper for ESP32.
 * ───────────────────────────────────────────────────── */

const R = 6_371_000; // Earth radius in meters

/** Returns distance in meters between two lat/lng points */
export function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Simple seeded PRNG (xorshift32) for deterministic jitter */
export function xorshift32(seed: number): () => number {
  let state = seed | 1;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff; // 0–1
  };
}
