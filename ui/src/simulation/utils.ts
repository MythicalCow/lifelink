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

/* ── FTM (Fine Timing Measurement) Distance ───────────
 * 802.11mc Time of Flight based ranging.
 * Much more accurate than RSSI (~1-2m vs ~5-10m).
 * ───────────────────────────────────────────────────── */

/** Speed of light in m/ns */
const C_M_NS = 0.299792458;

/**
 * Simulate FTM ranging measurement.
 * In real hardware: ESP32-S3 measures round-trip time and divides by 2.
 * Here we add realistic noise to the true distance.
 *
 * @param trueDistance - Actual distance in meters (from haversine)
 * @param rng - Random number generator for noise
 * @returns Measured distance with FTM-like accuracy (~1-2m error)
 */
export function ftmMeasureDistance(
  trueDistance: number,
  rng: () => number,
): number {
  // FTM accuracy is typically ±1-2 meters
  // Model as Gaussian noise with σ = 0.8m (68% within 0.8m, 95% within 1.6m)
  const sigma = 0.8;

  // Box-Muller transform for Gaussian noise
  const u1 = rng();
  const u2 = rng();
  const gaussian = Math.sqrt(-2 * Math.log(u1 + 0.0001)) * Math.cos(2 * Math.PI * u2);

  const noise = gaussian * sigma;
  return Math.max(0.1, trueDistance + noise);
}

/**
 * Convert Time of Flight (nanoseconds) to distance.
 * Used on real hardware after FTM measurement.
 */
export function tofToDistance(tofNs: number): number {
  // Distance = (ToF * c) / 2 (round trip)
  return (tofNs * C_M_NS) / 2;
}

/**
 * Convert distance to Time of Flight (nanoseconds).
 * For simulation/testing purposes.
 */
export function distanceToTof(distanceM: number): number {
  return (distanceM * 2) / C_M_NS;
}

/* ── Trilateration ────────────────────────────────────
 * Given 3+ anchor points with known positions and FTM-measured
 * distances, compute the unknown position using least-squares.
 * Works in local Cartesian approximation (meters from centroid).
 *
 * With FTM accuracy (~1-2m), this gives much better results
 * than RSSI-based ranging (~5-10m error).
 * ───────────────────────────────────────────────────── */

export interface AnchorReading {
  lat: number;
  lng: number;
  distance: number; // FTM-measured distance in meters
}

/** Meters per degree at a given latitude */
function metersPerDegree(lat: number): { latM: number; lngM: number } {
  const latRad = (lat * Math.PI) / 180;
  return {
    latM: 111_132.92 - 559.82 * Math.cos(2 * latRad),
    lngM: 111_412.84 * Math.cos(latRad),
  };
}

/**
 * Trilaterate position from 3+ anchor readings.
 * Returns estimated lat/lng or null if insufficient data.
 * Uses iterative least-squares refinement.
 */
export function trilaterate(
  anchors: AnchorReading[],
): { lat: number; lng: number } | null {
  if (anchors.length < 3) return null;

  // Use centroid as initial guess
  let estLat = anchors.reduce((s, a) => s + a.lat, 0) / anchors.length;
  let estLng = anchors.reduce((s, a) => s + a.lng, 0) / anchors.length;

  const { latM, lngM } = metersPerDegree(estLat);

  // Convert to local Cartesian (meters from centroid)
  const points = anchors.map((a) => ({
    x: (a.lng - estLng) * lngM,
    y: (a.lat - estLat) * latM,
    r: a.distance,
  }));

  // Iterative least-squares (Gauss-Newton, 10 iterations)
  let x = 0;
  let y = 0;

  for (let iter = 0; iter < 10; iter++) {
    let sumDx = 0;
    let sumDy = 0;
    let sumW = 0;

    for (const p of points) {
      const dx = x - p.x;
      const dy = y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const err = dist - p.r;
      const w = 1 / (p.r * p.r + 1); // weight by inverse variance

      sumDx += w * err * (dx / dist);
      sumDy += w * err * (dy / dist);
      sumW += w;
    }

    if (sumW > 0) {
      x -= (sumDx / sumW) * 0.5; // damped update
      y -= (sumDy / sumW) * 0.5;
    }
  }

  // Convert back to lat/lng
  return {
    lat: estLat + y / latM,
    lng: estLng + x / lngM,
  };
}
