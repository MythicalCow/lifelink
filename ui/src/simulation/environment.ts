/* ── Environment ───────────────────────────────────────
 * Simulates the RF environment: signal propagation,
 * interference, frequency channels, and capture effect.
 * Decoupled from node logic.
 * ───────────────────────────────────────────────────── */

import { haversine } from "./utils";
import { RADIO_RANGE_M, CAPTURE_THRESHOLD_DB } from "./config";
import type { MeshPacket } from "./types";

/** Frequency channel (MHz offset from base frequency) */
export interface Channel {
  id: number;
  frequencyMHz: number;
  /** Current interference level (0-1) */
  interference: number;
}

/** A signal transmission in the environment */
export interface AirSignal {
  packet: MeshPacket;
  senderNodeId: number;
  senderLat: number;
  senderLng: number;
  channel: number;
  txPowerDbm: number;
  tick: number;
}

/** Reception details for a node */
export interface ReceptionResult {
  packet: MeshPacket;
  rssi: number;
  snr: number;
  channel: number;
  status: "ok" | "collision" | "captured" | "jammed";
}

/** Spectrum analysis data */
export interface SpectrumData {
  channel: number;
  frequencyMHz: number;
  signalCount: number;
  avgRssi: number;
  interference: number;
}

/**
 * Environment manages the RF channel, signal propagation,
 * interference, and determines what each node receives.
 */
export class Environment {
  /** Available LoRa frequency channels (915 MHz band) */
  private channels: Map<number, Channel> = new Map();

  /** Signals currently in the air (cleared each tick) */
  private airSignals: AirSignal[] = [];

  /** Interference sources (jammers, etc.) */
  private jammerLocations: Array<{
    lat: number;
    lng: number;
    radiusM: number;
    powerDbm: number;
    channels: number[]; // which channels to jam
  }> = [];

  /** Noise floor per channel (dBm) */
  private noiseFloor = -110;

  constructor() {
    // Initialize 8 LoRa channels in the 915 MHz ISM band
    // Real LoRa uses 125 kHz channels
    for (let i = 0; i < 8; i++) {
      this.channels.set(i, {
        id: i,
        frequencyMHz: 915.0 + i * 0.125,
        interference: 0,
      });
    }
  }

  /* ── Tick Management ─────────────────────────────────── */

  /**
   * Start a new tick - clears air signals from previous tick.
   */
  startTick(): void {
    this.airSignals = [];
    // Decay interference over time
    for (const ch of this.channels.values()) {
      ch.interference *= 0.95;
    }
  }

  /* ── Transmission ────────────────────────────────────── */

  /**
   * Node transmits a packet on a specific channel.
   * Returns false if channel is completely jammed.
   */
  transmit(
    packet: MeshPacket,
    senderNodeId: number,
    senderLat: number,
    senderLng: number,
    channel: number,
    txPowerDbm = 20,
  ): boolean {
    const ch = this.channels.get(channel);
    if (!ch) return false;

    // Check if this location is being jammed on this channel
    const jamPower = this.getJammingPower(senderLat, senderLng, channel);
    if (jamPower > txPowerDbm + 10) {
      // Completely jammed - transmission fails
      return false;
    }

    this.airSignals.push({
      packet,
      senderNodeId,
      senderLat,
      senderLng,
      channel,
      txPowerDbm,
      tick: 0, // Set by simulator
    });

    return true;
  }

  /* ── Reception ───────────────────────────────────────── */

  /**
   * Determine what a node at (lat, lng) receives on a specific channel.
   * Handles collisions, capture effect, and interference.
   */
  receive(
    receiverNodeId: number,
    receiverLat: number,
    receiverLng: number,
    channel: number,
  ): ReceptionResult[] {
    const results: ReceptionResult[] = [];

    // Filter signals on this channel that reach this receiver
    const candidates: Array<{
      signal: AirSignal;
      rssi: number;
      distance: number;
    }> = [];

    for (const signal of this.airSignals) {
      // Skip own transmissions
      if (signal.senderNodeId === receiverNodeId) continue;
      // Skip other channels
      if (signal.channel !== channel) continue;

      const dist = haversine(
        signal.senderLat,
        signal.senderLng,
        receiverLat,
        receiverLng,
      );

      // Out of range
      if (dist > RADIO_RANGE_M) continue;

      // Calculate RSSI (log-distance path loss)
      const rssi = signal.txPowerDbm - 40 - 20 * Math.log10(Math.max(dist, 1));

      candidates.push({ signal, rssi, distance: dist });
    }

    if (candidates.length === 0) {
      return results;
    }

    // Calculate ambient interference + jamming at this location
    const jamPower = this.getJammingPower(receiverLat, receiverLng, channel);
    const ch = this.channels.get(channel)!;
    const totalNoise = this.noiseFloor + jamPower + ch.interference * 20;

    if (candidates.length === 1) {
      // Single signal - check if above noise floor
      const { signal, rssi } = candidates[0];
      const snr = rssi - totalNoise;

      if (snr < 0) {
        // Below noise, jammed
        results.push({
          packet: signal.packet,
          rssi,
          snr,
          channel,
          status: "jammed",
        });
      } else {
        results.push({
          packet: signal.packet,
          rssi,
          snr,
          channel,
          status: "ok",
        });
      }
      return results;
    }

    // Multiple signals - collision handling with capture effect
    candidates.sort((a, b) => b.rssi - a.rssi);
    const strongest = candidates[0];
    const secondStrongest = candidates[1];
    const margin = strongest.rssi - secondStrongest.rssi;

    // Update channel interference metric
    ch.interference = Math.min(ch.interference + 0.1 * candidates.length, 1);

    if (margin >= CAPTURE_THRESHOLD_DB) {
      // Strongest packet captures, others collide
      const snr = strongest.rssi - totalNoise;
      results.push({
        packet: strongest.signal.packet,
        rssi: strongest.rssi,
        snr,
        channel,
        status: snr < 0 ? "jammed" : "captured",
      });

      // Mark others as collisions
      for (let i = 1; i < candidates.length; i++) {
        const snr = candidates[i].rssi - totalNoise;
        results.push({
          packet: candidates[i].signal.packet,
          rssi: candidates[i].rssi,
          snr,
          channel,
          status: "collision",
        });
      }
    } else {
      // All collide
      for (const candidate of candidates) {
        const snr = candidate.rssi - totalNoise;
        results.push({
          packet: candidate.signal.packet,
          rssi: candidate.rssi,
          snr,
          channel,
          status: "collision",
        });
      }
    }

    return results;
  }

  /* ── Interference / Jamming ──────────────────────────── */

  /**
   * Add a jammer at a location.
   */
  addJammer(
    lat: number,
    lng: number,
    radiusM: number,
    powerDbm: number,
    channels: number[],
  ): void {
    this.jammerLocations.push({ lat, lng, radiusM, powerDbm, channels });
  }

  /**
   * Remove all jammers.
   */
  clearJammers(): void {
    this.jammerLocations = [];
  }

  /**
   * Get jamming power at a location on a specific channel (in dBm).
   */
  private getJammingPower(lat: number, lng: number, channel: number): number {
    let maxPower = 0;

    for (const jammer of this.jammerLocations) {
      // Check if this jammer targets this channel
      if (!jammer.channels.includes(channel)) continue;

      const dist = haversine(lat, lng, jammer.lat, jammer.lng);
      if (dist > jammer.radiusM) continue;

      // Power decays with distance
      const power = jammer.powerDbm - 20 * Math.log10(Math.max(dist, 1));
      maxPower = Math.max(maxPower, power);
    }

    return maxPower;
  }

  /* ── Spectrum Analysis ───────────────────────────────── */

  /**
   * Get current spectrum data for all channels (for visualization).
   */
  getSpectrum(): SpectrumData[] {
    const spectrum: SpectrumData[] = [];

    for (const [channelId, ch] of this.channels) {
      // Count signals on this channel
      const signals = this.airSignals.filter((s) => s.channel === channelId);
      const avgRssi =
        signals.length > 0
          ? signals.reduce((sum, s) => sum + s.txPowerDbm, 0) / signals.length
          : -100;

      spectrum.push({
        channel: channelId,
        frequencyMHz: ch.frequencyMHz,
        signalCount: signals.length,
        avgRssi,
        interference: ch.interference,
      });
    }

    return spectrum;
  }

  /**
   * Get detailed air signals (for debugging/visualization).
   */
  getAirSignals(): AirSignal[] {
    return [...this.airSignals];
  }

  /**
   * Get channel health metrics.
   */
  getChannelHealth(channel: number): {
    interference: number;
    recommended: boolean;
  } {
    const ch = this.channels.get(channel);
    if (!ch) return { interference: 1, recommended: false };

    return {
      interference: ch.interference,
      recommended: ch.interference < 0.3,
    };
  }
}
