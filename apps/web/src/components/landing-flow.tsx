"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@shapewise/ui";

/**
 * "From a conversation to a running business": four steps that play
 * themselves in a small workspace window, using the demo bakery's real
 * figures. Steps advance on their own while the section is in view, pause
 * while the pointer is over the window, and can be picked by hand. With
 * reduced motion every scene shows complete and nothing advances.
 */

const STEP_MS = 7200;

const STEPS = [
  { key: "talk", label: "Talk", title: "Tell it how you work", body: "A short interview in plain words. Drop in price lists or stock sheets and it reads them, so it only asks what it still needs." },
  { key: "check", label: "Check", title: "See the setup first", body: "Before anything is created you see the plan: your screens, who can do what, and which documents need approval." },
  { key: "run", label: "Run", title: "Work, and the books keep themselves", body: "Quote, order, deliver, invoice, get paid. Each posted document moves stock and writes the double entry for you." },
  { key: "change", label: "Change", title: "Change it by asking", body: "Need a new field, register or rule? Describe it, see exactly what changes, approve it, and undo it later if you like." },
] as const;

export function LandingFlow() {
  const [step, setStep] = useState(0);
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [still, setStill] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const io = new IntersectionObserver(([e]) => setInView(Boolean(e?.isIntersecting)), { threshold: 0.35 });
    if (root.current) io.observe(root.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (still || !inView || paused) return;
    const id = setInterval(() => setT((x) => x + 100), 100);
    return () => clearInterval(id);
  }, [still, inView, paused]);

  useEffect(() => {
    if (t < STEP_MS) return;
    setStep((s) => (s + 1) % STEPS.length);
    setT(0);
  }, [t]);

  const pick = (i: number) => {
    setStep(i);
    setT(0);
  };
  // Scenes read "time since this step began"; reduced motion shows the finished scene.
  const at = still ? Number.POSITIVE_INFINITY : t;

  return (
    <div ref={root} className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
      <ol className="grid grid-cols-4 gap-1 lg:flex lg:flex-col" role="tablist" aria-label="How it works">
        {STEPS.map((s, i) => {
          const active = i === step;
          return (
            <li key={s.key} className="min-w-0">
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="flow-stage"
                onClick={() => pick(i)}
                className={cx(
                  "group relative w-full overflow-hidden rounded-xl text-left transition-colors",
                  "px-2 py-2 lg:px-5 lg:py-4",
                  active ? "bg-surface shadow-xs" : "hover:bg-surface/60",
                )}
              >
                <span className="flex items-center justify-center gap-3 lg:justify-start">
                  <span className={cx("hidden size-6 shrink-0 place-items-center rounded-full lg:grid font-mono text-[11px] transition-colors", active ? "bg-accent text-accent-ink" : i < step ? "bg-accent-soft text-accent" : "bg-surface-sunken text-ink-muted")}>{i + 1}</span>
                  <span className="whitespace-nowrap lg:whitespace-normal">
                    <span className={cx("block text-sm font-medium transition-colors", active ? "text-ink" : "text-ink-muted group-hover:text-ink")}>
                      <span className="lg:hidden">{s.label}</span>
                      <span className="hidden lg:inline">{s.title}</span>
                    </span>
                  </span>
                </span>
                <span className={cx("hidden overflow-hidden pl-9 text-sm leading-relaxed text-ink-muted transition-all duration-500 lg:grid", active ? "mt-1.5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                  <span className="min-h-0">{s.body}</span>
                </span>
                {active && !still && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-border" aria-hidden="true">
                    <span className="block h-full bg-accent transition-[width] duration-100 ease-linear" style={{ width: `${(t / STEP_MS) * 100}%` }} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <p className="-mt-2 text-sm leading-relaxed text-ink-muted lg:hidden">{STEPS[step]!.body}</p>

      <div
        id="flow-stage"
        role="tabpanel"
        aria-label={STEPS[step]!.title}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        className="overflow-hidden rounded-2xl border bg-surface shadow-[0_24px_60px_-20px_rgba(28,26,23,0.18)]"
      >
        <div className="flex items-center gap-2 border-b bg-surface-sunken/50 px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-border-strong" />
            <span className="size-2.5 rounded-full bg-border-strong" />
            <span className="size-2.5 rounded-full bg-border-strong" />
          </span>
          <span className="ml-2 text-xs text-ink-muted">Demo Bakery</span>
          <span className="ml-auto font-mono text-[11px] text-ink-faint">{STEPS[step]!.label.toLowerCase()}</span>
        </div>
        <div key={step} className="relative h-[22rem] p-5 sm:p-6">
          {step === 0 && <Talk at={at} />}
          {step === 1 && <Check at={at} />}
          {step === 2 && <Run at={at} />}
          {step === 3 && <Change at={at} />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/** Shown once the scene reaches `from` ms, rising in. */
function At({ at, from, children, className }: { at: number; from: number; children: ReactNode; className?: string }) {
  if (at < from) return null;
  return <div className={cx("animate-rise", className)}>{children}</div>;
}

/** Text written out between `from` and `from + ms`. */
function typed(text: string, at: number, from: number, ms: number) {
  if (at <= from) return "";
  return text.slice(0, Math.ceil(Math.min(1, (at - from) / ms) * text.length));
}

function Dots() {
  return (
    <span className="inline-flex gap-1" aria-hidden="true">
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-1.5 animate-breathe rounded-full bg-ink-muted" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

const ai = "w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-surface-sunken px-3.5 py-2 text-sm";
const me = "ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-accent-ink";

/* ------------------------------------------------------------------ scenes */

function Talk({ at }: { at: number }) {
  const answer = "Bread, buns and cakes. Our own shop, plus three hotels who pay monthly.";
  const typing = typed(answer, at, 900, 1700);
  return (
    <div className="flex h-full flex-col justify-end gap-3">
      <At at={at} from={0}>
        <p className={ai}>What do you make, and who buys it?</p>
      </At>
      {at > 700 && (
        <p className={me}>
          {typing}
          {typing.length < answer.length && <span className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 animate-breathe bg-accent-ink" />}
        </p>
      )}
      <At at={at} from={2900} className="ml-auto">
        <span className="inline-flex items-center gap-2 rounded-xl border bg-canvas px-3 py-2 text-xs">
          <FileIcon />
          <span className="font-medium">price-list.xlsx</span>
          {at < 4300 ? <span className="animate-shimmer">Reading</span> : <span className="text-success-fg">42 items with prices</span>}
        </span>
      </At>
      {at > 4700 && at < 5500 && (
        <p className={ai}>
          <Dots />
        </p>
      )}
      <At at={at} from={5500}>
        <p className={ai}>Got your items. Do the hotels get 30 days to pay?</p>
      </At>
    </div>
  );
}

function Check({ at }: { at: number }) {
  const modules = ["Sales", "Point of sale", "Production", "Inventory", "Purchases", "Banking", "Tax"];
  const roles = ["Owner", "Manager", "Accountant", "Stores", "Cashier", "Quality control"];
  return (
    <div className="flex h-full flex-col gap-5">
      <div>
        <p className="mb-2 text-xs text-ink-muted">Screens you'll use</p>
        <div className="flex flex-wrap gap-1.5">
          {modules.map((m, i) =>
            at >= i * 220 ? (
              <span key={m} className="animate-pop rounded-full border bg-canvas px-2.5 py-1 text-xs">
                {m}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <At at={at} from={1900}>
        <p className="mb-2 text-xs text-ink-muted">Who can do what</p>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <span key={r} className="rounded-md bg-surface-sunken px-2 py-1 text-xs">
              {r}
            </span>
          ))}
        </div>
      </At>
      <At at={at} from={3200}>
        <div className="rounded-xl border border-dashed p-3 text-sm">
          <p className="text-xs text-ink-muted">Approvals</p>
          <p className="mt-1">Purchase orders over 2,500 go to the manager, and over 10,000 to the owner too.</p>
        </div>
      </At>
      <At at={at} from={4600} className="mt-auto flex items-center gap-3">
        <span className={cx("inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-colors", at < 5600 ? "bg-accent text-accent-ink" : "bg-success-bg text-success-fg")}>{at < 5600 ? "Create my workspace" : "Workspace ready"}</span>
        {at >= 5600 && <span className="animate-fade text-xs text-ink-muted">With your items, customers and opening stock</span>}
      </At>
    </div>
  );
}

function Run({ at }: { at: number }) {
  const docs = ["Quote", "Order", "Delivery", "Invoice", "Payment"];
  const stage = Math.min(docs.length - 1, Math.floor(at / 1000));
  return (
    <div className="flex h-full flex-col gap-5">
      <div className="relative pt-1">
        <div className="absolute top-[0.95rem] right-[10%] left-[10%] h-px bg-border" aria-hidden="true" />
        <div className="absolute top-[0.95rem] left-[10%] h-px bg-accent transition-[width] duration-700 ease-out" style={{ width: `${(stage / (docs.length - 1)) * 80}%` }} aria-hidden="true" />
        <ol className="relative grid grid-cols-5">
          {docs.map((d, i) => (
            <li key={d} className="flex flex-col items-center gap-1.5">
              <span className={cx("grid size-4 place-items-center rounded-full border-2 transition-all duration-500", i <= stage ? "scale-110 border-accent bg-accent" : "border-border-strong bg-surface")} />
              <span className={cx("text-[11px] transition-colors sm:text-xs", i === stage ? "font-medium text-ink" : i < stage ? "text-ink-muted" : "text-ink-faint")}>{d}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-xl border bg-canvas p-3.5 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{stage >= 3 ? "INV-2026-00001" : stage >= 1 ? "SO-2026-00001" : "Quote, draft"}</span>
          <span className={cx("rounded-full px-2 py-0.5 text-[11px] transition-colors", stage >= 4 ? "bg-success-bg text-success-fg" : "bg-surface-sunken text-ink-muted")}>{stage >= 4 ? "Paid" : stage >= 3 ? "Posted" : stage >= 2 ? "Delivered" : stage >= 1 ? "Confirmed" : "Draft"}</span>
        </div>
        <p className="mt-0.5 text-xs text-ink-muted">Lighthouse Hotel</p>
        <div className="mt-2.5 flex justify-between border-t pt-2 text-xs">
          <span>Sandwich bread · 40 × 250.00</span>
          <span className="tabular font-medium">10,000.00</span>
        </div>
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <At at={at} from={2000} className="rounded-xl bg-surface-sunken/70 p-3">
          <p className="text-ink-muted">Stock</p>
          <p className="mt-0.5">
            Sandwich bread <span className="tabular font-medium">−40</span>
          </p>
        </At>
        <At at={at} from={3000} className="rounded-xl bg-surface-sunken/70 p-3 font-mono">
          <p className="font-sans text-ink-muted">Books</p>
          <p className="mt-0.5 flex justify-between">
            <span>Dr Receivables</span>
            <span>10,000</span>
          </p>
          <p className="flex justify-between">
            <span className="pl-3">Cr Sales</span>
            <span>10,000</span>
          </p>
          {at >= 4000 && (
            <p className="animate-fade mt-1 flex justify-between border-t pt-1 text-success-fg">
              <span>Dr Bank · Cr Receivables</span>
              <span>10,000</span>
            </p>
          )}
        </At>
      </div>
    </div>
  );
}

function Change({ at }: { at: number }) {
  const ask = "Add a seal number to delivery notes";
  const text = typed(ask, at, 200, 1600);
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-xl border bg-canvas px-3.5 py-3 text-sm">
        <p className="mb-1 text-xs text-ink-muted">Describe a change</p>
        <p className="min-h-5">
          {text}
          {text.length < ask.length && <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-breathe bg-ink" />}
        </p>
      </div>
      {at > 2200 && at < 3400 && <p className="animate-shimmer text-sm">Checking it against your setup</p>}
      <At at={at} from={3400}>
        <div className="space-y-2 rounded-xl border border-accent/40 p-3.5 text-sm shadow-xs">
          <p className="font-medium">Seal number on delivery notes</p>
          <p className="flex items-start gap-2">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
            Adds Seal number (text) to Delivery notes
          </p>
          <p className="flex items-start gap-2 text-ink-muted">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
            Existing delivery notes keep their details
          </p>
        </div>
      </At>
      <At at={at} from={4500} className="mt-auto flex items-center gap-3">
        <span className={cx("inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-colors", at < 5400 ? "bg-accent text-accent-ink" : "bg-success-bg text-success-fg")}>{at < 5400 ? "Apply this change" : "Applied as a new version"}</span>
        {at >= 5400 && <span className="animate-fade text-sm text-accent">Undo</span>}
      </At>
    </div>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className="text-success-fg">
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5M8 13h8M8 17h8M12 11v8" />
    </svg>
  );
}
