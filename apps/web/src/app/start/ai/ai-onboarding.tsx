"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { BusinessProfile, InterviewPrompt, Message } from "@shapewise/ai";
import type { Blueprint } from "@shapewise/blueprint";
import { Button, StatusPill, cx } from "@shapewise/ui";
import { Choices, Composer, Thinking } from "@/components/ai-bits";
import type { BlueprintSummary } from "@/lib/blueprint-summary";
import { createFromDesign, designSetup, interviewStep } from "../actions";

type Turn = { role: "user"; text: string } | { role: "assistant"; prompt: InterviewPrompt };
type Stage = "chat" | "designing" | "review";

const LABELS: [keyof BusinessProfile, string][] = [
  ["businessName", "Business"],
  ["whatTheyDo", "What you do"],
  ["products", "Products"],
  ["customers", "Customers"],
  ["suppliers", "Suppliers"],
  ["productionSteps", "Production steps"],
  ["machines", "Machines"],
  ["qualityChecks", "Quality checks"],
  ["stockPractices", "Stock"],
  ["documents", "Documents"],
  ["team", "Team"],
  ["approvals", "Approvals"],
  ["thingsToTrack", "Also tracked"],
  ["taxes", "Taxes"],
];

export function AiOnboarding({ opening }: { opening: InterviewPrompt }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("chat");
  const [turns, setTurns] = useState<Turn[]>([{ role: "assistant", prompt: opening }]);
  const [history, setHistory] = useState<Message[]>([]);
  const [profile, setProfile] = useState<BusinessProfile>({});
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [design, setDesign] = useState<{ blueprint: Blueprint; summary: BlueprintSummary; assumptions: string[]; notes: string[]; removed: string[] } | null>(null);
  const [address, setAddress] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);
  useEffect(() => {
    if (!pending && stage === "chat") input.current?.focus({ preventScroll: true });
  }, [pending, stage]);

  function answer(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    if (ready && /^build/i.test(message)) return build();
    setDraft("");
    setError(null);
    setTurns((t) => [...t, { role: "user", text: message }]);
    start(async () => {
      const r = await interviewStep({ history, profile, message });
      if (!r.ok) {
        setError(r.message ?? "Couldn't send that.");
        setTurns((t) => t.slice(0, -1));
        setDraft(message);
        return;
      }
      setTurns((t) => [...t, { role: "assistant", prompt: r.prompt! }]);
      setHistory(r.history ?? []);
      setProfile(r.profile!);
      setReady(Boolean(r.ready));
    });
  }

  function build() {
    setError(null);
    setStage("designing");
    start(async () => {
      const r = await designSetup(profile);
      if (!r.ok) {
        setError(r.message ?? "Couldn't design the setup.");
        setStage("chat");
        return;
      }
      setDesign({ blueprint: r.blueprint!, summary: r.summary!, assumptions: r.assumptions ?? [], notes: r.notes ?? [], removed: r.removed ?? [] });
      setAddress(r.suggestedId ?? "");
      setStage("review");
    });
  }

  function create() {
    if (!design) return;
    setError(null);
    start(async () => {
      const r = await createFromDesign({ blueprint: design.blueprint, id: address });
      if (!r.ok) return setError(r.message ?? "Couldn't create the workspace.");
      router.push(`/w/${r.id}` as never);
    });
  }

  const known = LABELS.filter(([k]) => {
    const v = profile[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "";
  });

  if (stage === "designing") return <Designing name={profile.businessName} />;

  if (stage === "review" && design) {
    const s = design.summary;
    return (
      <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
        <div>
          <button type="button" onClick={() => setStage("chat")} className="text-sm text-ink-muted hover:text-ink">
            ← Back to the conversation
          </button>
          <h1 className="mt-4 text-2xl tracking-tight">Here&apos;s the setup for {s.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">Look it over. You can change any of this later in Settings or by asking in System changes.</p>
        </div>

        <Section title="What you'll use">
          <ul className="grid gap-2 sm:grid-cols-2">
            {s.modules.map((m) => (
              <li key={m.label} className="rounded-sw border bg-surface px-4 py-3 text-sm">
                <p className="font-medium">{m.label}</p>
                <p className="text-ink-muted">{m.screens.join(" · ")}</p>
              </li>
            ))}
          </ul>
          {s.extensions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.extensions.map((x) => (
                <StatusPill key={x} tone="info">
                  {x}
                </StatusPill>
              ))}
            </div>
          )}
        </Section>

        {s.recordTypes.length > 0 && (
          <Section title="Made for your business">
            <ul className="space-y-2">
              {s.recordTypes.map((r) => (
                <li key={r.label} className="rounded-sw border bg-surface px-4 py-3 text-sm">
                  <p className="font-medium">{r.label}</p>
                  <p className="text-ink-muted">{r.fields.join(", ")}</p>
                  {r.statuses.length > 0 && <p className="mt-1 text-xs text-ink-faint">Goes through: {r.statuses.join(" → ")}</p>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {s.customFields.length > 0 && (
          <Section title="Extra details you track">
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {s.customFields.map((c, i) => (
                <li key={i}>
                  <span className="font-medium">{c.label}</span> <span className="text-ink-muted">on {c.record.toLowerCase()} {c.where}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="People and approvals">
          <p className="text-sm">
            <span className="text-ink-muted">Roles: </span>
            {s.roles.map((r) => r.label).join(", ")}
          </p>
          {s.approvals.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
              {s.approvals.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {s.rules.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-muted">
              {s.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </Section>

        {(design.assumptions.length > 0 || design.notes.length > 0 || design.removed.length > 0) && (
          <Section title="Please check">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {design.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
              {design.notes.map((n) => (
                <li key={n} className="text-ink-muted">
                  {n}
                </li>
              ))}
              {design.removed.map((n) => (
                <li key={n} className="text-warning-fg">
                  Not included: {n}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <div className="space-y-3 rounded-sw border bg-surface p-5">
          <label className="block">
            <span className="mb-1.5 block text-sm text-ink-muted">Workspace address</span>
            <div className="flex items-center rounded-sw border border-border-strong bg-surface focus-within:border-focus">
              <span className="pl-3 text-sm text-ink-faint">shapewise.web.app/w/</span>
              <input aria-label="Workspace address" className="h-9 min-w-0 flex-1 bg-transparent pr-3 text-sm outline-none" value={address} onChange={(e) => setAddress(e.target.value.toLowerCase())} />
            </div>
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          )}
          <Button variant="primary" onClick={create} disabled={pending || !address}>
            {pending ? "Creating…" : "Create my workspace"}
          </Button>
        </div>
      </main>
    );
  }

  const last = turns.at(-1);
  const current = last?.role === "assistant" ? last.prompt : undefined;
  const offerBuild = ready && !pending;

  return (
    <main className="mx-auto grid min-h-dvh max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="mx-auto flex w-full max-w-2xl flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 bg-canvas/90 py-4 backdrop-blur">
          <Link href="/start" className="text-sm text-ink-muted hover:text-ink">
            ← Back
          </Link>
          <span className="text-sm text-ink-faint">Set up with AI</span>
          <span className="ml-auto text-xs text-ink-faint tabular lg:hidden">{known.length} details</span>
          <Button size="sm" variant={ready ? "primary" : "secondary"} className="lg:hidden" onClick={build} disabled={pending || known.length < 3}>
            Build
          </Button>
        </header>

        <div className="flex-1 space-y-8 pt-6 pb-8" aria-live="polite">
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="flex justify-end animate-rise">
                <p className="max-w-[80%] rounded-2xl bg-surface-sunken px-4 py-2.5 text-sm whitespace-pre-wrap">{t.text}</p>
              </div>
            ) : (
              <div key={i} className={cx("space-y-3 animate-rise", t !== last && "opacity-60")}>
                <p className="text-[11px] tracking-[0.08em] text-ink-faint uppercase">{t.prompt.topicLabel}</p>
                {t.prompt.note && <p className="text-sm leading-relaxed text-ink-muted">{t.prompt.note}</p>}
                <h2 className="text-lg leading-snug tracking-tight text-ink sm:text-xl">{t.prompt.question}</h2>
                {t === last && !pending && (t.prompt.input.kind !== "text" || offerBuild) && (
                  <div className="pt-2">
                    <Choices
                      key={i}
                      kind={t.prompt.input.kind === "text" ? "single" : t.prompt.input.kind}
                      options={t.prompt.input.kind === "text" ? [] : t.prompt.input.options.filter((o) => !(offerBuild && /^build/i.test(o)))}
                      onAnswer={answer}
                      lead={
                        offerBuild && (
                          <button type="button" onClick={build} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-sm text-accent-ink hover:bg-accent-hover">
                            Build my setup <span aria-hidden="true">→</span>
                          </button>
                        )
                      }
                    />
                  </div>
                )}
              </div>
            ),
          )}
          {pending && <Thinking />}
          {error && (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          )}
          <div ref={end} />
        </div>

        <div className="sticky bottom-0 bg-canvas pt-2 pb-5">
          <Composer
            inputRef={input}
            label="Your answer"
            value={draft}
            onChange={setDraft}
            onSend={() => answer(draft)}
            disabled={pending}
            placeholder={current?.input.placeholder || "Type your answer…"}
          />
        </div>
      </section>

      <aside className="hidden lg:block">
        <div className="sticky top-0 space-y-5 py-6">
          <div>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium">Your business</h2>
              <span className="text-xs text-ink-faint tabular">{known.length} details</span>
            </div>
            <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.min(100, ready ? 100 : (known.length / 9) * 100)}%` }} />
            </div>
          </div>
          {known.length === 0 ? (
            <p className="text-sm text-ink-faint">What you tell me shows up here.</p>
          ) : (
            <dl className="space-y-3 text-sm">
              {known.map(([k, label]) => {
                const v = profile[k];
                return (
                  <div key={k} className="animate-rise">
                    <dt className="text-[11px] tracking-[0.08em] text-ink-faint uppercase">{label}</dt>
                    <dd className="mt-0.5 leading-relaxed">{Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</dd>
                  </div>
                );
              })}
            </dl>
          )}
          <div className="space-y-2 border-t pt-5">
            <Button variant={ready ? "primary" : "secondary"} className="w-full" onClick={build} disabled={pending || known.length < 3}>
              Build my setup
            </Button>
            <p className="text-xs leading-relaxed text-ink-faint">{ready ? "I have enough for a strong first setup. You'll review it before anything is created." : "A few more answers make it fit better — but you can build any time."}</p>
          </div>
        </div>
      </aside>
    </main>
  );
}

const DESIGN_STEPS = ["Reading your answers", "Choosing what you'll use", "Shaping records around your work", "Setting up roles and approvals", "Checking everything fits together"];

function Designing({ name }: { name?: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, DESIGN_STEPS.length - 1)), 6000);
    return () => clearInterval(t);
  }, []);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="text-[11px] tracking-[0.08em] text-ink-faint uppercase">Designing</p>
      <h1 className="mt-2 text-2xl tracking-tight">{name ? `Building ${name}` : "Building your setup"}</h1>
      <ol className="mt-8 space-y-3.5" role="status">
        {DESIGN_STEPS.map((label, i) => (
          <li key={label} className={cx("flex items-center gap-3 text-sm transition-colors duration-500", i < step ? "text-ink-muted" : i === step ? "text-ink" : "text-ink-faint/60")}>
            <span className="flex size-4 items-center justify-center" aria-hidden="true">
              {i < step ? (
                <svg viewBox="0 0 16 16" className="size-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m3.5 8.5 3 3 6-7" />
                </svg>
              ) : i === step ? (
                <span className="size-3 animate-spin rounded-full border-[1.5px] border-border-strong border-t-accent" />
              ) : (
                <span className="size-1 rounded-full bg-current" />
              )}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <p className="mt-8 text-xs text-ink-faint">Usually under a minute. Nothing is created until you approve it.</p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}
