/**
 * Shown the instant someone moves between workspace screens, while the
 * server prepares the page. Shaped like the real workspace (sidebar, top
 * bar, figures, table) so nothing jumps when the page arrives.
 */
export default function Loading() {
  return (
    <div className="flex min-h-dvh bg-canvas text-ink" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading workspace screen…</span>

      {/* Modern Minimal Sidebar Skeleton */}
      <aside
        className="hidden md:flex md:w-55 md:shrink-0 flex-col bg-rail text-rail-ink border-r border-white/5"
        aria-hidden="true"
      >
        {/* Sidebar Header */}
        <div className="flex h-14 shrink-0 items-center justify-between px-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="size-5 rounded-md bg-white/20 animate-pulse" />
            <div className="h-4 w-20 rounded bg-white/15 animate-pulse" />
          </div>
          <div className="size-6 rounded bg-white/10 animate-pulse" />
        </div>

        {/* Sidebar Navigation Groups */}
        <div className="flex-1 overflow-hidden p-3 space-y-5">
          {[
            { section: "Sales & Cash", items: 4 },
            { section: "Purchases", items: 4 },
            { section: "Inventory", items: 3 },
            { section: "Accounts", items: 3 },
          ].map((group, s) => (
            <div key={s} className="space-y-2">
              <div className="h-2.5 w-16 rounded bg-white/10" />
              <div className="space-y-1">
                {Array.from({ length: group.items }, (_, i) => (
                  <div
                    key={i}
                    className="flex h-7 items-center gap-2 rounded-md px-2.5 bg-white/[0.04]"
                  >
                    <div className="size-3.5 rounded bg-white/10" />
                    <div
                      className="h-3 rounded bg-white/10"
                      style={{ width: `${55 + ((i * 19 + s * 11) % 35)}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar Footer */}
        <div className="shrink-0 border-t border-white/5 p-3">
          <div className="flex items-center gap-2 h-7 px-2">
            <div className="size-3.5 rounded bg-white/10" />
            <div className="h-3 w-12 rounded bg-white/10" />
          </div>
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar Skeleton */}
        <header
          className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border-strong/40 bg-surface/85 px-4 backdrop-blur-md md:px-6"
          aria-hidden="true"
        >
          {/* Left: Sidebar Toggle + Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-8 rounded-sw border border-border-strong/60 bg-surface shadow-2xs" />
            <div className="h-4 w-px bg-border-strong/60 hidden sm:block" />
            <div className="flex items-center gap-1.5">
              <div className="h-4 w-20 rounded bg-surface-sunken animate-pulse" />
              <span className="text-ink-faint text-xs">/</span>
              <div className="h-4 w-28 rounded bg-surface-sunken animate-pulse" />
            </div>
          </div>

          {/* Center: AI Search Pill */}
          <div className="hidden lg:flex items-center justify-center flex-1 max-w-sm mx-4">
            <div className="h-8 w-full rounded-full bg-surface-sunken/80 border border-border-strong/60" />
          </div>

          {/* Right: Actions & User Menu */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-8 w-20 rounded-sw bg-surface-sunken/80 border border-border-strong/40 animate-pulse" />
            <div className="size-8 rounded-sw border border-border-strong/60 bg-surface" />
            <div className="size-8 rounded-full border border-border-strong/60 bg-surface-sunken" />
          </div>
        </header>

        {/* Main Workspace Canvas Skeleton */}
        <main id="main" className="flex-1 px-4 py-6 md:px-6 space-y-6" aria-hidden="true">
          {/* Page Heading & Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="h-6 w-44 rounded bg-surface-sunken animate-pulse" />
              <div className="h-3.5 w-64 rounded bg-surface-sunken/60 animate-pulse" />
            </div>
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-24 rounded-sw bg-surface-sunken/80 animate-pulse" />
              <div className="h-8 w-28 rounded-sw bg-accent/20 animate-pulse" />
            </div>
          </div>

          {/* Stat Cards Grid (Exact 4-column metric blocks) */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl bg-surface-sunken/70 p-5 shadow-xs space-y-2">
                <div className="h-3 w-20 rounded bg-surface animate-pulse" />
                <div className="h-6 w-28 rounded bg-surface animate-pulse" />
              </div>
            ))}
          </div>

          {/* Data Table Shell */}
          <div className="rounded-2xl border border-border-strong/30 bg-surface/85 shadow-xs overflow-hidden">
            {/* Table Search / Filter Bar */}
            <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-surface-sunken/30 px-5 py-3">
              <div className="h-7 w-48 rounded bg-surface-sunken animate-pulse" />
              <div className="flex items-center gap-2">
                <div className="h-7 w-20 rounded bg-surface-sunken animate-pulse" />
                <div className="h-7 w-16 rounded bg-surface-sunken animate-pulse" />
              </div>
            </div>

            {/* Table Header Row */}
            <div className="flex items-center gap-4 border-b border-border/40 bg-surface-sunken/50 px-5 py-2.5">
              <div className="h-3 w-24 rounded bg-surface-sunken" />
              <div className="h-3 w-40 rounded bg-surface-sunken" />
              <div className="h-3 flex-1 rounded bg-surface-sunken hidden sm:block" />
              <div className="h-3 w-24 rounded bg-surface-sunken ml-auto" />
            </div>

            {/* Realistic Data Rows */}
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-border/30 px-5 py-3.5 last:border-0"
              >
                <div className="h-3.5 w-24 rounded bg-surface-sunken/80 animate-pulse" />
                <div
                  className="h-3.5 rounded bg-surface-sunken/80 animate-pulse"
                  style={{ width: `${140 + ((i * 37) % 100)}px` }}
                />
                <div className="h-3.5 flex-1 rounded bg-surface-sunken/40 hidden sm:block" />
                <div className="h-3.5 w-20 rounded bg-surface-sunken/80 ml-auto animate-pulse" />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

