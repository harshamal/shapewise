import { accountTotals, addDays, addMonths, monthStart, trialBalance } from "@shapewise/runtime/reports";
import { cx } from "@shapewise/ui";
import { BankRules } from "@/components/bank-rules";
import { BookCloseButtons } from "@/components/book-close-buttons";
import { formatMoney, formatValue } from "@/lib/format";
import { asDate, hrefFor, ledgerSnapshot, screenHref, today, type Query } from "@/lib/screens";
import type { Workspace } from "@/lib/workspace";
import { DateField, Filters, MaybeLink, Pill, Stat, Stats } from "./kit";

/** Money screens: bank rules, and closing the books for a period. */

export async function BankRulesScreen({ ws }: { ws: Workspace }) {
  return <BankRules tenant={ws.tenant} />;
}

interface Check {
  label: string;
  ok: boolean;
  detail: string;
  href?: string;
  /** Only worth knowing; doesn't stop a close. */
  soft?: boolean;
}

export async function BookClose({ ws, q }: { ws: Workspace; q: Query }) {
  const day = today(ws);
  const lock = ws.bp.settings.general.lockDate;
  const lastMonthEnd = addDays(monthStart(day), -1);
  const until = asDate(q.to, lastMonthEnd);
  const from = lock && lock < until ? addDays(lock, 1) : monthStart(until);
  const date = (d: string) => formatValue({ type: "date" }, d, { currency: "" });
  const money = (n: number) => formatMoney(n, ws.bp.business.currency);
  const s = await ledgerSnapshot(ws);
  const inPeriod = (d: unknown) => typeof d === "string" && d.slice(0, 10) <= until && (!lock || d.slice(0, 10) > lock);

  // Every document type that posts, with drafts or approvals still open in the period.
  const checks: Check[] = [];
  const drafts: { label: string; n: number; href?: string }[] = [];
  const waiting: { label: string; n: number; href?: string }[] = [];
  await ws.store.read(ws.tenant, async (tx) => {
    for (const t of ws.compiled.targets.values()) {
      if (!t.states.some((x) => x.key === "posted") || t.initial !== "draft") continue;
      const recs = (await tx.list(t.target)).filter((r) => inPeriod(r.data.date));
      const d = recs.filter((r) => r.status === "draft").length;
      const w = recs.filter((r) => r.pendingApproval).length;
      if (d) drafts.push({ label: t.labelPlural.toLowerCase(), n: d, href: hrefFor(ws, t.target) });
      if (w) waiting.push({ label: t.labelPlural.toLowerCase(), n: w, href: hrefFor(ws, t.target) });
    }
    checks.push({
      label: "Every document is posted",
      ok: drafts.length === 0,
      detail: drafts.length ? `Still drafts: ${drafts.map((x) => `${x.n} ${x.label}`).join(", ")}.` : "No drafts dated in the period.",
      href: drafts[0]?.href,
    });
    checks.push({ label: "Nothing waiting for approval", ok: waiting.length === 0, detail: waiting.length ? `Waiting: ${waiting.map((x) => `${x.n} ${x.label}`).join(", ")}.` : "No approvals pending for the period.", href: waiting.length ? screenHref(ws, "approvals") : undefined });
    if (ws.compiled.targets.has("pos_shift")) {
      const open = (await tx.list("pos_shift")).filter((x) => x.status === "open" && typeof x.data.opened_at === "string" && x.data.opened_at.slice(0, 10) <= until);
      checks.push({ label: "Till shifts are closed", ok: open.length === 0, detail: open.length ? `${open.length} ${open.length === 1 ? "shift is" : "shifts are"} still open, so their takings aren't in the books.` : "Every shift in the period is closed and posted.", href: hrefFor(ws, "pos_shift") });
    }
    if (ws.compiled.targets.has("cheque")) {
      const pending = (await tx.list("cheque")).filter((x) => (x.status === "pending" || x.status === "deposited") && typeof x.data.cheque_date === "string" && x.data.cheque_date <= until);
      checks.push({ label: "Cheques are cleared", ok: pending.length === 0, soft: true, detail: pending.length ? `${pending.length} ${pending.length === 1 ? "cheque hasn't" : "cheques haven't"} cleared yet. That's fine to close with; they post when they clear.` : "No cheques waiting to clear.", href: hrefFor(ws, "cheque") });
    }
  });
  const tb = trialBalance(s, until);
  checks.push({ label: "The books balance", ok: tb.balanced, detail: tb.balanced ? `Debits and credits agree at ${money(tb.debit)}.` : `Out by ${money(Math.abs(tb.debit - tb.credit))}. Look at recent manual journals.`, href: screenHref(ws, "trial_balance") });

  const period = accountTotals(s, { from, to: until });
  const sum = (kinds: string[]) => period.filter((a) => kinds.includes(a.kind)).reduce((t, a) => t + a.balance, 0);
  const income = sum(["income"]);
  const costs = sum(["cost_of_sales", "expense"]);
  const hard = checks.filter((c) => !c.ok && !c.soft);
  const owner = Boolean(ws.bp.roles.find((r) => r.key === ws.actor.roleKey)?.owner);
  const canClose = ws.compiled.can(ws.actor.roleKey, "book_close", "manage");
  const months = [0, 1, 2].map((i) => addDays(monthStart(addMonths(day, -i)), -1));

  return (
    <div className="space-y-5">
      <div className={cx("rounded-sw border p-4", lock ? "bg-surface" : "bg-surface-sunken/50")}>
        <p className="text-sm text-ink-muted">Books closed up to</p>
        <p className="text-lg font-medium">{lock ? date(lock) : "Not closed yet"}</p>
        <p className="mt-1 text-sm text-ink-muted">{lock ? `Nothing dated on or before ${date(lock)} can be added, changed, posted or voided. New entries go in later periods.` : "Close each month once it's done, so nobody can change figures you've already reported or filed."}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Filters submit="Check">
          <DateField name="to" label="Close up to" value={until} />
        </Filters>
        <div className="flex flex-wrap gap-1.5 print:hidden">
          {months.map((m) => (
            <a key={m} href={`?to=${m}`} className={cx("rounded-full border px-2.5 py-1 text-xs", m === until ? "border-accent bg-accent-soft" : "text-ink-muted hover:text-ink")}>
              {new Date(`${m}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
            </a>
          ))}
        </div>
      </div>

      {lock && until <= lock ? (
        <p className="rounded-sw bg-info-bg px-3 py-2 text-sm text-info-fg">The books are already closed up to {date(lock)}. Pick a later date to close the next period.</p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-medium">{lock ? `Before you close ${date(from)} to ${date(until)}` : `Before you close everything up to ${date(until)}`}</h2>
            <ul className="divide-y rounded-sw border bg-surface">
              {checks.map((c) => (
                <li key={c.label} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <span className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px]", c.ok ? "bg-success-bg text-success-fg" : c.soft ? "bg-warning-bg text-warning-fg" : "bg-danger-bg text-danger-fg")} aria-hidden="true">
                    {c.ok ? "✓" : "!"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{c.label}</span>
                    <span className="block text-ink-muted">{c.detail}</span>
                  </span>
                  {!c.ok && c.href && (
                    <MaybeLink href={c.href} className="shrink-0 text-xs text-accent">
                      Open
                    </MaybeLink>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <Stats>
            <Stat label={`Income, ${date(from)} to ${date(until)}`} value={money(income)} />
            <Stat label="Costs and expenses" value={money(costs)} />
            <Stat label={income - costs >= 0 ? "Profit" : "Loss"} value={money(income - costs)} tone={income - costs >= 0 ? "good" : "bad"} />
            <Stat label="Ready to close" value={hard.length === 0 ? "Yes" : `${hard.length} to sort`} tone={hard.length ? "warn" : "good"} />
          </Stats>

          {canClose ? (
            <BookCloseButtons tenant={ws.tenant} date={until} label={date(until)} lockDate={lock} canReopen={owner} warn={hard.length > 0} />
          ) : (
            <p className="text-sm text-ink-muted">Your role can see this checklist but can't close the books.</p>
          )}
        </>
      )}
      {lock && until <= lock && canClose && <BookCloseButtons tenant={ws.tenant} date={until} label={date(until)} lockDate={lock} canReopen={owner} warn={false} />}
      {hard.length === 0 && (!lock || until > lock) && <Pill tone="good">Everything in the period is in order</Pill>}
    </div>
  );
}
