"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MAX_MESSAGE, OPENING_PROMPT, availableReports, progress, type Attachment, type BusinessProfile, type InterviewPrompt, type Message, type PartialPrompt } from "@shapewise/ai/client";
import { REPORT_BY_KEY, REPORT_CATEGORY_LABEL, applyOps, type Blueprint, type OverlayOp } from "@shapewise/blueprint";
import { Button, StatusPill, cx } from "@shapewise/ui";
import { AttachmentList, Choices, Composer, Thinking, readStream, useAttachments, useStickToBottom, useTypewriter } from "@/components/ai-bits";
import { flowGraph, summarise, type BlueprintSummary } from "@/lib/blueprint-summary";
import { createFromDesign } from "../actions";
import { ProfilePanel, ProgressRail } from "./profile-panel";
import { FlowMap, ModuleCards, ReportPicker } from "./setup-review";
import { RoleMatrix } from "@/components/role-matrix";
import { approvalOps } from "@/lib/approval-ops";
import { permissionModel } from "@/lib/permissions";
import { WorkspaceCreatingOverlay } from "@/components/workspace-creating-overlay";

type Turn = { role: "user"; text: string; attachments?: Attachment[] } | { role: "assistant"; prompt: InterviewPrompt };
type Stage = "chat" | "building" | "review";

interface Design {
  blueprint: Blueprint;
  summary: BlueprintSummary;
  assumptions: string[];
  notes: string[];
  removed: string[];
  taxReasons: string[];
  taxWarnings: string[];
}

interface BuildProgress {
  stage: "designing" | "checking" | "repairing" | "finishing";
  modules: string[];
  extensions: string[];
  recordTypes: string[];
  customFields: string[];
  roles: string[];
  approvals: string[];
  rules: string[];
  round?: number;
}

const STORE_KEY = "sw-onboarding-v2";

const STARTERS = [
  "Harbour Bakes. We bake bread, cakes and pastries for cafés around town and sell at our own counter.",
  "Polar Moulds. We make plastic food containers on injection moulding machines for food companies.",
  "Summit Hardware. We import tools and paint and distribute to hardware shops on credit.",
];

const strip = (a: Attachment[] | undefined) => a?.map(({ dataUrl: _d, ...rest }) => rest);

export function AiOnboarding({ firstName }: { firstName?: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("chat");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<Message[]>([]);
  const [profile, setProfile] = useState<BusinessProfile>({});
  const [deferred, setDeferred] = useState<InterviewPrompt | undefined>();
  const [ready, setReady] = useState(false);
  const [docs, setDocs] = useState<Attachment[]>([]);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState<PartialPrompt | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [design, setDesign] = useState<Design | null>(null);
  const [build, setBuild] = useState<BuildProgress | null>(null);
  const [address, setAddress] = useState("");
  const [creating, setCreating] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [restored, setRestored] = useState(false);
  const files = useAttachments();
  const conversation = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  /* Keep the conversation across reloads, in this browser only. */
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
      if (saved?.turns?.length) {
        setTurns(saved.turns);
        setHistory(saved.history ?? []);
        setProfile(saved.profile ?? {});
        setDeferred(saved.deferred);
        setReady(Boolean(saved.ready));
        setDocs(saved.docs ?? []);
      }
    } catch {
      /* storage unavailable */
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      if (turns.length) localStorage.setItem(STORE_KEY, JSON.stringify({ turns: turns.map((t) => (t.role === "user" ? { ...t, attachments: strip(t.attachments) } : t)), history, profile, deferred, ready, docs }));
      else localStorage.removeItem(STORE_KEY);
    } catch {
      /* storage full or unavailable */
    }
  }, [restored, turns, history, profile, deferred, ready, docs]);

  const pin = useStickToBottom(conversation);
  /** Questions already typed out once, so they never type again (after an error, say). */
  const typed = useRef(new Set<string>());
  useEffect(() => {
    if (!pending && stage === "chat") input.current?.focus({ preventScroll: true });
  }, [pending, stage, turns.length]);

  const last = turns.at(-1);
  const current = last?.role === "assistant" ? last.prompt : undefined;

  async function answer(text: string) {
    const attachments = files.ready();
    const message = text.trim() || (attachments.length ? "Here's what I use today." : "");
    if (!message || pending || files.busy) return;
    if (ready && /^build/i.test(message)) return startBuild();
    if (message.length > MAX_MESSAGE) {
      setError(`That message is ${message.length.toLocaleString("en-LK")} characters, more than the ${MAX_MESSAGE.toLocaleString("en-LK")} I can read at once. Attach it as a file instead, or paste the main points.`);
      return;
    }
    const answering = current?.fact;
    const before = turns;
    setDraft("");
    files.clear();
    setError(null);
    setPartial(null);
    setTurns((t) => [...(t.length ? t : [{ role: "assistant" as const, prompt: OPENING_PROMPT }]), { role: "user", text: message, attachments: attachments.length ? attachments : undefined }]);
    setPending(true);
    requestAnimationFrame(pin);
    try {
      const res = await fetch("/api/onboarding/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ history, profile, deferred, message, attachments, answering }),
      });
      let done = false;
      await readStream(res, (e) => {
        if (e.t === "partial") setPartial({ note: e.note as string | undefined, question: e.question as string | undefined });
        else if (e.t === "error") throw new Error(String(e.message));
        else if (e.t === "done") {
          done = true;
          setTurns((t) => [...t, { role: "assistant", prompt: e.prompt as InterviewPrompt }]);
          setHistory(e.history as Message[]);
          setProfile(e.profile as BusinessProfile);
          setDeferred(e.deferred as InterviewPrompt | undefined);
          setReady(Boolean(e.ready));
          const read = attachments.filter((a) => a.kind === "text");
          if (read.length) setDocs((d) => [...d, ...read]);
        }
      });
      if (!done) throw new Error("The answer was cut off. Try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that.");
      setTurns(before);
      setDraft(message === "Here's what I use today." ? "" : message);
    } finally {
      setPending(false);
      setPartial(null);
    }
  }

  async function startBuild() {
    setError(null);
    setStage("building");
    setBuild({ stage: "designing", modules: [], extensions: [], recordTypes: [], customFields: [], roles: [], approvals: [], rules: [] });
    try {
      const res = await fetch("/api/onboarding/design", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile, attachments: docs.slice(-6) }) });
      let done = false;
      await readStream(res, (e) => {
        if (e.t === "progress") setBuild((b) => ({ ...(b as BuildProgress), ...(e as unknown as Partial<BuildProgress>) }));
        else if (e.t === "error") throw new Error(String(e.message));
        else if (e.t === "done") {
          done = true;
          setDesign(e as unknown as Design);
          setAddress(String(e.suggestedId ?? ""));
          setStage("review");
        }
      });
      if (!done) throw new Error("The design was cut off. Try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't design the setup.");
      setStage("chat");
    }
  }

  async function create() {
    if (!design) return;
    setError(null);
    setCreating(true);
    const r = await createFromDesign({ blueprint: design.blueprint, id: address });
    if (!r.ok) {
      setCreating(false);
      return setError(r.message ?? "Couldn't create the workspace.");
    }
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
    router.push(`/w/${r.id}` as never);
  }

  function startOver() {
    setTurns([]);
    setHistory([]);
    setProfile({});
    setDeferred(undefined);
    setReady(false);
    setDocs([]);
    setDesign(null);
    setError(null);
    setStage("chat");
  }

  if (stage === "building" && build) return <Building name={profile.businessName} progress={build} />;
  if (stage === "review" && design)
    return (
      <>
        {creating && <WorkspaceCreatingOverlay name={profile.businessName} address={address} />}
        <Review
          design={design}
          onChange={(blueprint) => setDesign((d) => (d ? { ...d, blueprint } : d))}
          address={address}
          setAddress={setAddress}
          onBack={() => setStage("chat")}
          onCreate={create}
          creating={creating}
          error={error}
        />
      </>
    );

  const canBuild = !pending && Boolean(profile.businessName && profile.whatTheyDo && profile.products?.length);
  const offerBuild = ready && !pending;

  /* ------------------------------------------------ empty: centred start */
  if (!turns.length) {
    return (
      <main className="relative flex min-h-dvh flex-col">
        <Header onStartOver={undefined} />
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 pb-[12vh] sm:px-6">
          <div className="space-y-3 text-center animate-rise">
            <p className="text-[11px] tracking-[0.12em] text-ink-faint uppercase">Set up with AI</p>
            <h1 className="text-3xl tracking-tight text-balance sm:text-[40px] sm:leading-[1.1]">{firstName ? `${firstName}, tell me about your business` : "Tell me about your business"}</h1>
            <p className="mx-auto max-w-xl text-[15px] leading-relaxed text-pretty text-ink-muted">
              What it's called, what you make or sell and who buys from you. I'll ask a few quick questions, most of them a tap, and shape the system around how you work.
            </p>
          </div>
          <div className="mt-9 animate-rise" style={{ animationDelay: "80ms" }}>
            <Composer
              hero
              inputRef={input}
              label="Describe your business"
              value={draft}
              onChange={setDraft}
              onSend={() => answer(draft)}
              disabled={pending}
              placeholder={OPENING_PROMPT.input.placeholder}
              attachments={files}
              hint="Attach a price list, an invoice or a photo of a job card"
            />
          </div>
          {error && (
            <p role="alert" className="mt-3 text-center text-sm text-danger-fg">
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-col items-center gap-2 animate-rise" style={{ animationDelay: "160ms" }}>
            <p className="text-xs text-ink-faint">Or start from an example</p>
            <div className="flex max-w-2xl flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setDraft(s);
                    input.current?.focus();
                  }}
                  className="rounded-full border border-border-strong bg-surface px-3.5 py-1.5 text-[13px] text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
                >
                  {s.split(".")[0]}
                </button>
              ))}
            </div>
            <Link href="/start/template" className="mt-4 text-xs text-ink-faint underline-offset-4 hover:text-ink hover:underline">
              Prefer to start from a template?
            </Link>
          </div>
        </div>
      </main>
    );
  }

  /* ------------------------------------------------ the conversation */
  // The newest question has its own slot below the history while it types.
  const liveIdx = last?.role === "assistant" && turns.length > 1 ? turns.length - 1 : -1;
  const live = liveIdx >= 0 ? (turns[liveIdx] as Extract<Turn, { role: "assistant" }>).prompt : undefined;
  const userCount = turns.filter((t) => t.role === "user").length;
  const sections = progress(profile);
  const pct = Math.round((sections.reduce((n, s) => n + s.done, 0) / Math.max(1, sections.reduce((n, s) => n + s.total, 0))) * 100);

  return (
    <main className="min-h-dvh">
      <Header onStartOver={startOver} />
      {/* Narrow screens: progress and details behind a button. */}
      <div className="sticky top-14 z-20 border-b bg-canvas/90 px-4 py-2 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
          <button type="button" onClick={() => setShowDetails(true)} className="text-xs text-ink-muted hover:text-ink">
            Details
          </button>
          <Button size="sm" variant={ready ? "primary" : "secondary"} onClick={startBuild} disabled={!canBuild}>
            Build
          </Button>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1480px] gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8 xl:grid-cols-[220px_minmax(0,1fr)_360px] xl:gap-12">
        <aside className="hidden xl:block">
          <div className="sticky top-20 py-6">
            <ProgressRail profile={profile} current={current?.section} />
          </div>
        </aside>

        <section className="mx-auto flex w-full max-w-[46rem] min-w-0 flex-col">
          <div ref={conversation} className="flex-1 space-y-9 pt-8 pb-10" aria-live="polite">
            {turns.map((t, i) =>
              i === liveIdx ? null : t.role === "user" ? (
                <div key={i} className="flex flex-col items-end gap-2 animate-rise">
                  {t.attachments?.length ? <AttachmentList compact items={t.attachments} /> : null}
                  <p className="max-w-[85%] rounded-[20px] rounded-br-md bg-surface-sunken px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">{t.text}</p>
                </div>
              ) : (
                <AssistantTurn key={i} prompt={t.prompt} compact={i === 0} />
              ),
            )}
            {(pending || liveIdx >= 0) && (
              // One slot for the newest question, mounted from the first streamed word to the final answer, so typing never restarts.
              <PromptSlot key={`slot-${userCount}`} prompt={live} partial={pending ? partial : null} reading={Boolean(last?.role === "user" && last.attachments?.length)} typed={typed.current}>
                {live && (live.input.kind !== "text" || offerBuild) && (
                  <Choices
                    key={live.question}
                    kind={live.input.kind === "text" ? "single" : live.input.kind}
                    options={live.input.kind === "text" ? [] : live.input.options.filter((o) => !(offerBuild && /^build/i.test(o)))}
                    preselected={live.preselected}
                    onAnswer={answer}
                    lead={
                      offerBuild && (
                        <button type="button" onClick={startBuild} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-sm text-accent-ink animate-pop hover:bg-accent-hover">
                          Build my setup <span aria-hidden="true">→</span>
                        </button>
                      )
                    }
                  />
                )}
              </PromptSlot>
            )}
            {error && (
              <p role="alert" className="rounded-xl border border-danger-fg/30 bg-danger-bg px-3.5 py-2.5 text-sm text-danger-fg animate-rise">
                {error}
              </p>
            )}
          </div>

          <div className="sticky bottom-0 bg-gradient-to-t from-canvas from-70% to-transparent pt-6 pb-5">
            <Composer
              inputRef={input}
              label="Your answer"
              value={draft}
              onChange={setDraft}
              onSend={() => answer(draft)}
              disabled={pending}
              placeholder={current?.input.placeholder || "Type your answer…"}
              attachments={files}
            />
            <p className="mt-2 text-center text-[11px] text-ink-faint">Nothing is created until you review the setup and approve it.</p>
          </div>
        </section>

        <aside className="hidden lg:block">
          <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] space-y-4 overflow-y-auto py-6 pr-1">
            <BuildCard ready={ready} canBuild={canBuild} onBuild={startBuild} />
            <div className="xl:hidden">
              <ProgressRail profile={profile} current={current?.section} />
            </div>
            <ProfilePanel profile={profile} onChange={setProfile} />
          </div>
        </aside>
      </div>

      {showDetails && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="Your details">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40 animate-fade" onClick={() => setShowDetails(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t bg-canvas p-4 pb-8 shadow-overlay animate-rise">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong" />
            <ProgressRail profile={profile} current={current?.section} />
            <div className="mt-5">
              <ProfilePanel profile={profile} onChange={setProfile} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Header({ onStartOver }: { onStartOver?: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-transparent bg-canvas/80 px-4 backdrop-blur sm:px-6 lg:px-8">
      <Link href="/start" className="flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink">
        <span aria-hidden="true">←</span> Back
      </Link>
      <span className="text-sm text-ink-faint">Set up with AI</span>
      {onStartOver && (
        <button type="button" onClick={onStartOver} className="ml-auto text-xs text-ink-faint transition-colors hover:text-ink">
          Start over
        </button>
      )}
    </header>
  );
}

/** An earlier question, quieter than the current one. */
function AssistantTurn({ prompt, compact }: { prompt: InterviewPrompt; compact?: boolean }) {
  return (
    <div className="space-y-2 opacity-55">
      <p className="flex items-center gap-2 text-[11px] tracking-[0.08em] text-ink-faint uppercase">
        <span className="size-1.5 rounded-full bg-border-strong" aria-hidden="true" />
        {prompt.topicLabel}
      </p>
      {prompt.note && <p className={cx("leading-relaxed text-pretty text-ink-muted", compact ? "text-sm" : "text-[15px]")}>{prompt.note}</p>}
      <h2 className={cx("leading-snug tracking-tight text-pretty text-ink", compact ? "text-base" : "text-lg")}>{prompt.question}</h2>
    </div>
  );
}

const SEP = "\u0001";

/**
 * The newest question: a shimmering status until the first words arrive,
 * then the note and question typed out (while streaming and after), then
 * the answer choices once the question is fully written.
 */
function PromptSlot({ prompt, partial, reading, typed, children }: { prompt?: InterviewPrompt; partial: PartialPrompt | null; reading: boolean; typed: Set<string>; children?: ReactNode }) {
  const note = prompt?.note ?? partial?.note ?? "";
  const question = prompt?.question ?? partial?.question ?? "";
  const seen = prompt ? typed.has(prompt.question) : false;
  const tw = useTypewriter(`${note}${SEP}${question}`, !seen);
  const [shownNote = "", shownQuestion = ""] = tw.text.split(SEP);
  const finished = Boolean(prompt) && tw.done;
  useEffect(() => {
    if (finished && prompt) typed.add(prompt.question);
  }, [finished, prompt, typed]);

  if (!note && !question) return <Thinking label={reading ? "Reading your documents" : "Thinking"} />;
  const onQuestion = tw.text.includes(SEP);
  return (
    <div className="space-y-2.5">
      <p className="flex items-center gap-2 text-[11px] tracking-[0.08em] text-ink-faint uppercase">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
        {prompt ? prompt.topicLabel : <span className="animate-shimmer">Writing</span>}
      </p>
      {note && <p className={cx("text-[15px] leading-relaxed text-pretty text-ink-muted", !finished && !onQuestion && "caret")}>{shownNote || "\u00a0"}</p>}
      {(onQuestion || !note) && <h2 className={cx("text-xl leading-snug tracking-tight text-pretty text-ink sm:text-[22px]", !finished && "caret")}>{shownQuestion || "\u00a0"}</h2>}
      {finished && children && <div className="pt-2 animate-fade">{children}</div>}
    </div>
  );
}

function BuildCard({ ready, canBuild, onBuild }: { ready: boolean; canBuild: boolean; onBuild: () => void }) {
  return (
    <div className={cx("rounded-2xl border p-4 transition-colors duration-500", ready ? "border-accent/50 bg-accent-soft" : "bg-surface")}>
      <p className="text-sm font-medium">{ready ? "Ready to build" : "Build when you're ready"}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        {ready ? "I have enough for a strong first setup. You'll review it before anything is created." : "A few more answers make it fit better, but you can build at any point."}
      </p>
      <Button variant={ready ? "primary" : "secondary"} className="mt-3 w-full" onClick={onBuild} disabled={!canBuild}>
        Build my setup
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- building */

const STAGE_LABEL: Record<BuildProgress["stage"], string> = {
  designing: "Designing your setup",
  checking: "Checking everything fits together",
  repairing: "Fixing a few details",
  finishing: "Finishing up",
};

function Building({ name, progress: p }: { name?: string; progress: BuildProgress }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const groups: [string, string[]][] = [
    ["Modules", p.modules.map((m) => m.replaceAll("_", " "))],
    ["Features", p.extensions.map((m) => m.replaceAll("_", " "))],
    ["Made for you", p.recordTypes],
    ["Details you track", p.customFields],
    ["Roles", p.roles],
    ["Approvals", p.approvals],
    ["Rules", p.rules],
  ];
  const steps: BuildProgress["stage"][] = ["designing", "checking", "finishing"];
  const at = p.stage === "repairing" ? 1 : steps.indexOf(p.stage);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col justify-center px-6 py-16">
      <p className="text-[11px] tracking-[0.12em] text-ink-faint uppercase">Building</p>
      <h1 className="mt-2 text-3xl tracking-tight sm:text-4xl">{name ? `Building ${name}` : "Building your setup"}</h1>
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {steps.map((s, i) => (
          <span key={s} className={cx("flex items-center gap-2 transition-colors duration-500", i < at ? "text-ink-muted" : i === at ? "text-ink" : "text-ink-faint/60")}>
            {i < at ? (
              <svg viewBox="0 0 16 16" className="size-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m3.5 8.5 3 3 6-7" />
              </svg>
            ) : i === at ? (
              <span className="size-3 animate-spin rounded-full border-[1.5px] border-border-strong border-t-accent" aria-hidden="true" />
            ) : (
              <span className="size-1 rounded-full bg-current" aria-hidden="true" />
            )}
            <span className={i === at ? "animate-shimmer" : undefined}>{i === at ? STAGE_LABEL[p.stage] : STAGE_LABEL[s]}</span>
          </span>
        ))}
        <span className="ml-auto tabular text-xs text-ink-faint">{seconds}s</span>
      </div>

      <div className="mt-10 grid gap-x-10 gap-y-7 sm:grid-cols-2" role="status" aria-live="polite">
        {groups.map(([label, items]) => (
          <section key={label}>
            <h2 className="text-xs text-ink-muted">{label}</h2>
            <div className="mt-2 flex min-h-8 flex-wrap gap-1.5">
              {items.length ? (
                items.map((x, i) => (
                  <span key={`${x}${i}`} className="rounded-full border bg-surface px-3 py-1 text-[13px] animate-pop">
                    {x}
                  </span>
                ))
              ) : (
                <span className="h-7 w-24 animate-pulse rounded-full bg-surface-sunken" />
              )}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-12 text-xs text-ink-faint">Usually under a minute. Nothing is created until you approve it.</p>
    </main>
  );
}

/* ------------------------------------------------------------------ review */

function Review({
  design,
  onChange,
  address,
  setAddress,
  onBack,
  onCreate,
  creating,
  error,
}: {
  design: Design;
  onChange: (bp: Blueprint) => void;
  address: string;
  setAddress: (v: string) => void;
  onBack: () => void;
  onCreate: () => void;
  creating: boolean;
  error: string | null;
}) {
  // The summary and the flow follow the setup as it's edited here.
  const s = useMemo(() => summarise(design.blueprint), [design.blueprint]);
  const graph = useMemo(() => flowGraph(design.blueprint), [design.blueprint]);
  const [problem, setProblem] = useState<string | null>(null);
  const check = [...design.assumptions, ...design.notes];
  const bp = design.blueprint;
  const change = (op: OverlayOp | OverlayOp[]) => {
    const ops = Array.isArray(op) ? op : [op];
    if (!ops.length) return;
    const r = applyOps(bp, ops);
    if (!r.ok) return setProblem(r.issues[0]?.message ?? "That change doesn't fit the rest of the setup.");
    setProblem(null);
    onChange(r.blueprint);
  };

  /* approvals: a switch per screen; the owner signs every time until rules are refined in Settings */
  const toggleApproval = (record: string, action: string, label: string, on: boolean) => {
    const owner = bp.roles.find((r) => r.owner)!;
    change(on ? approvalOps({ label: `${label} approval`, target: record, action, stages: [{ name: owner.label, minAmount: 0, roles: [owner.id], requireAll: false }] }) : bp.approvals.filter((a) => a.target === record).map((a) => ({ op: "remove" as const, id: a.id })));
  };

  /* reports: where each shows; dashboard tiles follow the reports pinned there */
  const permissions = useMemo(() => permissionModel(bp), [bp]);
  const chosen = useMemo(
    () =>
      bp.reports.flatMap((r) => {
        const d = REPORT_BY_KEY.get(r.key);
        return d ? [{ key: d.key, label: d.label, asks: d.asks, category: d.category, categoryLabel: REPORT_CATEGORY_LABEL[d.category], places: r.places.filter((x) => x !== "reports"), hasMetric: Boolean(d.metric), waitsForEngine: d.source !== "records" }] : [];
      }),
    [bp],
  );
  const others = useMemo(() => {
    const used = new Set<string>(bp.reports.map((r) => r.key));
    return availableReports(bp)
      .filter((r) => !used.has(r.key))
      .map((r) => ({ key: r.key, label: r.label, asks: r.asks, categoryLabel: REPORT_CATEGORY_LABEL[r.category] }));
  }, [bp]);
  const placeReport = (key: string, places: string[]) => {
    const metric = REPORT_BY_KEY.get(key)?.metric;
    const ops: OverlayOp[] = [{ op: "set_report", key, places: places.length ? [...new Set([...places, "reports"])] : [] }];
    if (metric) {
      const tile = bp.dashboard.find((w) => w.source.kind === "builtin" && w.source.metric === metric);
      if (places.includes("dashboard") && !tile) ops.push({ op: "add", collection: "dashboard", value: { id: `wdg_${metric.replace(/[^a-z0-9]/g, "").slice(0, 16)}${Math.random().toString(36).slice(2, 6)}`, size: "sm", source: { kind: "builtin", metric } } });
      if (!places.includes("dashboard") && tile) ops.push({ op: "remove", id: tile.id });
    }
    change(ops);
  };
  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-10 sm:px-6 lg:px-8">
      <button type="button" onClick={onBack} className="text-sm text-ink-muted transition-colors hover:text-ink">
        ← Back to the conversation
      </button>
      <div className="mt-5 animate-rise">
        <p className="text-[11px] tracking-[0.12em] text-ink-faint uppercase">Your setup</p>
        <h1 className="mt-1.5 text-3xl tracking-tight sm:text-4xl">Here&apos;s the setup for {s.name}</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-muted">Look it over. You can change any of this later in Settings or by asking the assistant.</p>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-10">
          <Section title="What you'll use">
            <p className="-mt-1 mb-3 text-sm text-ink-muted">Open a module to see its screens and fields. Switch off anything you don't need; the flow below updates as you go.</p>
            <ModuleCards
              modules={s.modules}
              busy={false}
              onToggleScreen={(key, on) => change({ op: "set_submodule", key, enabled: on })}
              onToggleModule={(key, on) => change({ op: "set_module", key, enabled: on })}
              onToggleApproval={toggleApproval}
            />
            {problem && (
              <p role="alert" className="mt-3 rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-fg animate-fade">
                {problem}
              </p>
            )}
            {s.extensions.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {s.extensions.map((x) => (
                  <StatusPill key={x} tone="info">
                    {x}
                  </StatusPill>
                ))}
              </div>
            )}
          </Section>

          <Section title="Reports and dashboards">
            <p className="-mt-1 mb-3 text-sm text-ink-muted">What you'll keep an eye on, and where each one shows. Everything is also in Reports.</p>
            <ReportPicker chosen={chosen} available={others} onPlaces={placeReport} onAdd={(k) => placeReport(k, ["module"])} onRemove={(k) => placeReport(k, [])} />
          </Section>

          <Section title="How it connects">
            <p className="-mt-1 mb-3 text-sm text-ink-muted">How each document leads to the next. Hover one to trace its path.</p>
            <FlowMap graph={graph} />
          </Section>

          {s.recordTypes.length > 0 && (
            <Section title="Made for your business">
              <ul className="grid gap-3 sm:grid-cols-2">
                {s.recordTypes.map((r) => (
                  <li key={r.label} className="rounded-2xl border bg-surface px-4 py-3.5">
                    <p className="font-medium">{r.label}</p>
                    <p className="mt-1 text-sm text-ink-muted">{r.fields.join(", ")}</p>
                    {r.statuses.length > 0 && <p className="mt-2 text-xs text-ink-faint">Goes through {r.statuses.join(" → ")}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {s.customFields.length > 0 && (
            <Section title="Extra details you track">
              <ul className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
                {s.customFields.map((c, i) => (
                  <li key={i}>
                    <span className="font-medium">{c.label}</span> <span className="text-ink-muted">on {c.record.toLowerCase()} {c.where}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="People and permissions">
            <p className="-mt-1 mb-3 text-sm text-ink-muted">What each role can do in each module. Open a module to set it screen by screen. You can change all of this later in Settings.</p>
            <RoleMatrix model={permissions} onChange={change} />
            <h3 className="mt-6 mb-2 text-sm font-medium">Approvals</h3>
            {s.approvals.length > 0 ? (
              <ul className="mt-4 space-y-1 text-sm">
                {s.approvals.map((a) => (
                  <li key={a} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-faint" aria-hidden="true" />
                    {a}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-xl border border-dashed px-4 py-3 text-sm leading-relaxed text-ink-muted">
                No approvals yet. Once you&apos;ve seen the system, set them per screen, action and amount in Governance, Approvals, or describe one in System changes
                (for example &quot;purchase orders over 5,000 need the owner&quot;) and the AI sets it up for you to confirm.
              </p>
            )}
            {s.rules.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                {s.rules.map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-border-strong" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-2xl border bg-surface p-5">
            <h2 className="text-sm font-medium">Taxes and money</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {s.country} · {s.currency}
            </p>
            {s.taxCodes.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.taxCodes.map((t) => (
                  <span key={t} className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs">
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm">No tax rates to start with.</p>
            )}
            <ul className="mt-3 space-y-1 text-xs leading-relaxed text-ink-muted">
              {design.taxWarnings.map((w) => (
                <li key={w} className="text-warning-fg">
                  {w}
                </li>
              ))}
              {design.taxReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>

          {(check.length > 0 || design.removed.length > 0) && (
            <div className="rounded-2xl border bg-surface p-5">
              <h2 className="text-sm font-medium">Please check</h2>
              <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
                {check.map((a) => (
                  <li key={a} className="text-ink-muted">
                    {a}
                  </li>
                ))}
                {design.removed.map((n) => (
                  <li key={n} className="text-warning-fg">
                    Not included: {n}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3 rounded-2xl border bg-surface p-5">
            <label className="block">
              <span className="mb-1.5 block text-sm text-ink-muted">Workspace address</span>
              <div className="flex items-center rounded-lg border border-border-strong bg-surface focus-within:border-focus">
                <span className="pl-3 text-sm text-ink-faint">shapewise.web.app/w/</span>
                <input aria-label="Workspace address" className="h-10 min-w-0 flex-1 bg-transparent pr-3 text-sm outline-none" value={address} onChange={(e) => setAddress(e.target.value.toLowerCase())} />
              </div>
            </label>
            {error && (
              <p role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            )}
            <Button variant="primary" className="h-10 w-full" onClick={onCreate} disabled={creating || !address}>
              {creating ? "Creating your workspace…" : "Create my workspace"}
            </Button>
          </div>
          <DerivedFooter />
        </aside>
      </div>
    </main>
  );
}

function DerivedFooter() {
  return <p className="px-1 text-[11px] leading-relaxed text-ink-faint">Tax rules are built in for each supported country as of 2026. Rates and thresholds change, so confirm with your accountant.</p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

