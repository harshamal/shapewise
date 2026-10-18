"use client";

import { useEffect, useState } from "react";

interface WorkspaceCreatingOverlayProps {
  name?: string;
  address?: string;
}

interface NodeStatus {
  id: string;
  title: string;
  category: string;
  status: "pending" | "running" | "done";
}

const NODES: Omit<NodeStatus, "status">[] = [
  { id: "db", title: "Tenant Database", category: "Core Partition" },
  { id: "gl", title: "General Ledger", category: "Tax & Currencies" },
  { id: "docs", title: "Document Engine", category: "Invoices & Orders" },
  { id: "sec", title: "Role Matrix", category: "Audit & Governance" },
];

export function WorkspaceCreatingOverlay({ name, address }: WorkspaceCreatingOverlayProps) {
  const [progress, setProgress] = useState(12);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => {
      setProgress(38);
      setActiveStep(1);
    }, 1400);

    const t2 = setTimeout(() => {
      setProgress(68);
      setActiveStep(2);
    }, 3200);

    const t3 = setTimeout(() => {
      setProgress(92);
      setActiveStep(3);
    }, 5200);

    const t4 = setTimeout(() => {
      setProgress(98);
    }, 7200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  const logs = [
    `[sys] allocating tenant partition "shapewise.web.app/w/${address || "workspace"}"`,
    activeStep >= 1 ? "[ledger] compiled double-entry chart of accounts & tax schedules" : null,
    activeStep >= 2 ? "[engine] mounted document workflows (invoices, receipts, inventory)" : null,
    activeStep >= 3 ? "[auth] applied permission matrix & synthesized role rules" : null,
  ].filter(Boolean) as string[];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas/95 backdrop-blur-2xl select-none transition-all duration-700"
    >
      {/* Precision architectural background grid */}
      <div 
        className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
        style={{
          backgroundImage: `
            linear-gradient(to right, currentColor 1px, transparent 1px),
            linear-gradient(to bottom, currentColor 1px, transparent 1px)
          `,
          backgroundSize: "32px 32px",
        }}
      />

      {/* Subtle radial ambient spotlight */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[600px] w-[600px] rounded-full bg-accent/6 blur-[140px]" />
      </div>

      <div className="relative mx-auto w-full max-w-xl px-6">
        {/* Top telemetry status line */}
        <div className="mb-6 flex items-center justify-between text-xs text-ink-faint">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-accent animate-ping" />
            <span className="font-mono uppercase tracking-wider text-[11px] font-medium text-ink-muted">
              Synthesizing Workspace
            </span>
          </div>
          <span className="font-mono tabular-nums text-xs font-semibold text-ink">
            {progress}%
          </span>
        </div>

        {/* Main architectural card */}
        <div className="relative overflow-hidden rounded-2xl border border-border-strong/70 bg-surface/95 p-7 shadow-2xl backdrop-blur-xl">
          {/* Hairline progress line on top edge */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-border-strong/40">
            <div
              className="h-full bg-accent transition-all duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Business Identifier Header */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-mono tracking-wider uppercase text-ink-faint">Workspace Target</p>
              <h1 className="mt-1 text-xl font-medium tracking-tight text-ink sm:text-2xl">
                {name || "Your New Workspace"}
              </h1>
              {address && (
                <p className="mt-1 font-mono text-xs text-ink-muted">
                  shapewise.web.app/w/<span className="text-ink font-medium">{address}</span>
                </p>
              )}
            </div>

            {/* Official Shapewise Mark */}
            <div className="relative flex size-11 items-center justify-center rounded-xl bg-accent shadow-xs shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-white">
                <path
                  d="M17.5 5.5H8.75A3.25 3.25 0 0 0 8.75 12h6.5a3.25 3.25 0 0 1 0 6.5H6.5"
                  stroke="currentColor"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="6.5" cy="5.5" r="1.4" fill="currentColor" />
                <circle cx="17.5" cy="18.5" r="1.4" fill="currentColor" />
              </svg>
            </div>
          </div>

          {/* Interactive 4-Node Blueprint Architecture Grid */}
          <div className="grid grid-cols-2 gap-2.5 my-6">
            {NODES.map((node, index) => {
              const isDone = activeStep > index;
              const isCurrent = activeStep === index;
              return (
                <div
                  key={node.id}
                  className={`relative flex flex-col justify-between rounded-xl border p-3.5 transition-all duration-500 ${
                    isDone
                      ? "border-accent/40 bg-accent-soft/30 text-ink"
                      : isCurrent
                      ? "border-accent bg-surface ring-1 ring-accent/30 shadow-xs"
                      : "border-border-strong/40 bg-surface-sunken/40 opacity-50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[10px] tracking-wider uppercase text-ink-faint">
                      {node.category}
                    </span>
                    {isDone ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-accent">
                        <svg className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </span>
                    ) : isCurrent ? (
                      <span className="flex size-2 rounded-full bg-accent animate-ping" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-border-strong" />
                    )}
                  </div>
                  <p className="text-xs font-medium text-ink">{node.title}</p>
                </div>
              );
            })}
          </div>

          {/* High-craft live telemetry log stream */}
          <div className="rounded-xl border border-border-strong/60 bg-surface-sunken/80 p-3 font-mono text-[11px] leading-relaxed">
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-border/40 text-[10px] text-ink-faint">
              <span>SYSTEM EVENT STREAM</span>
              <span className="text-accent">LIVE</span>
            </div>
            <div className="space-y-1 overflow-hidden">
              {logs.map((log, i) => (
                <div key={i} className="flex items-center gap-2 truncate animate-rise">
                  <span className="text-accent">›</span>
                  <span className={i === logs.length - 1 ? "text-ink font-medium" : "text-ink-muted"}>
                    {log}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-1 text-ink-faint">
                <span className="text-accent animate-pulse">›</span>
                <span className="inline-block h-3 w-1.5 bg-accent/70 animate-pulse" />
              </div>
            </div>
          </div>
        </div>

        {/* Quiet footer reassurance */}
        <p className="mt-4 text-center text-xs text-ink-faint">
          Setting up tailored security rules & data stores. You&apos;ll be directed into the workspace automatically.
        </p>
      </div>
    </div>
  );
}
