interface HeaderProps {
  nodeCount: number;
  suggestionCount: number;
}

export function Header({ nodeCount, suggestionCount }: HeaderProps) {
  return (
    <header className="absolute inset-x-0 top-0 z-[1000] flex items-center justify-between px-8 py-5">
      <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
        LifeLink
      </h1>

      <nav className="flex items-center gap-5">
        <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          {nodeCount} active
        </span>
        <span className="flex items-center gap-2 text-xs text-[var(--muted)]/60">
          <span className="inline-block h-1.5 w-1.5 rounded-full border border-dashed border-[var(--suggest)]" />
          {suggestionCount} suggested
        </span>
      </nav>
    </header>
  );
}
