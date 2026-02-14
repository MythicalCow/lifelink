"use client";

export type ViewMode = "map" | "sensors" | "nodes" | "trust";

interface HeaderProps {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  nodeCount: number;
  anchorCount: number;
}

export function Header({
  view,
  onViewChange,
  nodeCount,
  anchorCount,
}: HeaderProps) {
  return (
    <header className="absolute inset-x-0 top-0 z-[1000] flex items-center justify-between px-8 py-5">
      {/* Logo */}
      <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
        LifeLink
      </h1>

      {/* Apple-style segmented toggle */}
      <div className="absolute left-1/2 -translate-x-1/2 flex h-8 items-center rounded-full bg-[var(--foreground)]/[0.06] p-0.5 backdrop-blur-sm">
        <button
          onClick={() => onViewChange("map")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
            view === "map"
              ? "bg-white text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]/60"
          }`}
        >
          Map
        </button>
        <button
          onClick={() => onViewChange("nodes")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
            view === "nodes"
              ? "bg-white text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]/60"
          }`}
        >
          Nodes
        </button>
        <button
          onClick={() => onViewChange("trust")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
            view === "trust"
              ? "bg-white text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]/60"
          }`}
        >
          Trust
        </button>
        <button
          onClick={() => onViewChange("sensors")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
            view === "sensors"
              ? "bg-white text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]/60"
          }`}
        >
          Setup
        </button>
      </div>

      {/* Status */}
      <nav className="flex items-center gap-5">
        <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          {nodeCount} nodes
        </span>
        <span className="flex items-center gap-2 text-xs text-[var(--muted)]/60">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
          {anchorCount} anchors
        </span>
      </nav>
    </header>
  );
}
