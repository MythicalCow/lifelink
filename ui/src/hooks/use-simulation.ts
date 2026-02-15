"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { MeshSimulator } from "@/simulation/simulator";
import type { SimState } from "@/simulation/types";
import type { SensorNode } from "@/types/sensor";

const TICK_MS_BASE = 100; // 1x speed = 100ms per tick

export interface SimulationHook {
  state: SimState | null;
  running: boolean;
  speed: number;
  play: () => void;
  pause: () => void;
  toggleSpeed: () => void;
  stepOnce: () => void;
  sendMessage: (from: number, to: number, text?: string, trackingId?: string) => void;
  reset: () => void;
  refreshState: () => void;
  simRef: React.MutableRefObject<MeshSimulator | null>;
}

export function useSimulation(sensorNodes: SensorNode[]): SimulationHook {
  const simRef = useRef<MeshSimulator | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [state, setState] = useState<SimState | null>(null);

  // Init simulator (null-check pattern for React ref init)
  if (simRef.current == null) {
    simRef.current = new MeshSimulator(sensorNodes);
  }

  // Tick loop
  useEffect(() => {
    if (!running || !simRef.current) return;

    const ms = Math.max(TICK_MS_BASE / speed, 16);
    intervalRef.current = setInterval(() => {
      if (!simRef.current) return;
      const s = simRef.current.step();
      setState({ ...s, running: true, speed });
    }, ms);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, speed]);

  const play = useCallback(() => setRunning(true), []);
  const pause = useCallback(() => setRunning(false), []);

  const toggleSpeed = useCallback(() => {
    setSpeed((s) => {
      const speeds = [1, 2, 5, 10];
      const idx = speeds.indexOf(s);
      return speeds[(idx + 1) % speeds.length];
    });
  }, []);

  const sendMessage = useCallback(
    (fromId: number, toId: number, text?: string, trackingId?: string) => {
      if (!simRef.current) return;
      simRef.current.sendMessage(fromId, toId, text || "hello", trackingId);
      // Queue only — lets users enqueue multiple simultaneous sends in the
      // same tick and observe collision behavior.
      const s = simRef.current.getState();
      setState({ ...s, running, speed });
    },
    [running, speed],
  );

  const stepOnce = useCallback(() => {
    if (!simRef.current) return;
    const s = simRef.current.step();
    setState({ ...s, running, speed });
  }, [running, speed]);

  const reset = useCallback(() => {
    if (!simRef.current) return;
    simRef.current.reset(sensorNodes);
    setRunning(false);
    setState(simRef.current.getState());
  }, [sensorNodes]);

  const refreshState = useCallback(() => {
    if (!simRef.current) return;
    const s = simRef.current.getState();
    setState({ ...s, running, speed });
  }, [running, speed]);

  // Step once on mount to get initial state
  useEffect(() => {
    if (simRef.current && !state) {
      setState(simRef.current.getState());
    }
  }, [state]);

  useEffect(() => {
    if (!simRef.current) return;
    simRef.current.reset(sensorNodes);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunning(false);
    setState(simRef.current.getState());
  }, [sensorNodes]);

  return {
    state,
    running,
    speed,
    play,
    pause,
    toggleSpeed,
    stepOnce,
    sendMessage,
    reset,
    refreshState,
    simRef, // Expose simRef for advanced access
  };
}
