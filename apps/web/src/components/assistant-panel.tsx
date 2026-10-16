"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Message, Proposal } from "@shapewise/ai";
import { Button, cx } from "@shapewise/ui";
import { Composer, RichText, Thinking } from "@/components/ai-bits";
import { askAssistant, confirmProposal } from "@/app/w/[tenant]/assistant-actions";

type Turn =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; suggestions: string[]; tools: { name: string; ok: boolean; record?: string }[]; proposals: (Proposal & { state?: "done" | "pending" | "failed" | "dismissed"; note?: string })[] };

const TOOL_LABEL: Record<string, string> = { search_records: "Looked at", get_record: "Opened", summarise: "Totalled", propose_change: "Proposed a change to" };

const SUGGESTIONS = ["Which invoices are overdue?", "Who are my top 5 customers this year?", "What's waiting for approval?"];

/**
 * The workspace assistant, as a side panel. Every answer shows what it looked
 * at; every change it suggests waits for a Confirm and then runs through the
 * same rules and approvals as the forms.
 */
export function AssistantPanel({ tenant, open, onClose }: { tenant: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns, pending]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function ask(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setDraft("");
    setError(null);
    setTurns((t) => [...t, { kind: "user", text: q }]);
    start(async () => {
      const r = await askAssistant(tenant, history, q);
      if (!r.ok) {
        setError(r.message ?? "No answer.");
        return;
      }
      setHistory(r.history ?? []);
      setTurns((t) => [
        ...t,
        {
          kind: "assistant",
          text: r.reply ?? "",
          suggestions: r.suggestions ?? [],
          tools: (r.toolsUsed ?? []).map((u) => ({ name: u.name, ok: u.ok, record: (u.args as { record?: string })?.record })),
          proposals: r.proposals ?? [],
        },
      ]);
    });
  }

  function decide(turnIndex: number, p: Proposal, confirm: boolean) {
    const update = (state: "done" | "pending" | "failed" | "dismissed", note?: string) =>
      setTurns((ts) => ts.map((t, i) => (i === turnIndex && t.kind === "assistant" ? { ...t, proposals: t.proposals.map((x) => (x.id === p.id ? { ...x, state, note } : x)) } : t)));
    if (!confirm) return update("dismissed");
    start(async () => {
      const r = await confirmProposal(tenant, p);
      if (!r.ok) update("failed", [r.message, ...(r.issues ?? []).map((i) => i.message)].filter(Boolean).join(" "));
      else update(r.pending ? "pending" : "done", r.pending ? r.message : r.warnings?.join(" "));
      router.refresh();
    });
  }

  if (!open) return null;
  return (
    <aside aria-label="Assistant" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-canvas shadow-overlay">
      <header className="flex h-[var(--sw-topbar-height)] shrink-0 items-center gap-2 border-b px-4">
        <h2 className="font-medium">Ask</h2>
        <span className="text-xs text-ink-faint">Answers from your workspace data</span>
        <button type="button" onClick={onClose} aria-label="Close assistant" className="ml-auto flex size-8 items-center justify-center rounded-sw text-ink-muted hover:bg-surface-sunken">
          ×
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-5 pt-6 animate-rise">
            <div className="space-y-1.5">
              <p className="text-lg tracking-tight">What would you like to know?</p>
              <p className="text-sm text-ink-muted">Ask about records, totals and what needs attention. I can also prepare changes for you to confirm.</p>
            </div>
            <div className="divide-y rounded-sw border bg-surface">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="group flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm hover:bg-surface-sunken">
                  {s}
                  <span aria-hidden="true" className="text-ink-faint transition-transform group-hover:translate-x-0.5">→</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.kind === "user" ? (
            <div key={i} className="flex justify-end animate-rise">
              <p className="max-w-[85%] rounded-2xl bg-surface-sunken px-3.5 py-2 text-sm whitespace-pre-wrap">{t.text}</p>
            </div>
          ) : (
            <div key={i} className="space-y-3 animate-rise">
              {t.tools.length > 0 && (
                <p className="text-[11px] tracking-wide text-ink-faint">
                  {t.tools.map((u, j) => (
                    <span key={j} className={cx("mr-2", !u.ok && "line-through")}>
                      {TOOL_LABEL[u.name] ?? u.name} {u.record?.replaceAll("_", " ")}
                    </span>
                  ))}
                </p>
              )}
              <div className="text-sm">
                <RichText text={t.text} />
              </div>
              {t.proposals.map((p) => (
                <div key={p.id} className="rounded-sw border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
                  <p className="font-medium">{p.summary}</p>
                  <p className="text-xs text-ink-muted">
                    {p.kind === "create" ? "New" : p.kind === "update" ? "Change" : p.kind === "action" ? p.action?.replaceAll("_", " ") : `Turn into ${p.to?.replaceAll("_", " ")}`} · {p.recordLabel.toLowerCase()}
                  </p>
                  {p.state === undefined ? (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="primary" disabled={pending} onClick={() => decide(i, p, true)}>
                        Confirm
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(i, p, false)}>
                        Dismiss
                      </Button>
                    </div>
                  ) : (
                    <p className={cx("mt-1 text-xs", p.state === "failed" ? "text-danger-fg" : p.state === "pending" ? "text-warning-fg" : "text-ink-muted")}>
                      {p.state === "done" ? "Done." : p.state === "dismissed" ? "Dismissed." : p.state === "pending" ? "Waiting for approval." : "Not done."} {p.note}
                    </p>
                  )}
                </div>
              ))}
              {i === turns.length - 1 && !pending && t.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {t.suggestions.map((q) => (
                    <button key={q} type="button" onClick={() => ask(q)} className="inline-flex min-h-8 items-center rounded-full border border-border-strong bg-surface px-3 text-[13px] text-ink-muted transition-colors hover:border-ink-faint hover:text-ink">
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {pending && <Thinking label="Looking" />}
        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        )}
        <div ref={end} />
      </div>

      <div className="p-3">
        <Composer inputRef={input} label="Ask a question" value={draft} onChange={setDraft} onSend={() => ask(draft)} disabled={pending} placeholder="Ask about your business…" />
      </div>
    </aside>
  );
}
