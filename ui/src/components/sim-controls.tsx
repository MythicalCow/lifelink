"use client";

import type { SimState } from "@/simulation/types";

interface SimControlsProps {
  state: SimState | null;
  running: boolean;
  speed: number;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onToggleSpeed: () => void;
  onReset: () => void;
}

export function SimControls({
  state,
  running,
  speed,
  onPlay,
  onPause,
  onStep,
  onToggleSpeed,
  onReset,
}: SimControlsProps) {
  const stats = state?.stats;
  const events = state?.events ?? [];

  return (
    <div className="absolute bottom-12 left-4 z-[1000] flex max-h-[60vh] w-80 flex-col gap-3 rounded-xl bg-[var(--background)]/85 p-4 shadow-lg backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-[var(--foreground)]/70 uppercase">
          Mesh Simulation
        </span>
        <span className="text-[10px] tabular-nums text-[var(--muted)]">
          tick {state?.tick ?? 0}
        </span>
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={running ? onPause : onPlay}
          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          {running ? "⏸ Pause" : "▶ Play"}
        </button>
        <button
          onClick={onStep}
          className="flex h-8 w-14 items-center justify-center rounded-lg bg-[var(--foreground)]/5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--foreground)]/10"
        >
          Step
        </button>
        <button
          onClick={onToggleSpeed}
          className="flex h-8 w-14 items-center justify-center rounded-lg bg-[var(--foreground)]/5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--foreground)]/10"
        >
          {speed}×
        </button>
        <button
          onClick={onReset}
          className="flex h-8 w-16 items-center justify-center rounded-lg bg-[var(--foreground)]/5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--foreground)]/10"
        >
          Reset
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-2 rounded-lg bg-[var(--foreground)]/[0.03] px-3 py-2">
          <Stat label="Sent" value={stats.totalSent} />
          <Stat label="Delivered" value={stats.totalDelivered} />
          <Stat label="Dropped" value={stats.totalDropped} />
          <Stat label="Collisions" value={stats.totalCollisions} />
          <Stat label="Avg hops" value={stats.avgHops.toFixed(1)} />
        </div>
      )}

      {/* Event log */}
      <div className="flex max-h-36 flex-col gap-0.5 overflow-y-auto scrollbar-none">
        {events
          .slice()
          .reverse()
          .slice(0, 15)
          .map((ev, i) => (
            <div
              key={`${ev.tick}-${i}`}
              className={`text-[10px] leading-relaxed ${
                ev.level === "success"
                  ? "text-[var(--accent)]"
                  : ev.level === "warn"
                    ? "text-[var(--suggest)]"
                    : "text-[var(--muted)]"
              }`}
            >
              <span className="inline-block w-8 tabular-nums opacity-50">
                {ev.tick}
              </span>
              {ev.message}
            </div>
          ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-sm font-semibold tabular-nums text-[var(--foreground)]">
        {value}
      </span>
      <span className="text-[9px] text-[var(--muted)]">{label}</span>
    </div>
  );
}
