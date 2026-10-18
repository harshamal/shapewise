"use client";

import { useState } from "react";

type ViewMode = "floor" | "assistant" | "setup";

export function LandingSystemPreview() {
  const [activeTab, setActiveTab] = useState<ViewMode>("floor");

  return (
    <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-[0_24px_60px_-15px_rgba(28,26,23,0.07)]">
      {/* Top Bar with Workspace Title & Tab Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-surface-sunken/40 px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="text-xs font-medium tracking-tight text-ink">
            Ceylon Moulds (Pvt) Ltd
          </span>
          <span className="text-[11px] text-ink-muted">·</span>
          <span className="rounded-sw-sm bg-surface px-1.5 py-0.5 text-[11px] font-mono text-ink-muted border border-border/60">
            /w/ceylon-moulds
          </span>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 rounded-sw-sm border border-border/80 bg-surface p-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("floor")}
            className={`rounded-sw-sm px-3 py-1 font-medium transition-colors ${
              activeTab === "floor"
                ? "bg-accent text-accent-ink"
                : "text-ink-muted hover:text-ink hover:bg-surface-sunken"
            }`}
          >
            Floor Operations
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("assistant")}
            className={`rounded-sw-sm px-3 py-1 font-medium transition-colors ${
              activeTab === "assistant"
                ? "bg-accent text-accent-ink"
                : "text-ink-muted hover:text-ink hover:bg-surface-sunken"
            }`}
          >
            AI Assistant
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("setup")}
            className={`rounded-sw-sm px-3 py-1 font-medium transition-colors ${
              activeTab === "setup"
                ? "bg-accent text-accent-ink"
                : "text-ink-muted hover:text-ink hover:bg-surface-sunken"
            }`}
          >
            Setup & Blueprint
          </button>
        </div>
      </div>

      {/* Main Workspace Preview Content */}
      <div className="p-5 sm:p-7">
        {activeTab === "floor" && (
          <div className="space-y-6">
            {/* KPI Metric Strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-sw border border-border/70 bg-canvas/70 p-3.5">
                <p className="text-[11px] font-mono text-ink-muted uppercase">Production Jobs</p>
                <p className="mt-1 text-lg font-medium text-ink">8 Active</p>
                <p className="text-[11px] text-accent mt-0.5 font-medium">98.4% Yield</p>
              </div>
              <div className="rounded-sw border border-border/70 bg-canvas/70 p-3.5">
                <p className="text-[11px] font-mono text-ink-muted uppercase">Scrap Rate</p>
                <p className="mt-1 text-lg font-medium text-ink">1.1%</p>
                <p className="text-[11px] text-ink-muted mt-0.5">Target &lt; 2.0%</p>
              </div>
              <div className="rounded-sw border border-border/70 bg-canvas/70 p-3.5">
                <p className="text-[11px] font-mono text-ink-muted uppercase">Stock Value</p>
                <p className="mt-1 text-lg font-medium text-ink">LKR 14.8M</p>
                <p className="text-[11px] text-ink-muted mt-0.5">4 Warehouses</p>
              </div>
              <div className="rounded-sw border border-border/70 bg-canvas/70 p-3.5">
                <p className="text-[11px] font-mono text-ink-muted uppercase">Approvals</p>
                <p className="mt-1 text-lg font-medium text-ink">2 Pending</p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">GRN Inspection hold</p>
              </div>
            </div>

            {/* Live Job Card */}
            <div className="rounded-sw border border-border/80 bg-surface p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium text-accent">JOB-1042</span>
                    <span className="text-xs text-ink-muted">·</span>
                    <h4 className="text-sm font-medium text-ink">500ml Polypropylene Food Tub Base</h4>
                  </div>
                  <p className="text-xs text-ink-muted">
                    Machine #04 (Toshiba 180T) · 4-Cavity Mould · Lot #LOT-2026-PP08
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Running (84%)
                </span>
              </div>

              {/* Progress and Floor Telemetry */}
              <div className="grid gap-4 sm:grid-cols-3 text-xs">
                <div className="space-y-1">
                  <span className="text-ink-muted">Target Output:</span>
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-medium text-ink">4,200 / 5,000 pcs</span>
                    <span className="text-ink-muted">800 remaining</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                    <div className="h-full bg-accent rounded-full" style={{ width: "84%" }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-ink-muted">Cycle Time & Scrap:</span>
                  <p className="font-mono text-ink">
                    <span className="font-medium">14.2s</span> cycle · <span className="text-emerald-600 dark:text-emerald-400 font-medium">0.8% scrap</span>
                  </p>
                  <p className="text-[11px] text-ink-muted">Optimum thermal stabilization</p>
                </div>

                <div className="space-y-1">
                  <span className="text-ink-muted">Quality Control Gate:</span>
                  <p className="text-ink font-medium">Melt Flow Index: 12.4 g/10min</p>
                  <p className="text-[11px] text-ink-muted font-mono">QC Lead: Signed off (N. Perera)</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "assistant" && (
          <div className="space-y-4">
            <div className="rounded-sw border border-border/80 bg-canvas/60 p-4 space-y-3.5">
              {/* User turn */}
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink/10 text-[10px] font-medium text-ink">
                  You
                </span>
                <p className="text-xs text-ink leading-relaxed">
                  Which production batches had scrap above 1.5% this week, and what caused it?
                </p>
              </div>

              {/* Assistant turn */}
              <div className="flex items-start gap-2.5 border-t border-border/50 pt-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-accent-ink">
                  AI
                </span>
                <div className="space-y-2 text-xs leading-relaxed text-ink">
                  <p>
                    I analyzed 14 production runs from October 12–18. Only <span className="font-medium">1 job</span> exceeded the 1.5% threshold:
                  </p>
                  <div className="rounded-sw-sm border border-border/70 bg-surface p-2.5 font-mono text-[11px] space-y-1">
                    <p className="text-ink font-medium">Job #1038 · Ceylon Moulds · 2.4% Scrap</p>
                    <p className="text-ink-muted">Cause: Machine #02 heater band temperature drift during morning shift.</p>
                  </div>
                  <p className="text-ink-muted">
                    The remaining 13 jobs averaged <span className="font-medium text-ink">0.9% scrap</span>. Would you like me to log a maintenance ticket for Machine #02?
                  </p>

                  <div className="pt-1">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-sw-sm bg-accent px-3 py-1 text-xs font-medium text-accent-ink hover:bg-accent-hover transition-colors"
                    >
                      <span>Create Maintenance Order & Notify Supervisor</span>
                      <span>→</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "setup" && (
          <div className="space-y-4 text-xs">
            <div className="rounded-sw border border-border/80 bg-canvas/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-ink-muted uppercase tracking-wider text-[11px]">
                  How Shapewise configures your factory
                </span>
                <span className="font-mono text-accent">plastics@2 · 5 min setup</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-sw border border-border/70 bg-surface p-3 space-y-1">
                  <p className="font-medium text-ink font-sans">1. Warehouses & Lots</p>
                  <p className="text-ink-muted text-[11px]">
                    Raw Materials (Resins), WIP (Moulded Preforms), Packaging, Finished Goods.
                  </p>
                </div>
                <div className="rounded-sw border border-border/70 bg-surface p-3 space-y-1">
                  <p className="font-medium text-ink font-sans">2. Approval Policies</p>
                  <p className="text-ink-muted text-[11px]">
                    Automatic hold on raw material GRN until lab QC passes; scrap &gt; 2% needs Plant Manager sign-off.
                  </p>
                </div>
                <div className="rounded-sw border border-border/70 bg-surface p-3 space-y-1">
                  <p className="font-medium text-ink font-sans">3. Shop Floor Languages</p>
                  <p className="text-ink-muted text-[11px]">
                    Operators interact in English, Sinhala (සිංහල), or Tamil (தமிழ்) with seamless synchronisation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
