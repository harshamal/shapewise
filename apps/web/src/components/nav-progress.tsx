"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * A thin bar at the top of the window that starts the moment someone clicks
 * a link to another page and finishes when that page is on screen, so a
 * click always gets an answer, however long the server takes.
 */
function ProgressBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [phase, setPhase] = useState<"idle" | "start" | "crawl" | "done">("idle");
  const timers = useRef<number[]>([]);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  // The new page arrived: finish the bar, then hide it.
  useEffect(() => {
    if (phase === "idle") return;
    clear();
    setPhase("done");
    timers.current.push(window.setTimeout(() => setPhase("idle"), 350));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      clear();
      setPhase("start");
      timers.current.push(window.setTimeout(() => setPhase("crawl"), 30));
      // Never hang around forever if a navigation is abandoned.
      timers.current.push(window.setTimeout(() => setPhase("idle"), 20_000));
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clear();
    };
  }, []);

  if (phase === "idle") return null;
  const width = phase === "start" ? "12%" : phase === "crawl" ? "82%" : "100%";
  const transition =
    phase === "crawl"
      ? "width 8s cubic-bezier(0.1, 0.6, 0.2, 1)"
      : phase === "done"
        ? "width 200ms ease-out, opacity 300ms ease 150ms"
        : "none";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5" aria-hidden="true">
      <div
        className="h-full bg-accent shadow-[0_0_8px_var(--sw-accent)]"
        style={{ width, transition, opacity: phase === "done" ? 0 : 1 }}
      />
    </div>
  );
}

export function NavProgress() {
  return (
    <Suspense fallback={null}>
      <ProgressBar />
    </Suspense>
  );
}

