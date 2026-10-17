"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Proposal } from "@shapewise/ai";
import type { Attachment, Message } from "@shapewise/ai/client";
import { Button, cx } from "@shapewise/ui";
import { AttachmentList, Composer, RichText, Thinking, readStream, undash, useAttachments, useStickToBottom, useTypewriter } from "@/components/ai-bits";
import { confirmProposal } from "@/app/w/[tenant]/assistant-actions";

type ToolStep = { name: string; ok: boolean; record?: string };
type Turn =
  | { kind: "user"; text: string; attachments?: Attachment[] }
  | {
      kind: "assistant";
      text: string;
      streaming?: boolean;
      suggestions: string[];
      tools: ToolStep[];
      proposals: (Proposal & { state?: "done" | "pending" | "failed" | "dismissed"; note?: string })[];
    };

const TOOL_DONE: Record<string, string> = { search_records: "Looked at", get_record: "Opened", summarise: "Totalled", propose_change: "Prepared a change to" };
const TOOL_DOING: Record<string, string> = { search_records: "Looking at", get_record: "Opening", summarise: "Totalling", propose_change: "Preparing a change to" };

const SUGGESTIONS = [
  { q: "Which invoices are overdue?", hint: "Who owes you and how much" },
  { q: "Who are my top 5 customers this year?", hint: "By sales" },
  { q: "What's waiting for approval?", hint: "Orders, bills and changes" },
  { q: "How is stock looking?", hint: "Low and slow moving items" },
];

const plural = (r?: string) => (r ? r.replaceAll("_", " ") + (r.endsWith("s") ? "" : "s") : "records");
/** While streaming, hide the trailing "Next:" line the model writes for the follow up chips. */
const visible = (text: string) => undash(text.replace(/\n?\s*\**next\**\s*:[\s\S]*$/i, "").trimEnd());

/**
 * The workspace assistant, as a side panel. Answers stream in as they are
 * written, every answer shows what it looked at, and every change it
 * suggests waits for a Confirm and then runs through the same rules and
 * approvals as the forms.
 */
export function AssistantPanel({ tenant, open, onClose }: { tenant: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, startConfirm] = useTransition();
  const files = useAttachments();
  const scroller = useRef<HTMLDivElement>(null);
  /** Outcomes of suggestions since the last question, passed along with the next one. */
  const outcomes = useRef<string[]>([]);
  const result = useRef<string | undefined>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const pending = busy || confirming;

  const content = useRef<HTMLDivElement>(null);
  // Follow the answer as it types, unless the person scrolled up to read.
  const pin = useStickToBottom(content, scroller);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const patchLast = (fn: (t: Extract<Turn, { kind: "assistant" }>) => Extract<Turn, { kind: "assistant" }>) =>
    setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 && t.kind === "assistant" ? fn(t) : t)));

  async function ask(question: string) {
    const attachments = files.ready();
    const q = question.trim() || (attachments.length ? "What's in this?" : "");
    if (!q || pending || files.busy) return;
    setDraft("");
    files.clear();
    setError(null);
    const before = turns;
    setTurns((t) => [...t, { kind: "user", text: q, attachments: attachments.length ? attachments : undefined }, { kind: "assistant", text: "", streaming: true, suggestions: [], tools: [], proposals: [] }]);
    setBusy(true);
    requestAnimationFrame(pin);
    try {
      const res = await fetch(`/api/w/${encodeURIComponent(tenant)}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ history, question: outcomes.current.length ? `${q}\n\n[What happened to your earlier suggestions: ${outcomes.current.splice(0).join("; ")}]` : q, attachments }),
      });
      let done = false;
      await readStream(res, (e) => {
        if (e.t === "tool") patchLast((t) => ({ ...t, tools: [...t.tools, { name: String(e.name), ok: Boolean(e.ok), record: e.record as string | undefined }] }));
        else if (e.t === "round") patchLast((t) => ({ ...t, text: "" }));
        else if (e.t === "text") patchLast((t) => ({ ...t, text: t.text + String(e.delta) }));
        else if (e.t === "error") throw new Error(String(e.message));
        else if (e.t === "done") {
          done = true;
          setHistory(e.history as Message[]);
          patchLast((t) => ({ ...t, streaming: false, text: String(e.reply ?? ""), suggestions: (e.suggestions as string[]) ?? [], proposals: (e.proposals as Proposal[]) ?? [] }));
        }
      });
      if (!done) throw new Error("The answer was cut off. Try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No answer.");
      setTurns(before);
      setDraft(q);
    } finally {
      setBusy(false);
    }
  }

  function decide(turnIndex: number, p: Proposal, confirm: boolean) {
    const update = (state: "done" | "pending" | "failed" | "dismissed", note?: string) => {
      setTurns((ts) => ts.map((t, i) => (i === turnIndex && t.kind === "assistant" ? { ...t, proposals: t.proposals.map((x) => (x.id === p.id ? { ...x, state, note } : x)) } : t)));
      // The assistant learns what happened with the next question, so it doesn't ask again for something already done.
      const said = { done: "confirmed and done", pending: "confirmed, waiting for approval", failed: `confirmed but not done${note ? ` (${note})` : ""}`, dismissed: "dismissed by the person" }[state];
      outcomes.current.push(`${p.summary}: ${said}${state === "done" && result.current ? ` (id ${result.current})` : ""}`);
    };
    if (!confirm) return update("dismissed");
    startConfirm(async () => {
      const r = await confirmProposal(tenant, p);
      result.current = r.recordId;
      if (!r.ok) update("failed", [r.message, ...(r.issues ?? []).map((i) => i.message)].filter(Boolean).join(" "));
      else update(r.pending ? "pending" : "done", r.pending ? r.message : r.warnings?.join(" "));
      router.refresh();
    });
  }

  function newChat() {
    outcomes.current = [];
    setTurns([]);
    setHistory([]);
    setError(null);
    input.current?.focus();
  }

  if (!open) return null;
  const empty = turns.length === 0;
  const composer = (
    <Composer
      inputRef={input}
      label="Ask a question"
      value={draft}
      onChange={setDraft}
      onSend={() => ask(draft)}
      disabled={pending}
      placeholder={empty ? "Ask about invoices, stock, customers…" : "Ask a follow up…"}
      attachments={files}
      hero={empty}
      hint={empty ? "Attach a bill or price list to record it" : undefined}
    />
  );

  return (
    <aside aria-label="Assistant" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[30rem] flex-col border-l bg-canvas shadow-overlay animate-slide-in">
      <header className="flex h-[var(--sw-topbar-height)] shrink-0 items-center gap-2 border-b px-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-accent" aria-hidden="true">
          <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
            <path d="M8 1.5 9.4 5.6 13.5 7 9.4 8.4 8 12.5 6.6 8.4 2.5 7l4.1-1.4L8 1.5Zm4.5 8 .6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.9Z" />
          </svg>
        </span>
        <h2 className="font-medium">Ask</h2>
        <span className="hidden text-xs text-ink-faint sm:inline">Answers from your workspace data</span>
        <div className="ml-auto flex items-center gap-1">
          {!empty && (
            <button type="button" onClick={newChat} disabled={pending} className="h-8 rounded-sw px-2.5 text-xs text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-50">
              New chat
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close assistant" title="Close (Esc)" className="flex size-8 items-center justify-center rounded-sw text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink">
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </header>

      {empty ? (
        <div className="flex flex-1 flex-col justify-center gap-6 overflow-y-auto px-5 pb-10">
          <div className="space-y-1.5 animate-rise">
            <p className="text-2xl tracking-tight">What would you like to know?</p>
            <p className="text-sm leading-relaxed text-ink-muted">Ask about records, totals and what needs attention. I can also prepare changes for you to confirm.</p>
          </div>
          <div className="animate-rise" style={{ animationDelay: "60ms" }}>
            {composer}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SUGGESTIONS.map((s, i) => (
              <button
                key={s.q}
                type="button"
                onClick={() => ask(s.q)}
                style={{ animationDelay: `${120 + i * 40}ms` }}
                className="group rounded-xl border bg-surface px-3.5 py-3 text-left transition-[border-color,transform] duration-150 animate-pop hover:border-border-strong active:scale-[0.98]"
              >
                <span className="block text-sm leading-snug text-ink">{s.q}</span>
                <span className="mt-1 block text-xs text-ink-faint">{s.hint}</span>
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          )}
        </div>
      ) : (
        <>
          <div ref={scroller} className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 [scrollbar-gutter:stable]" aria-live="polite">
            <div ref={content} className="space-y-6">
            {turns.map((t, i) =>
              t.kind === "user" ? (
                <div key={i} className="flex flex-col items-end gap-2 animate-rise">
                  {t.attachments?.length ? <AttachmentList compact items={t.attachments} /> : null}
                  <p className="max-w-[88%] rounded-[18px] rounded-br-md bg-surface-sunken px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap">{t.text}</p>
                </div>
              ) : (
                <AssistantTurn key={i} turn={t} last={i === turns.length - 1} pending={pending} onAsk={ask} onDecide={(p, c) => decide(i, p, c)} />
              ),
            )}
            {error && (
              <p role="alert" className="rounded-xl border border-danger-fg/30 bg-danger-bg px-3 py-2 text-sm text-danger-fg animate-rise">
                {error}
              </p>
            )}
            </div>
          </div>
          <div className="border-t bg-canvas p-3">{composer}</div>
        </>
      )}
    </aside>
  );
}

function AssistantTurn({
  turn: t,
  last,
  pending,
  onAsk,
  onDecide,
}: {
  turn: Extract<Turn, { kind: "assistant" }>;
  last: boolean;
  pending: boolean;
  onAsk: (q: string) => void;
  onDecide: (p: Proposal, confirm: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const full = t.streaming ? visible(t.text) : t.text;
  // Answers type out at a steady pace however the text arrives; earlier answers show at once.
  const tw = useTypewriter(full, last);
  const text = tw.text;
  const typing = t.streaming || !tw.done;
  const working = t.streaming && !full;
  const lastTool = t.tools.at(-1);
  return (
    <div className="group space-y-3 animate-rise">
      {t.tools.length > 0 && (
        <ol className="space-y-1">
          {t.tools.map((u, j) => (
            <li key={j} className={cx("flex items-center gap-2 text-xs animate-fade", u.ok ? "text-ink-faint" : "text-ink-faint line-through")}>
              <svg viewBox="0 0 12 12" className={cx("size-3", u.ok ? "text-accent" : "text-ink-faint")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m2.5 6.5 2.2 2.2L9.5 3.8" />
              </svg>
              {TOOL_DONE[u.name] ?? u.name} {u.name === "get_record" ? u.record?.replaceAll("_", " ") : plural(u.record)}
            </li>
          ))}
        </ol>
      )}
      {working ? (
        <Thinking label={lastTool ? `${TOOL_DOING[lastTool.name] ?? "Working on"} ${plural(lastTool.record)}` : "Thinking"} />
      ) : (
        <div className="text-sm">
          <RichText text={text} streaming={typing} />
        </div>
      )}
      {!typing && t.proposals.map((p) => (
        <div key={p.id} className="overflow-hidden rounded-xl border border-accent/40 bg-accent-soft animate-pop">
          <div className="px-3.5 py-2.5">
            <p className="text-[11px] tracking-[0.06em] text-ink-muted uppercase">
              {p.kind === "create" ? "New" : p.kind === "update" ? "Change" : p.kind === "action" ? p.action?.replaceAll("_", " ") : `Turn into ${p.to?.replaceAll("_", " ")}`} · {p.recordLabel.toLowerCase()}
            </p>
            <p className="mt-0.5 text-sm font-medium">{p.summary}</p>
          </div>
          {p.state === undefined ? (
            <div className="flex gap-2 border-t border-accent/20 bg-surface/50 px-3.5 py-2">
              <Button size="sm" variant="primary" disabled={pending} onClick={() => onDecide(p, true)}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDecide(p, false)}>
                Dismiss
              </Button>
            </div>
          ) : (
            <p className={cx("border-t border-accent/20 px-3.5 py-2 text-xs", p.state === "failed" ? "text-danger-fg" : p.state === "pending" ? "text-warning-fg" : "text-ink-muted")}>
              {p.state === "done" ? "Done." : p.state === "dismissed" ? "Dismissed." : p.state === "pending" ? "Waiting for approval." : "Not done."} {p.note}
            </p>
          )}
        </div>
      ))}
      {!typing && text && (
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="h-7 rounded-md px-2 text-xs text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {last && !pending && !typing && t.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {t.suggestions.map((q, i) => (
            <button
              key={q}
              type="button"
              onClick={() => onAsk(q)}
              style={{ animationDelay: `${i * 50}ms` }}
              className="inline-flex min-h-8 items-center rounded-full border border-border-strong bg-surface px-3 text-[13px] text-ink-muted transition-colors animate-pop hover:border-ink-faint hover:text-ink"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
