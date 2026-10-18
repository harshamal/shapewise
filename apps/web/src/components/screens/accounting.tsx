import Link from "next/link";
import { titleOf } from "@shapewise/runtime";
import { RECORD_REPORTS, accountTotals, kindOf, ledgerLines, trialBalance, type Period, type ReportBody, type ReportRow } from "@shapewise/runtime/reports";
import { cx } from "@shapewise/ui";
import { DocumentButtons } from "@/components/document-buttons";
import { PrintButton } from "@/components/print-button";
import { formatMoney, formatValue } from "@/lib/format";
import { asDate, hrefFor, ledgerSnapshot, screenHref, today, yearStart, type Query } from "@/lib/screens";
import { buildStatement, statementSnapshot } from "@/lib/statements";
import type { Workspace } from "@/lib/workspace";
import { DateField, Empty, Filters, MaybeLink, Pill, SelectField, Stat, Stats, Table, Tabs, td, tdNum, th, thNum, withQuery } from "./kit";

/**
 * Accounting screens over the books the engine keeps: the general ledger,
 * the trial balance, the financial statements and customer statements.
 * Everything is worked out from posted journal entries, so the screens
 * always agree with each other.
 */

const DEBIT_NORMAL = new Set(["asset", "expense", "cost_of_sales"]);

function useMoney(ws: Workspace) {
  const currency = ws.bp.business.currency;
  return {
    money: (n: number) => formatMoney(n, currency),
    blank: (n: number) => (n ? formatMoney(n, currency) : ""),
    date: (d: string) => formatValue({ type: "date" }, d, { currency }),
  };
}

/* ----------------------------------------------------------- general ledger */

export async function GeneralLedger({ ws, q, here }: { ws: Workspace; q: Query; here: string }) {
  const day = today(ws);
  const from = asDate(q.from, yearStart(ws, day));
  const to = asDate(q.to, day);
  const s = await ledgerSnapshot(ws);
  const { money, blank, date } = useMoney(ws);
  const accounts = s.list("account").sort((a, b) => String(a.data.code ?? "").localeCompare(String(b.data.code ?? "")));
  const account = q.account ? s.get("account", q.account) : undefined;

  const filters = (
    <Filters>
      <SelectField name="account" label="Account" value={q.account} placeholder="All accounts" options={accounts.map((a) => ({ value: a.id, label: `${a.data.code ?? ""} ${a.data.name ?? ""}`.trim() }))} />
      <DateField name="from" label="From" value={from} />
      <DateField name="to" label="To" value={to} />
    </Filters>
  );

  if (!account) {
    const before = new Map(accountTotals(s, { to: dayBefore(from) }).map((a) => [a.account, a.balance]));
    const during = accountTotals(s, { from, to });
    const ids = new Set([...before.keys(), ...during.map((a) => a.account)]);
    const rows = accounts
      .filter((a) => ids.has(a.id))
      .map((a) => {
        const d = during.find((x) => x.account === a.id);
        const debitNormal = DEBIT_NORMAL.has(kindOf(s, a));
        const opening = before.get(a.id) ?? 0;
        const debit = d?.debit ?? 0;
        const credit = d?.credit ?? 0;
        return { a, opening, debit, credit, closing: opening + (debitNormal ? debit - credit : credit - debit) };
      });
    return (
      <div className="space-y-4">
        {filters}
        {rows.length === 0 ? (
          <Empty>Nothing has been posted yet. Posting an invoice, bill or payment writes its entries here.</Empty>
        ) : (
          <Table>
            <thead>
              <tr className="border-b">
                <th className={th}>Code</th>
                <th className={th}>Account</th>
                <th className={thNum}>Opening</th>
                <th className={thNum}>Debits</th>
                <th className={thNum}>Credits</th>
                <th className={thNum}>Closing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.a.id} className="border-b last:border-0 hover:bg-surface-sunken">
                  <td className={cx(td, "tabular text-ink-muted")}>{String(r.a.data.code ?? "")}</td>
                  <td className={td}>
                    <Link href={withQuery(here, { from: q.from, to: q.to }, { account: r.a.id }) as never} className="hover:underline">
                      {String(r.a.data.name ?? "Account")}
                    </Link>
                  </td>
                  <td className={tdNum}>{money(r.opening)}</td>
                  <td className={tdNum}>{blank(r.debit)}</td>
                  <td className={tdNum}>{blank(r.credit)}</td>
                  <td className={cx(tdNum, "font-medium")}>{money(r.closing)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="text-xs text-ink-faint">Balances are shown on each account's usual side: debit for assets and expenses, credit for liabilities, equity and income. Open an account to see every entry.</p>
      </div>
    );
  }

  const debitNormal = DEBIT_NORMAL.has(kindOf(s, account));
  const sign = (debit: number, credit: number) => (debitNormal ? debit - credit : credit - debit);
  const opening = ledgerLines(s, { to: dayBefore(from) })
    .filter((l) => l.account === account.id)
    .reduce((t, l) => t + sign(l.debit, l.credit), 0);
  const lines = ledgerLines(s, { from, to })
    .filter((l) => l.account === account.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  let running = opening;
  const rows = lines.map((l) => ({ l, balance: (running += sign(l.debit, l.credit)) }));
  const debits = lines.reduce((t, l) => t + l.debit, 0);
  const credits = lines.reduce((t, l) => t + l.credit, 0);

  return (
    <div className="space-y-4">
      {filters}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-medium">
          {String(account.data.code ?? "")} {String(account.data.name ?? "")}
        </h2>
        <Link href={withQuery(here, { from: q.from, to: q.to }, {}) as never} className="text-sm text-accent hover:underline print:hidden">
          All accounts
        </Link>
      </div>
      <Stats>
        <Stat label={`Opening, ${date(from)}`} value={money(opening)} />
        <Stat label="Debits" value={money(debits)} />
        <Stat label="Credits" value={money(credits)} />
        <Stat label={`Closing, ${date(to)}`} value={money(running)} />
      </Stats>
      {rows.length === 0 ? (
        <Empty>No entries on this account between these dates.</Empty>
      ) : (
        <Table>
          <thead>
            <tr className="border-b">
              <th className={th}>Date</th>
              <th className={th}>Document</th>
              <th className={th}>Details</th>
              <th className={thNum}>Debit</th>
              <th className={thNum}>Credit</th>
              <th className={thNum}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, balance }, i) => (
              <tr key={`${l.entry}-${i}`} className="border-b last:border-0">
                <td className={cx(td, "tabular whitespace-nowrap text-ink-muted")}>{date(l.date)}</td>
                <td className={cx(td, "whitespace-nowrap")}>
                  <MaybeLink href={hrefFor(ws, l.source_target, l.source_id)} className="text-accent">
                    {s.title(l.source_target, l.source_id) || l.source_target}
                  </MaybeLink>
                </td>
                <td className={cx(td, "text-ink-muted")}>{l.party ? s.title(l.party.target, l.party.id) : l.memo && !/^Post: /.test(l.memo) ? l.memo : ""}</td>
                <td className={tdNum}>{blank(l.debit)}</td>
                <td className={tdNum}>{blank(l.credit)}</td>
                <td className={cx(tdNum, "font-medium")}>{money(balance)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ trial balance */

export async function TrialBalance({ ws, q }: { ws: Workspace; q: Query }) {
  const day = today(ws);
  const to = asDate(q.to, day);
  const s = await ledgerSnapshot(ws);
  const { money, blank, date } = useMoney(ws);
  const tb = trialBalance(s, to);
  const gl = screenHref(ws, "general_ledger");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Filters>
          <DateField name="to" label="As at" value={to} />
        </Filters>
        <PrintButton />
      </div>
      {tb.rows.length === 0 ? (
        <Empty>Nothing has been posted yet.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-medium">Trial balance as at {date(to)}</h2>
            {tb.balanced ? <Pill tone="good">The books balance</Pill> : <Pill tone="bad">Out by {money(Math.abs(tb.debit - tb.credit))}</Pill>}
          </div>
          <Table>
            <thead>
              <tr className="border-b">
                <th className={th}>Code</th>
                <th className={th}>Account</th>
                <th className={thNum}>Debit</th>
                <th className={thNum}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r) => (
                <tr key={r.account} className="border-b last:border-0 hover:bg-surface-sunken">
                  <td className={cx(td, "tabular text-ink-muted")}>{r.code}</td>
                  <td className={td}>
                    <MaybeLink href={gl ? `${gl}?account=${r.account}&from=${yearStart(ws, to)}&to=${to}` : undefined}>{r.name}</MaybeLink>
                  </td>
                  <td className={tdNum}>{blank(r.debit)}</td>
                  <td className={tdNum}>{blank(r.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-surface-sunken font-medium">
                <td className={td} colSpan={2}>
                  Total
                </td>
                <td className={tdNum}>{money(tb.debit)}</td>
                <td className={tdNum}>{money(tb.credit)}</td>
              </tr>
            </tfoot>
          </Table>
        </>
      )}
      <p className="text-xs text-ink-faint print:hidden">Every posted entry up to the date. Open an account to see its entries in the general ledger.</p>
    </div>
  );
}

/* ----------------------------------------------------- financial statements */

const VIEWS = [
  { key: "pl", label: "Profit and loss" },
  { key: "bs", label: "Balance sheet" },
  { key: "cf", label: "Cash flow" },
] as const;

export async function FinancialStatements({ ws, q, here }: { ws: Workspace; q: Query; here: string }) {
  const day = today(ws);
  const view = VIEWS.find((v) => v.key === q.view)?.key ?? "pl";
  const from = asDate(q.from, yearStart(ws, day));
  const to = asDate(q.to, day);
  const s = await ledgerSnapshot(ws);
  const { date } = useMoney(ws);
  const range: Period = { key: "quarter", label: `${date(from)} to ${date(to)}`, from, to };
  const ctx = { today: to, timezone: ws.bp.business.timezone, range };
  const body: ReportBody =
    view === "pl" ? RECORD_REPORTS.profit_and_loss!.run(s, ctx) : view === "bs" ? RECORD_REPORTS.balance_sheet!.run(s, { ...ctx, range: undefined }) : RECORD_REPORTS.cash_flow!.run(s, ctx);
  const title = view === "bs" ? `Balance sheet as at ${date(to)}` : `${VIEWS.find((v) => v.key === view)!.label}, ${range.label}`;

  return (
    <div className="space-y-4">
      <Tabs active={view} tabs={VIEWS.map((v) => ({ key: v.key, label: v.label, href: withQuery(here, { from: q.from, to: q.to }, { view: v.key }) }))} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Filters keep={{ view }}>
          {view !== "bs" && <DateField name="from" label="From" value={from} />}
          <DateField name="to" label={view === "bs" ? "As at" : "To"} value={to} />
        </Filters>
        <PrintButton />
      </div>
      <section className="space-y-3 rounded-sw border bg-surface p-5 sm:p-6">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-sm text-ink-muted">{ws.bp.business.legalName || ws.bp.business.name}</p>
            <h2 className="text-lg font-medium">{title}</h2>
          </div>
          {body.headline && body.headline.value !== null && (
            <p className="text-right">
              <span className="block text-xs text-ink-muted">{view === "pl" ? (body.headline.value >= 0 ? "Profit" : "Loss") : body.headline.label}</span>
              <span className={cx("tabular text-xl font-medium", view === "pl" && (body.headline.value >= 0 ? "text-success-fg" : "text-danger-fg"))}>{formatMoney(body.headline.value, ws.bp.business.currency)}</span>
            </p>
          )}
        </header>
        {body.rows.length === 0 ? <Empty>{body.empty}</Empty> : <Statement body={body} currency={ws.bp.business.currency} />}
        {body.note && <p className="text-xs text-ink-faint">{body.note}</p>}
      </section>
    </div>
  );
}

/** A statement table: headings, account lines, and bold subtotals. */
function Statement({ body, currency }: { body: ReportBody; currency: string }) {
  const money = body.columns.filter((c) => c.type === "money");
  const cell = (v: ReportRow[string] | undefined) => (typeof v === "number" ? formatMoney(v, currency) : "");
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className={cx(th, "px-0")}>Account</th>
          {money.map((c) => (
            <th key={c.key} className={cx(thNum, "pr-0")}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.rows.map((r, i) => {
          const heading = Boolean(r.heading);
          const subtotal = !heading && !r.code && typeof r.label === "string" && /^(Total|Gross|Cash at|Profit not)/.test(r.label);
          return (
            <tr key={i} className={cx(heading && "border-t", subtotal && "border-t font-medium")}>
              <td className={cx("py-1.5", heading ? "pt-4 text-xs tracking-wide text-ink-muted uppercase" : r.code ? "pl-4" : "")}>
                {r.code ? <span className="mr-2 tabular text-ink-faint">{r.code}</span> : null}
                {String(r.label ?? "")}
              </td>
              {money.map((c) => (
                <td key={c.key} className={cx("tabular py-1.5 text-right whitespace-nowrap", c.key === "previous" && "text-ink-muted")}>
                  {heading ? "" : cell(r[c.key])}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
      {body.totals && (
        <tfoot>
          <tr className="border-t-2 border-ink font-semibold">
            <td className="py-2">{String(body.totals.label ?? "Total")}</td>
            {money.map((c) => (
              <td key={c.key} className="tabular py-2 text-right whitespace-nowrap">
                {cell(body.totals![c.key])}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/* ------------------------------------------------------ customer statements */

export async function CustomerStatements({ ws, q, here }: { ws: Workspace; q: Query; here: string }) {
  const day = today(ws);
  const from = asDate(q.from, yearStart(ws, day));
  const to = asDate(q.to, day);
  const s = await statementSnapshot(ws);
  const { money, blank, date } = useMoney(ws);
  const ct = ws.compiled.targets.get("customer");
  const customers = s
    .list("customer")
    .filter((c) => c.status !== "archived")
    .map((c) => ({ c, name: ct ? titleOf(ct, c) : String(c.data.name ?? "Customer"), balance: Number(c.data.balance ?? 0) }))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  const st = q.customer ? buildStatement(s, q.customer, from, to, day) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Filters>
          <SelectField name="customer" label="Customer" value={q.customer} placeholder="Choose a customer" options={customers.map((c) => ({ value: c.c.id, label: c.balance ? `${c.name} (${money(c.balance)})` : c.name }))} />
          <DateField name="from" label="From" value={from} />
          <DateField name="to" label="To" value={to} />
        </Filters>
        {st && <DocumentButtons tenant={ws.tenant} target="statement" id={st.customer.id} label="Statement" statement={{ from, to }} />}
      </div>

      {!st ? (
        customers.length === 0 ? (
          <Empty>Add customers and post invoices to send statements.</Empty>
        ) : (
          <Table>
            <thead>
              <tr className="border-b">
                <th className={th}>Customer</th>
                <th className={thNum}>Owes you</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.c.id} className="border-b last:border-0 hover:bg-surface-sunken">
                  <td className={td}>
                    <Link href={withQuery(here, { from: q.from, to: q.to }, { customer: c.c.id }) as never} className="hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className={cx(tdNum, c.balance > 0 ? "font-medium" : "text-ink-faint")}>{money(c.balance)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-medium">
              {st.name}, {date(from)} to {date(to)}
            </h2>
            <Link href={withQuery(here, { from: q.from, to: q.to }, {}) as never} className="text-sm text-accent hover:underline">
              All customers
            </Link>
          </div>
          <Stats>
            <Stat label="Opening balance" value={money(st.opening)} />
            <Stat label="Charged" value={money(st.rows.reduce((t, r) => t + r.debit, 0))} />
            <Stat label="Paid and credited" value={money(st.rows.reduce((t, r) => t + r.credit, 0))} />
            <Stat label="Balance due" value={money(st.closing)} tone={st.closing > 0 ? "warn" : undefined} />
          </Stats>
          {st.rows.length === 0 ? (
            <Empty>Nothing was invoiced or paid between these dates.</Empty>
          ) : (
            <Table>
              <thead>
                <tr className="border-b">
                  <th className={th}>Date</th>
                  <th className={th}>Document</th>
                  <th className={thNum}>Charges</th>
                  <th className={thNum}>Payments</th>
                  <th className={thNum}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {st.rows.map((r, i) => (
                  <tr key={`${r.id}-${i}`} className="border-b last:border-0">
                    <td className={cx(td, "tabular whitespace-nowrap text-ink-muted")}>{date(r.date)}</td>
                    <td className={td}>
                      <MaybeLink href={hrefFor(ws, r.target, r.id)} className="text-accent">
                        {r.document}
                      </MaybeLink>
                      {r.memo && r.memo !== r.document && <span className="block text-xs text-ink-muted">{r.memo}</span>}
                    </td>
                    <td className={tdNum}>{blank(r.debit)}</td>
                    <td className={tdNum}>{blank(r.credit)}</td>
                    <td className={cx(tdNum, "font-medium")}>{money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {st.aging.some((a) => a.amount) && (
            <div className="grid gap-px overflow-hidden rounded-sw border bg-border sm:grid-cols-5">
              {st.aging.map((a) => (
                <div key={a.key} className="bg-surface p-3">
                  <p className="text-xs text-ink-muted">{a.key === "current" ? a.label : `${a.label} late`}</p>
                  <p className={cx("tabular mt-0.5 text-sm font-medium", a.key !== "current" && a.amount > 0 && "text-danger-fg")}>{money(a.amount)}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- utils */

function dayBefore(d: string) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

