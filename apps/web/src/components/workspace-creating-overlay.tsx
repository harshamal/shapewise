"use client";

import { useEffect, useState } from "react";

interface WorkspaceCreatingOverlayProps {
  name?: string;
  address?: string;
}

const PHRASES = [
  "Setting up your workspace…",
  "Preparing accounts and tax rules…",
  "Configuring permissions…",
  "Almost ready…",
];

export function WorkspaceCreatingOverlay({ name }: WorkspaceCreatingOverlayProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % PHRASES.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas/90 backdrop-blur-xl transition-opacity duration-300"
    >
      <div className="flex flex-col items-center text-center px-4">
        {/* Subtle, quiet brand mark with gentle pulse */}
        <div className="relative mb-5 flex size-10 items-center justify-center rounded-xl bg-accent text-white shadow-xs">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M17.5 5.5H8.75A3.25 3.25 0 0 0 8.75 12h6.5a3.25 3.25 0 0 1 0 6.5H6.5"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="6.5" cy="5.5" r="1.3" fill="currentColor" />
            <circle cx="17.5" cy="18.5" r="1.3" fill="currentColor" />
          </svg>
        </div>

        {/* Clean, calm headline */}
        <h2 className="text-lg font-medium tracking-tight text-ink sm:text-xl">
          {name ? `Setting up ${name}` : "Setting up your workspace"}
        </h2>

        {/* Quiet, shifting status phrase */}
        <p className="mt-1.5 h-5 text-xs text-ink-muted transition-all duration-300">
          {PHRASES[index]}
        </p>

        {/* Ultra-minimal hairline progress track */}
        <div className="mt-6 h-[2px] w-40 overflow-hidden rounded-full bg-border-strong/40">
          <div className="h-full w-1/3 rounded-full bg-accent animate-[sw-shimmer_1.8s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  );
}
