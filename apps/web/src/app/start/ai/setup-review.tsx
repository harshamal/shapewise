"use client";

import { useMemo, useState } from "react";
import { cx } from "@shapewise/ui";
import type { ArcFlow, FlowGraph, ModuleSummary } from "@/lib/blueprint-summary";

/* ----------------------------------------------------------- modules */

/**
 * One card per module. Expanding shows every screen with its fields
 * (extra details marked), and a switch to leave out screens the business
 * doesn't need. Changes apply to the setup straight away.
 */
export function ModuleCards({
  modules,
  onToggleScreen,
  onToggleModule,
  onToggleApproval,
  busy,
}: {
  modules: ModuleSummary[];
  onToggleScreen: (key: string, on: boolean) => void;
  onToggleModule: (key: string, on: boolean) => void;
  onToggleApproval: (record: string, action: string, label: string, on: boolean) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [showOff, setShowOff] = useState(false);
  const on = modules.filter((m) => m.on);
  const off = modules.filter((m) => !m.on);
  return (
    <div className="space-y-3">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {on.map((m, i) => {
          const screens = m.screens.filter((s) => s.on);
          const expanded = open === m.key;
          return (
            <li key={m.key} className={cx("rounded-2xl border bg-surface transition-[box-shadow,border-color] duration-200 animate-rise", expanded ? "border-border-strong shadow-overlay sm:col-span-2 xl:col-span-3" : "hover:border-border-strong")} style={{ animationDelay: `${i * 35}ms` }}>
              <button type="button" onClick={() => setOpen(expanded ? null : m.key)} aria-expanded={expanded} className="flex w-full items-start gap-3 px-4 py-3.5 text-left">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-medium">
                    {m.label}
                    <span className="tabular rounded-full bg-surface-sunken px-1.5 text-[11px] font-normal text-ink-muted">{screens.length}</span>
                  </span>
                  {!expanded && <span className="mt-1 block text-sm leading-relaxed text-ink-muted">{screens.map((s) => s.label).join(" · ")}</span>}
                </span>
                <svg viewBox="0 0 16 16" className={cx("mt-1 size-4 shrink-0 text-ink-faint transition-transform duration-200", expanded && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </button>
              {expanded && (
                <div className="border-t px-4 pt-3 pb-4 animate-fade">
                  <ul className="grid gap-2 lg:grid-cols-2">
                    {m.screens.map((s) => (
                      <Screen key={s.key} screen={s} busy={busy} onToggle={(v) => onToggleScreen(s.key, v)} onApproval={(v) => s.approval && onToggleApproval(s.approval.record, s.approval.action, s.label, v)} />
                    ))}
                  </ul>
                  <div className="mt-3 flex justify-end">
                    <button type="button" disabled={busy} onClick={() => onToggleModule(m.key, false)} className="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-sunken hover:text-danger-fg disabled:opacity-50">
                      Leave out {m.label}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {off.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowOff((v) => !v)} className="text-xs text-ink-faint transition-colors hover:text-ink">
            {showOff ? "Hide" : "Show"} modules you're not using ({off.length})
          </button>
          {showOff && (
            <div className="mt-2 flex flex-wrap gap-1.5 animate-fade">
              {off.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  disabled={busy}
                  onClick={() => onToggleModule(m.key, true)}
                  className="rounded-full border border-dashed border-border-strong px-3 py-1 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50"
                >
                  + {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Screen({ screen: s, busy, onToggle, onApproval }: { screen: ModuleSummary["screens"][number]; busy: boolean; onToggle: (on: boolean) => void; onApproval: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const header = s.fields.filter((f) => !f.line);
  const lines = s.fields.filter((f) => f.line);
  return (
    <li className={cx("rounded-xl border bg-canvas transition-opacity", !s.on && "opacity-55")}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen((v) => !v)} disabled={!s.fields.length} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm disabled:cursor-default">
          {s.fields.length > 0 && (
            <svg viewBox="0 0 16 16" className={cx("size-3 shrink-0 text-ink-faint transition-transform duration-200", open && "rotate-90")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="m6 4 4 4-4 4" />
            </svg>
          )}
          <span className={cx("truncate", !s.fields.length && "pl-5")}>{s.label}</span>
          {s.fields.length > 0 && <span className="tabular text-[11px] text-ink-faint">{s.fields.length} fields</span>}
          {s.fields.some((f) => f.custom) && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] text-ink">yours</span>}
        </button>
        {s.canHide ? (
          <Toggle label={`Use ${s.label}`} checked={s.on} disabled={busy} onChange={onToggle} />
        ) : (
          <span className="text-[10px] text-ink-faint" title="Part of the module">
            Included
          </span>
        )}
      </div>
      {s.approval && s.on && (
        <div className="flex items-center gap-2 border-t border-dashed px-3 py-1.5">
          <span className="flex-1 text-xs text-ink-muted">
            Approval before {s.approval.actionLabel.toLowerCase()}
            {s.approval.on && <span className="text-ink-faint">. Set amounts and who signs in Settings, Approval rules</span>}
          </span>
          <Toggle label={`Needs approval before ${s.approval.actionLabel.toLowerCase()} on ${s.label}`} checked={s.approval.on} disabled={busy} onChange={onApproval} />
        </div>
      )}
      {open && (
        <div className="space-y-2 border-t px-3 py-2.5 animate-fade">
          <FieldList fields={header} />
          {lines.length > 0 && (
            <>
              <p className="pt-1 text-[10px] tracking-[0.08em] text-ink-faint uppercase">On each line</p>
              <FieldList fields={lines} />
            </>
          )}
        </div>
      )}
    </li>
  );
}

function FieldList({ fields }: { fields: { label: string; type: string; custom?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {fields.map((f, i) => (
        <li key={`${f.label}${i}`} title={f.type} className={cx("rounded-md px-1.5 py-0.5 text-xs", f.custom ? "bg-accent-soft text-ink" : "bg-surface-sunken text-ink-muted")}>
          {f.label}
        </li>
      ))}
    </ul>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50", checked ? "bg-accent" : "bg-border-strong")}
    >
      <span className={cx("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-200", checked && "translate-x-4")} />
    </button>
  );
}

/* -------------------------------------------------------------- flow */

type View = "documents" | "stock" | "money";

const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: "documents", label: "Documents", hint: "How each document leads to the next, a lane per module." },
  { key: "stock", label: "Stock", hint: "Where goods come from, which stores they pass through, and the documents that move them." },
  { key: "money", label: "Money", hint: "How value moves between your accounts, and the documents that move it." },
];

/**
 * How the setup hangs together, in three clean views drawn from the live
 * blueprint (they change as screens are switched on and off), plus every
 * posting in a table for the accountant.
 */
export function FlowMap({ graph }: { graph: FlowGraph }) {
  const [view, setView] = useState<View>("documents");
  const hint = VIEWS.find((v) => v.key === view)!.hint;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-full border bg-surface p-0.5" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={cx("h-8 rounded-full px-3.5 text-[13px] transition-colors", view === v.key ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink")}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">{hint}</p>
      </div>
      <div key={view} className="animate-fade">
        {view === "documents" && <DocumentMap graph={graph} />}
        {view === "stock" && <ArcDiagram flow={graph.stock} tone="stock" empty="Nothing in this setup moves stock." withinLabel="Within" />}
        {view === "money" && <ArcDiagram flow={graph.money} tone="money" empty="Nothing in this setup posts to the accounts yet." withinLabel="Between its own accounts" />}
      </div>
      <Effects effects={graph.effects} />
    </div>
  );
}

/* ----------------------------------------------------- documents view */

const COL = 196;
const ROW = 76;
const W = 160;
const H = 50;
const PAD = 14;
const LANE = 104;

function DocumentMap({ graph }: { graph: FlowGraph }) {
  const [hover, setHover] = useState<string | null>(null);
  const pos = useMemo(() => new Map(graph.nodes.map((n) => [n.id, { x: LANE + PAD + n.layer * COL, y: PAD + n.row * ROW }])), [graph]);
  const related = useMemo(() => {
    if (!hover) return null;
    const set = new Set([hover]);
    for (const dir of ["down", "up"] as const)
      for (let grew = true; grew; ) {
        grew = false;
        for (const e of graph.edges) {
          const [a, b] = dir === "down" ? [e.from, e.to] : [e.to, e.from];
          if (set.has(a) && !set.has(b)) (set.add(b), (grew = true));
        }
      }
    return set;
  }, [hover, graph.edges]);

  if (!graph.nodes.length) return <p className="text-sm text-ink-muted">Switch on a module to see how its documents connect.</p>;
  const width = LANE + PAD * 2 + (graph.layers - 1) * COL + W;
  const height = PAD * 2 + (graph.rows - 1) * ROW + H;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-2xl border bg-surface">
        <div className="relative" style={{ width, height, minWidth: "100%" }}>
          {graph.lanes.map((l, i) => (
            <div
              key={l.module}
              className={cx("absolute inset-x-0 border-b border-dashed last:border-0", i % 2 === 1 && "bg-surface-sunken/40")}
              style={{ top: Math.max(0, PAD + l.start * ROW - (ROW - H) / 2), height: l.size * ROW }}
            >
              <span className="block px-4 pt-4 text-[11px] tracking-[0.06em] text-ink-faint uppercase" style={{ width: LANE }}>
                {l.label}
              </span>
            </div>
          ))}
          <svg width={width} height={height} className="absolute inset-0" aria-hidden="true">
            <defs>
              <marker id="sw-doc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 8 4 0 8z" fill="var(--sw-ink-faint)" />
              </marker>
              <marker id="sw-doc-arrow-on" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 8 4 0 8z" fill="var(--sw-accent)" />
              </marker>
            </defs>
            {graph.edges.map((e) => {
              const a = pos.get(e.from)!;
              const b = pos.get(e.to)!;
              const x1 = a.x + W;
              const y1 = a.y + H / 2;
              const x2 = b.x - 4;
              const y2 = b.y + H / 2;
              const mid = (x1 + x2) / 2;
              const lit = related ? related.has(e.from) && related.has(e.to) : false;
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  d={`M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={lit ? "var(--sw-accent)" : "var(--sw-border-strong)"}
                  strokeWidth={lit ? 1.8 : 1.3}
                  strokeDasharray={e.kind === "link" ? "4 4" : undefined}
                  markerEnd={`url(#${lit ? "sw-doc-arrow-on" : "sw-doc-arrow"})`}
                  className={cx("transition-[stroke,opacity] duration-200", lit && "flow-dash")}
                  opacity={related && !lit ? 0.2 : 1}
                >
                  <title>{e.label}</title>
                </path>
              );
            })}
          </svg>
          {graph.nodes.map((n) => {
            const p = pos.get(n.id)!;
            return (
              <div
                key={n.id}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                className={cx(
                  "absolute flex flex-col justify-center rounded-xl border bg-canvas px-3 transition-[opacity,border-color] duration-200",
                  hover === n.id ? "border-accent" : "border-border",
                  related && !related.has(n.id) && "opacity-30",
                )}
                style={{ left: p.x, top: p.y, width: W, height: H }}
              >
                <span className="truncate text-[13px] leading-tight text-ink">{n.label}</span>
                <span className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-ink-faint">
                  {n.moduleLabel}
                  {n.effects.includes("stock") && <Dot label="Moves stock" tone="stock" />}
                  {n.effects.includes("ledger") && <Dot label="Posts to accounts" tone="money" />}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-muted">
        <Legend dash={false} color="var(--sw-ink-faint)">Becomes the next document</Legend>
        <Legend dash color="var(--sw-ink-faint)">Refers back to it</Legend>
        <span className="flex items-center gap-1.5">
          <Dot label="Moves stock" tone="stock" /> Moves stock
        </span>
        <span className="flex items-center gap-1.5">
          <Dot label="Posts to accounts" tone="money" /> Posts to the accounts
        </span>
        <span className="text-ink-faint">Hover a document to trace its path.</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------- stock and money views */

const GAP = 200;
const NODE_W = 168;
const NODE_H = 44;
const LEVEL = 40;
const SIDE = 24;

/**
 * Places in a row (stores, or account groups), with an arc for each way
 * stock or value moves between two of them, labelled with the documents
 * that move it. Forward moves arc above, backward ones below. Arcs are
 * packed into levels so their labels never sit on top of each other.
 */
function ArcDiagram({ flow, tone, empty, withinLabel }: { flow: ArcFlow; tone: "stock" | "money"; empty: string; withinLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const color = tone === "stock" ? "var(--sw-warning-fg)" : "var(--sw-accent)";
  const index = new Map(flow.nodes.map((n, i) => [n.id, i]));
  const placed = useMemo(() => {
    const levels = { up: [] as [number, number][][], down: [] as [number, number][][] };
    return flow.arcs
      .filter((a) => index.has(a.from) && index.has(a.to))
      .map((a) => ({ ...a, i: index.get(a.from)!, j: index.get(a.to)! }))
      .sort((a, b) => Math.abs(a.j - a.i) - Math.abs(b.j - b.i))
      .map((a) => {
        const side = a.j > a.i ? "up" : "down";
        const span: [number, number] = [Math.min(a.i, a.j), Math.max(a.i, a.j)];
        let level = 0;
        while ((levels[side][level] ?? []).some(([s, e]) => s < span[1] && span[0] < e)) level++;
        (levels[side][level] ??= []).push(span);
        return { ...a, side, level };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  if (!flow.nodes.length) return <p className="rounded-2xl border bg-surface px-4 py-8 text-center text-sm text-ink-muted">{empty}</p>;
  const up = Math.max(0, ...placed.filter((a) => a.side === "up").map((a) => a.level + 1));
  const down = Math.max(0, ...placed.filter((a) => a.side === "down").map((a) => a.level + 1));
  const top = SIDE + up * LEVEL + 10;
  const width = SIDE * 2 + (flow.nodes.length - 1) * GAP + NODE_W;
  const height = top + NODE_H + down * LEVEL + SIDE + 10;
  const cx0 = (i: number) => SIDE + i * GAP + NODE_W / 2;
  const lit = (a: { from: string; to: string }) => hover === a.from || hover === a.to || hover === `${a.from}>${a.to}`;

  return (
    <div className="overflow-x-auto rounded-2xl border bg-surface">
      <div className="relative" style={{ width, height, minWidth: "100%" }}>
        <svg width={width} height={height} className="absolute inset-0" aria-hidden="true">
          <defs>
            <marker id={`sw-arc-${tone}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 8 4 0 8z" fill={color} />
            </marker>
          </defs>
          {placed.map((a) => {
            const x1 = cx0(a.i) + (a.j > a.i ? 14 : -14);
            const x2 = cx0(a.j) + (a.j > a.i ? -14 : 14);
            const h = (a.level + 1) * LEVEL + 8;
            const y = a.side === "up" ? top : top + NODE_H;
            const ctrl = a.side === "up" ? y - h * 1.33 : y + h * 1.33;
            const on = hover ? lit(a) : false;
            return (
              <path
                key={`${a.from}>${a.to}`}
                d={`M${x1} ${y} C${x1} ${ctrl}, ${x2} ${ctrl}, ${x2} ${y + (a.side === "up" ? -3 : 3)}`}
                fill="none"
                stroke={color}
                strokeWidth={on ? 2 : 1.4}
                opacity={hover && !on ? 0.15 : on ? 1 : 0.6}
                markerEnd={`url(#sw-arc-${tone})`}
                className={cx("transition-[opacity,stroke-width] duration-200", on && "flow-dash")}
              />
            );
          })}
        </svg>
        {placed.map((a) => {
          const mid = (cx0(a.i) + cx0(a.j)) / 2;
          const h = (a.level + 1) * LEVEL + 8;
          const y = a.side === "up" ? top - h : top + NODE_H + h;
          const maxW = Math.max(90, Math.abs(cx0(a.j) - cx0(a.i)) - 28);
          const on = hover ? lit(a) : false;
          return (
            <span
              key={`label-${a.from}>${a.to}`}
              onMouseEnter={() => setHover(`${a.from}>${a.to}`)}
              onMouseLeave={() => setHover(null)}
              title={a.documents.join(", ")}
              className={cx(
                "absolute -translate-x-1/2 -translate-y-1/2 truncate rounded-full border bg-surface px-2 py-0.5 text-[11px] transition-opacity duration-200",
                on ? "border-current text-ink" : "border-border text-ink-muted",
                hover && !on && "opacity-30",
              )}
              style={{ left: mid, top: y, maxWidth: maxW, color: on ? color : undefined }}
            >
              <span className="text-ink">{a.documents.join(", ")}</span>
            </span>
          );
        })}
        {flow.nodes.map((n, i) => {
          const inside = flow.within.find((w) => w.node === n.id);
          return (
            <div key={n.id} className="absolute" style={{ left: cx0(i) - NODE_W / 2, top }}>
              <div
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                className={cx(
                  "flex items-center gap-2 border px-3 transition-[border-color,opacity] duration-200",
                  n.outside ? "rounded-xl border-dashed bg-canvas" : "rounded-full bg-canvas",
                  hover === n.id ? "border-current" : "border-border-strong",
                  hover && hover !== n.id && !placed.some((a) => lit(a) && (a.from === n.id || a.to === n.id)) && "opacity-40",
                )}
                style={{ width: NODE_W, height: NODE_H, color: hover === n.id ? color : undefined }}
              >
                {!n.outside && <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />}
                <span className={cx("min-w-0 flex-1 truncate text-[13px] leading-tight", n.outside ? "text-ink-muted" : "text-ink")}>{n.label}</span>
                {inside && (
                  // Documents that act within this place (a stock count, a transfer, a journal) as a small loop badge, listed on hover.
                  <span title={`${withinLabel}: ${inside.documents.join(", ")}`} className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface-sunken px-1.5 text-[10px] text-ink-muted">
                    <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
                      <path d="M9.5 4.5A4 4 0 1 0 10 7M9.5 1.5v3h-3" />
                    </svg>
                    {inside.documents.length}
                  </span>
                )}
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ dash, color, children }: { dash: boolean; color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="22" height="6" aria-hidden="true">
        <path d="M0 3h22" stroke={color} strokeWidth="1.5" strokeDasharray={dash ? "4 3" : undefined} />
      </svg>
      {children}
    </span>
  );
}

function Dot({ label, tone }: { label: string; tone: "stock" | "money" }) {
  return <span title={label} aria-label={label} className={cx("inline-block size-1.5 shrink-0 rounded-full", tone === "stock" ? "bg-warning-fg" : "bg-accent")} />;
}

/** Every document action that moves stock or money, in words and in debits and credits. */
function Effects({ effects }: { effects: FlowGraph["effects"] }) {
  const [open, setOpen] = useState(false);
  if (!effects.length) return null;
  return (
    <div className="rounded-2xl border bg-surface">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm">
        <span>
          <span className="font-medium">Every posting</span>
          <span className="ml-2 text-ink-muted">What each document does to stock and the accounts, for your accountant to check</span>
        </span>
        <svg viewBox="0 0 16 16" className={cx("size-4 shrink-0 text-ink-faint transition-transform duration-200", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="overflow-x-auto border-t animate-fade">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b text-xs text-ink-muted">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Stock</th>
                <th className="px-4 py-2 font-medium">Debit</th>
                <th className="px-4 py-2 font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {effects.map((e, i) => (
                <tr key={i} className="border-b align-top last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{e.document}</span> <span className="text-ink-muted">· {e.action.toLowerCase()}</span>
                    <span className="mt-0.5 block text-xs text-ink-faint">{e.says}</span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{e.stock.join("; ") || "None"}</td>
                  <td className="px-4 py-2.5">{e.debits.join(", ") || (/journal/i.test(e.document) ? "Any" : "None")}</td>
                  <td className="px-4 py-2.5">{e.credits.join(", ") || (/journal/i.test(e.document) ? "Any" : "None")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- reports */

export interface ChosenReport {
  key: string;
  label: string;
  asks: string;
  category: string;
  categoryLabel: string;
  places: string[];
  hasMetric: boolean;
  /** Reads the ledger or stock, so its numbers start once those engines run. */
  waitsForEngine: boolean;
}

const PLACE_CHIPS: { place: string; label: string; needsMetric?: boolean }[] = [
  { place: "dashboard", label: "Dashboard", needsMetric: true },
  { place: "module", label: "Module page" },
  { place: "email_daily", label: "Morning email" },
  { place: "email_weekly", label: "Weekly email" },
];

/**
 * The reports in use, grouped by what they're about, each with where it
 * shows (dashboard tile, its module's page, an email); and the others this
 * setup can run, to add with a tap.
 */
export function ReportPicker({
  chosen,
  available,
  onPlaces,
  onAdd,
  onRemove,
}: {
  chosen: ChosenReport[];
  available: { key: string; label: string; asks: string; categoryLabel: string }[];
  onPlaces: (key: string, places: string[]) => void;
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const [more, setMore] = useState(false);
  const groups = [...new Set(chosen.map((c) => c.categoryLabel))];
  return (
    <div className="space-y-4">
      {chosen.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-ink-muted">No reports pinned yet. Add the ones you want to keep an eye on below.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map((g) => (
            <section key={g} className="rounded-2xl border bg-surface">
              <h3 className="border-b px-4 py-2.5 text-[11px] tracking-[0.08em] text-ink-faint uppercase">{g}</h3>
              <ul className="divide-y">
                {chosen
                  .filter((c) => c.categoryLabel === g)
                  .map((c) => (
                    <li key={c.key} className="group px-4 py-2.5">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{c.label}</p>
                          <p className="text-xs text-ink-muted">{c.asks}</p>
                        </div>
                        <button type="button" onClick={() => onRemove(c.key)} className="text-[11px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger-fg focus:opacity-100">
                          Remove
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {PLACE_CHIPS.filter((x) => !x.needsMetric || c.hasMetric).map((x) => {
                          const on = c.places.includes(x.place);
                          return (
                            <button
                              key={x.place}
                              type="button"
                              aria-pressed={on}
                              onClick={() => onPlaces(c.key, on ? c.places.filter((y) => y !== x.place) : [...c.places, x.place])}
                              className={cx("h-6 rounded-full border px-2 text-[11px] transition-colors", on ? "border-accent bg-accent-soft text-ink" : "border-border-strong text-ink-faint hover:text-ink")}
                            >
                              {x.label}
                            </button>
                          );
                        })}
                        {c.waitsForEngine && <span className="self-center text-[10px] text-ink-faint">Numbers start with the accounting and stock engines</span>}
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div>
          <button type="button" onClick={() => setMore((v) => !v)} className="text-xs text-ink-muted transition-colors hover:text-ink">
            {more ? "Hide" : "Show"} other reports this setup can run ({available.length})
          </button>
          {more && (
            <div className="mt-2 flex flex-wrap gap-1.5 animate-fade">
              {available.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => onAdd(r.key)}
                  title={r.asks}
                  className="rounded-full border border-dashed border-border-strong px-3 py-1 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
                >
                  + {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
