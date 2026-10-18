"use client";

import { useEffect, useState, useTransition } from "react";
import type { BankRule } from "@shapewise/blueprint";
import { Button, cx } from "@shapewise/ui";
import { deleteBankRule, loadBankRules, previewStatement, recordStatement, saveBankRule, type BankRulesView, type StatementLine } from "@/app/w/[tenant]/money-actions";
import { formatMoney, formatValue } from "@/lib/format";

type Draft = Omit<BankRule, "id"> & { id?: string };
const EMPTY: Draft = { name: "", contains: "", direction: "out", account: "", vendor: "", taxCode: "", enabled: true };
const control = "h-9 w-full rounded-sw border border-border-strong bg-canvas px-2.5 text-sm outline-none focus:border-focus";

/**
 * Bank rules: "a line containing CEB is electricity, paid to Ceylon
 * Electricity Board". Paste a statement to see which lines a rule catches,
 * which are already recorded, and record the rest in one go.
 */
export function BankRules({ tenant }: { tenant: string }) {
  const [view, setView] = useState<BankRulesView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const refresh = async () => setView(await loadBankRules(tenant));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);
  if (!view) return <p className="animate-shimmer text-sm">Loading</p>;
  const label = (xs: { id: string; label: string }[], id?: string) => xs.find((x) => x.id === id)?.label;

  const save = () =>
    start(async () => {
      if (!draft) return;
      const r = await saveBankRule(tenant, draft);
      setStatus(r);
      if (r.ok) setDraft(null);
      await refresh();
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Rules</h2>
          {view.canEdit && !draft && (
            <Button size="sm" variant="primary" onClick={() => setDraft({ ...EMPTY })}>
              New rule
            </Button>
          )}
        </div>
        {status && <p role={status.ok ? "status" : "alert"} className={cx("rounded-sw px-3 py-2 text-sm", status.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>{status.message}</p>}
        {draft && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="grid gap-3 rounded-sw border bg-surface p-4 sm:grid-cols-2"
          >
            <label className="grid gap-1 text-xs text-ink-muted">
              Name
              <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Electricity" className={control} />
            </label>
            <label className="grid gap-1 text-xs text-ink-muted">
              When the description contains
              <input required value={draft.contains} onChange={(e) => setDraft({ ...draft, contains: e.target.value })} placeholder="CEB" className={control} />
            </label>
            <label className="grid gap-1 text-xs text-ink-muted">
              Money
              <select value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as Draft["direction"] })} className={control}>
                <option value="out">Going out</option>
                <option value="in">Coming in</option>
                <option value="any">Either way</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-ink-muted">
              Book it to
              <select required value={draft.account} onChange={(e) => setDraft({ ...draft, account: e.target.value })} className={control}>
                <option value="">Choose an account</option>
                {view.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-ink-muted">
              Supplier (optional)
              <select value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} className={control}>
                <option value="">None</option>
                {view.vendors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-ink-muted">
              Tax (optional)
              <select value={draft.taxCode} onChange={(e) => setDraft({ ...draft, taxCode: e.target.value })} className={control}>
                <option value="">No tax</option>
                {view.taxCodes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Save rule"}
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
        {view.rules.length === 0 && !draft ? (
          <p className="rounded-sw border bg-surface px-6 py-10 text-center text-sm text-ink-muted">No rules yet. Add one for each charge that shows up on your statement every month: bank fees, rent, electricity, water, phone.</p>
        ) : (
          <ul className="divide-y rounded-sw border bg-surface">
            {view.rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{r.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {r.direction === "in" ? "Money in" : r.direction === "any" ? "Money in or out" : "Money out"} containing “{r.contains}” → {label(view.accounts, r.account) ?? "No account"}
                    {r.vendor ? `, ${label(view.vendors, r.vendor) ?? "supplier"}` : ""}
                  </span>
                </span>
                {view.canEdit && (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => setDraft({ ...r, account: r.account ?? "", vendor: r.vendor ?? "", taxCode: r.taxCode ?? "" })} className="text-xs text-accent hover:underline">
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        start(async () => {
                          if (!confirm(`Remove the rule "${r.name}"?`)) return;
                          setStatus(await deleteBankRule(tenant, r.id));
                          await refresh();
                        })
                      }
                      className="text-xs text-ink-muted hover:text-danger-fg"
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Statement tenant={tenant} view={view} />
    </div>
  );
}

function Statement({ tenant, view }: { tenant: string; view: BankRulesView }) {
  const [bank, setBank] = useState(view.banks[0]?.id ?? "");
  const [text, setText] = useState("");
  const [lines, setLines] = useState<StatementLine[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const money = (n: number) => formatMoney(n, view.currency);
  const recordable = (lines ?? []).filter((l) => l.match.kind === "rule" && l.amount < 0);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Try them on a statement</h2>
      <div className="space-y-2 rounded-sw border bg-surface p-4">
        {view.banks.length > 1 && (
          <select value={bank} onChange={(e) => setBank(e.target.value)} aria-label="Bank account" className={control}>
            {view.banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          aria-label="Bank statement"
          placeholder={"Paste rows from your bank's CSV or Excel export, for example:\nDate, Description, Amount\n2026-10-03, CEB BILL PAYMENT 0412, -18,450.00\n2026-10-05, SERVICE CHARGE, -250.00"}
          className="w-full rounded-sw border border-border-strong bg-canvas px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-focus"
        />
        <Button
          variant="primary"
          disabled={busy || !text.trim() || !bank}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await previewStatement(tenant, bank, text);
              if (!r.ok) return setMsg({ ok: false, message: r.message ?? "Couldn't read that." });
              setLines(r.lines!);
              setPicked(new Set(r.lines!.filter((l) => l.match.kind === "rule" && l.amount < 0).map((l) => l.row)));
            })
          }
        >
          {busy && !lines ? "Reading…" : "Check the lines"}
        </Button>
        {!view.banks.length && <p className="text-xs text-danger-fg">Add a bank account first.</p>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={cx("rounded-sw px-3 py-2 text-sm", msg.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>{msg.message}</p>}
      {lines && (
        <>
          <p className="text-xs text-ink-muted">
            {lines.length} lines: {lines.filter((l) => l.match.kind === "rule").length} caught by a rule, {lines.filter((l) => l.match.kind === "recorded").length} already recorded, {lines.filter((l) => l.match.kind === "none").length} left for you.
          </p>
          <ul className="divide-y rounded-sw border bg-surface text-sm">
            {lines.map((l) => (
              <li key={l.row} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={`Record ${l.description}`}
                  disabled={!(l.match.kind === "rule" && l.amount < 0)}
                  checked={picked.has(l.row)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? new Set(p).add(l.row) : new Set([...p].filter((x) => x !== l.row))))}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{l.description || "No description"}</span>
                  <span className="block text-xs text-ink-muted">
                    {formatValue({ type: "date" }, l.date, { currency: "" })} ·{" "}
                    {l.match.kind === "rule" ? <span className="text-accent">{l.match.name}{l.amount > 0 ? ", money in isn't recorded automatically" : ""}</span> : l.match.kind === "recorded" ? <span className="text-success-fg">Already recorded as {l.match.label}</span> : "No rule matches"}
                  </span>
                </span>
                <span className={cx("tabular whitespace-nowrap", l.amount < 0 ? "" : "text-success-fg")}>{money(l.amount)}</span>
              </li>
            ))}
          </ul>
          {recordable.length > 0 && (
            <Button
              variant="primary"
              disabled={busy || picked.size === 0}
              onClick={() =>
                start(async () => {
                  const chosen = recordable.filter((l) => picked.has(l.row)).map((l) => ({ date: l.date, description: l.description, amount: l.amount, rule: (l.match as { rule: string }).rule }));
                  const r = await recordStatement(tenant, bank, chosen);
                  setMsg(r);
                  if (r.ok) {
                    setLines(null);
                    setText("");
                  }
                })
              }
            >
              {busy ? "Recording…" : `Record ${picked.size} as expenses`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
