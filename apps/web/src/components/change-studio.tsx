"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, cx } from "@shapewise/ui";
import { decideChange, draftSystemChange, loadStudio, undoLastChange, type ChangeRow, type StudioView } from "@/app/w/[tenant]/change-actions";

const EXAMPLES = [
  "Add a vehicle number and driver phone to delivery notes",
  "Keep a register of customer complaints with what happened and how we fixed it",
  "Warn when a sales order takes a customer over their credit limit",
  "Hide quotes, we never use them",
];

const STATUS: Record<ChangeRow["status"], { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-surface-sunken text-ink-muted" },
  pending: { label: "Waiting for approval", tone: "bg-warning-bg text-warning-fg" },
  applied: { label: "Applied", tone: "bg-success-bg text-success-fg" },
  rejected: { label: "Not applied", tone: "bg-surface-sunken text-ink-faint" },
};

/**
 * Change the setup by describing it. The AI drafts the change on top of the
 * live setup; you see exactly what it does before anything changes, then
 * apply it (or send it for approval). Every change can be undone.
 */
export function ChangeStudio({ tenant }: { tenant: string }) {
  const router = useRouter();
  const [view, setView] = useState<StudioView | null>(null);
  const [text, setText] = useState("");
  const [drafting, startDraft] = useTransition();
  const [busy, start] = useTransition();
  const [draft, setDraft] = useState<ChangeRow | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const refresh = async () => setView(await loadStudio(tenant));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  const ask = (t = text) => {
    if (t.trim().length < 3) return;
    setDraft(null);
    setQuestion(null);
    setStatus(null);
    startDraft(async () => {
      const r = await draftSystemChange(tenant, t);
      if (!r.ok) return setStatus({ ok: false, message: r.message ?? "Couldn't draft that." });
      if (r.question) return setQuestion(r.question);
      setDraft(r.change!);
      await refresh();
    });
  };
  const decide = (id: string, d: "apply" | "submit" | "reject" | "discard") =>
    start(async () => {
      const r = await decideChange(tenant, id, d);
      setStatus({ ok: r.ok, message: r.message ?? (r.ok ? "Done." : "That didn't work.") });
      if (r.ok) {
        setDraft(null);
        if (d === "apply") router.refresh();
      }
      await refresh();
    });

  if (!view) return <p className="animate-shimmer text-sm">Loading</p>;
  const pending = view.changes.filter((c) => c.status === "pending");
  const past = view.changes.filter((c) => c.status === "applied" || c.status === "rejected");

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        {view.canDraft ? (
          <section className="space-y-3 rounded-2xl border bg-surface p-5">
            <div>
              <h2 className="font-medium">Describe a change</h2>
              <p className="mt-0.5 text-sm text-ink-muted">New details to record, a new register, a rule, hiding a screen, switching a feature on. You'll see exactly what changes before anything does.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask();
              }}
              className="space-y-2"
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                aria-label="Describe a change"
                placeholder="e.g. Add a vehicle number to delivery notes"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
                }}
                className="w-full resize-none rounded-xl border border-border-strong bg-canvas px-3 py-2 text-sm leading-relaxed outline-none focus:border-focus"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="primary" disabled={drafting || text.trim().length < 3}>
                  {drafting ? "Drafting…" : "Draft the change"}
                </Button>
                {!drafting && !draft && (
                  <div className="flex flex-wrap gap-1.5">
                    {EXAMPLES.map((e) => (
                      <button key={e} type="button" onClick={() => setText(e)} className="rounded-full border border-border-strong px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink">
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </form>
            {drafting && <p className="animate-shimmer text-sm">Working out the change and checking it against your setup. This takes up to half a minute.</p>}
            {question && <p className="rounded-xl bg-surface-sunken px-3 py-2 text-sm">{question}</p>}
          </section>
        ) : (
          <p className="rounded-2xl border bg-surface px-5 py-4 text-sm text-ink-muted">Your role can see the setup's history but can't change it.</p>
        )}

        {draft && (
          <ChangeCard change={draft} highlight>
            {view.canApply ? (
              <>
                <Button variant="primary" disabled={busy} onClick={() => decide(draft.id, "apply")}>
                  Apply this change
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => decide(draft.id, "discard")}>
                  Discard
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" disabled={busy} onClick={() => decide(draft.id, "submit")}>
                  Send for approval
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => decide(draft.id, "discard")}>
                  Discard
                </Button>
              </>
            )}
          </ChangeCard>
        )}

        {status && (
          <p role={status.ok ? "status" : "alert"} className={cx("rounded-xl px-3 py-2 text-sm", status.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>
            {status.message}
          </p>
        )}

        {pending.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Waiting for approval</h3>
            {pending.map((c) => (
              <ChangeCard key={c.id} change={c}>
                {view.canApply && (
                  <>
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => decide(c.id, "apply")}>
                      Approve and apply
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(c.id, "reject")}>
                      Reject
                    </Button>
                  </>
                )}
              </ChangeCard>
            ))}
          </section>
        )}

        {past.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Recent changes</h3>
            {past.map((c) => (
              <ChangeCard key={c.id} change={c} />
            ))}
          </section>
        )}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
        <section className="rounded-2xl border bg-surface p-4">
          <h3 className="text-sm font-medium">Setup history</h3>
          <p className="mt-0.5 text-xs text-ink-muted">Now on version {view.version}. Going back makes a new version, so nothing is lost.</p>
          <ol className="mt-3 space-y-2">
            {view.history.slice(0, 8).map((h) => (
              <li key={h.version} className="flex gap-2 text-xs">
                <span className={cx("tabular shrink-0 rounded-full px-1.5", h.version === view.version ? "bg-accent-soft text-ink" : "bg-surface-sunken text-ink-muted")}>v{h.version}</span>
                <span className="min-w-0">
                  <span className="block text-ink">{h.summary || "Change"}</span>
                  <span className="block text-ink-faint">{h.createdAt ? new Date(h.createdAt).toLocaleString("en-LK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""}</span>
                </span>
              </li>
            ))}
          </ol>
          {view.canApply && view.history.some((h) => h.version < view.version) && (
            <Button
              size="sm"
              className="mt-3 w-full"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  if (!confirm("Go back to the previous version of the setup? Your records stay as they are.")) return;
                  const r = await undoLastChange(tenant);
                  setStatus({ ok: r.ok, message: r.ok ? `${r.message}${r.lines?.length ? ` ${r.lines.slice(0, 3).join(" ")}` : ""}` : (r.message ?? "Couldn't go back.") });
                  if (r.ok) router.refresh();
                  await refresh();
                })
              }
            >
              Undo the last change
            </Button>
          )}
        </section>
      </aside>
    </div>
  );
}

function ChangeCard({ change: c, highlight, children }: { change: ChangeRow; highlight?: boolean; children?: React.ReactNode }) {
  const s = STATUS[c.status];
  return (
    <article className={cx("space-y-3 rounded-2xl border bg-surface p-4 animate-rise", highlight && "border-accent/50 shadow-overlay")}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{c.summary}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            "{c.request}"{c.byName ? ` · ${c.byName}` : ""} · {new Date(c.createdAt).toLocaleString("en-LK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
        <span className={cx("rounded-full px-2 py-0.5 text-[11px]", s.tone)}>{s.label}</span>
      </div>
      <ul className="space-y-1 text-sm">
        {c.lines.map((l) => (
          <li key={l} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            {l}
          </li>
        ))}
      </ul>
      {c.notes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-ink-muted">
          {c.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {children && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
    </article>
  );
}
