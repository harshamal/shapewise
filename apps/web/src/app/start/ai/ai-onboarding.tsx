"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { BusinessProfile, Message } from "@shapewise/ai";
import type { Blueprint } from "@shapewise/blueprint";
import { Button, StatusPill, Textarea, cx } from "@shapewise/ui";
import type { BlueprintSummary } from "@/lib/blueprint-summary";
import { createFromDesign, designSetup, interviewStep } from "../actions";

type Chat = { role: "user" | "assistant"; text: string };
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

export function AiOnboarding({ opening }: { opening: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("chat");
  const [chat, setChat] = useState<Chat[]>([{ role: "assistant", text: opening }]);
  const [profile, setProfile] = useState<BusinessProfile>({});
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [design, setDesign] = useState<{ blueprint: Blueprint; summary: BlueprintSummary; assumptions: string[]; notes: string[]; removed: string[] } | null>(null);
  const [address, setAddress] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [chat, pending]);

  function send(e?: React.FormEvent) {
    e?.preventDefault();
    const message = draft.trim();
    if (!message || pending) return;
    setDraft("");
    setError(null);
    const history: Message[] = chat.map((m) => ({ role: m.role, text: m.text }));
    setChat((c) => [...c, { role: "user", text: message }]);
    start(async () => {
      const r = await interviewStep({ history, profile, message });
      if (!r.ok) {
        setError(r.message ?? "Couldn't send that.");
        setChat((c) => c.slice(0, -1));
        setDraft(message);
        return;
      }
      setChat((c) => [...c, { role: "assistant", text: r.reply! }]);
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

  if (stage === "designing") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-6 text-center">
        <div className="mx-auto size-10 animate-spin rounded-full border-2 border-border-strong border-t-accent" aria-hidden="true" />
        <h1 className="text-xl tracking-tight">Designing your setup…</h1>
        <p className="text-sm text-ink-muted" role="status">
          Choosing modules, adding the details you track, setting up roles and approvals, and checking that everything fits together. This usually takes under a minute.
        </p>
      </main>
    );
  }

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

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl gap-6 px-6 py-10 lg:grid-cols-[1fr_300px]">
      <section className="flex min-h-[70dvh] flex-col">
        <div className="mb-4">
          <Link href="/start" className="text-sm text-ink-muted hover:text-ink">
            ← Back
          </Link>
          <h1 className="mt-3 text-xl tracking-tight">Tell us about your business</h1>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto rounded-sw border bg-surface p-4" aria-live="polite">
          {chat.map((m, i) => (
            <div key={i} className={cx("max-w-[85%] rounded-sw px-3.5 py-2.5 text-sm whitespace-pre-wrap", m.role === "user" ? "ml-auto bg-accent text-accent-ink" : "bg-surface-sunken")}>
              {m.text}
            </div>
          ))}
          {pending && <div className="w-16 rounded-sw bg-surface-sunken px-3.5 py-2.5 text-sm text-ink-muted">…</div>}
          <div ref={end} />
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger-fg">
            {error}
          </p>
        )}
        <form onSubmit={send} className="mt-3 flex items-end gap-2">
          <Textarea
            aria-label="Your answer"
            rows={2}
            className="min-h-0 flex-1 resize-none"
            value={draft}
            placeholder="Type your answer…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button type="submit" disabled={pending || !draft.trim()}>
            Send
          </Button>
        </form>
      </section>

      <aside className="space-y-4">
        <div className="rounded-sw border bg-surface p-4">
          <h2 className="mb-2 text-sm font-medium">What we know so far</h2>
          {known.length === 0 ? (
            <p className="text-sm text-ink-muted">Answers appear here as you go.</p>
          ) : (
            <dl className="space-y-2 text-sm">
              {known.map(([k, label]) => {
                const v = profile[k];
                return (
                  <div key={k}>
                    <dt className="text-xs text-ink-muted">{label}</dt>
                    <dd>{Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
        <Button variant={ready ? "primary" : "secondary"} className="w-full" onClick={build} disabled={pending || known.length < 3}>
          Build my setup
        </Button>
        <p className="text-xs text-ink-muted">{ready ? "We have enough to build a good first setup." : "A few more answers will make the setup fit better, but you can build it any time."}</p>
      </aside>
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
