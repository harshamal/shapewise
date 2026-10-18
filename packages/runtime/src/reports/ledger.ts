import { JOURNAL } from "../engines/context";
import type { StoredLine } from "../engines/books";
import { taxList, taxParts, type BusinessTaxes, type TaxDef, type TaxKind } from "@shapewise/blueprint";
import type { StoredRecord } from "../store";
import { groupSum, num, previousPeriod, str, within, type ReportImpl, type ReportRow, type Snapshot } from "./engine";
import { saleLines } from "./sales";

/**
 * Reports read from the books the accounting engine keeps: journal entries
 * (lines in minor units, debit and credit) and the chart of accounts.
 * Balances are worked out from the entries, so a report can be run as at
 * any date and always agrees with the trial balance.
 */

const LEDGER_READS = [JOURNAL, "account"] as const;

export interface LedgerLine extends StoredLine {
  date: string;
  entry: string;
  source_target: string;
  source_id: string;
  action: string;
}

export function ledgerLines(s: Snapshot, range?: { from?: string; to?: string }): LedgerLine[] {
  const out: LedgerLine[] = [];
  for (const e of s.list(JOURNAL)) {
    const date = String(e.data.date);
    if (range?.from && date < range.from) continue;
    if (range?.to && date > range.to) continue;
    for (const l of (e.data.lines as StoredLine[]) ?? []) out.push({ ...l, date, entry: e.id, source_target: String(e.data.source_target), source_id: String(e.data.source_id), action: String(e.data.action) });
  }
  return out;
}

type Kind = "asset" | "liability" | "equity" | "income" | "cost_of_sales" | "expense";

/** Where an account sits in the reports: cost of sales is an expense under the 5000 heading (or marked cogs). */
export function kindOf(s: Snapshot, acc: StoredRecord | undefined): Kind {
  const type = String(acc?.data.type ?? "expense");
  if (type !== "expense") return type as Kind;
  if (acc?.data.subtype === "cogs" || String(acc?.data.code ?? "").startsWith("5")) return "cost_of_sales";
  const parent = s.get("account", acc?.data.parent);
  return parent && String(parent.data.code ?? "").startsWith("5") ? "cost_of_sales" : "expense";
}

const DEBIT_NORMAL = new Set<Kind>(["asset", "expense", "cost_of_sales"]);

/** Per account: debits, credits and the balance on its normal side. */
export function accountTotals(s: Snapshot, range?: { from?: string; to?: string }) {
  const by = new Map<string, { account: string; debit: number; credit: number }>();
  for (const l of ledgerLines(s, range)) {
    const a = by.get(l.account) ?? { account: l.account, debit: 0, credit: 0 };
    a.debit += l.debit;
    a.credit += l.credit;
    by.set(l.account, a);
  }
  return [...by.values()].map((a) => {
    const acc = s.get("account", a.account);
    const kind = kindOf(s, acc);
    return { ...a, code: str(acc?.data.code) ?? "", name: str(acc?.data.name) ?? "Unknown account", kind, balance: DEBIT_NORMAL.has(kind) ? a.debit - a.credit : a.credit - a.debit };
  }).sort((x, y) => x.code.localeCompare(y.code));
}

/** Debits against credits for every account, as at a date. */
export function trialBalance(s: Snapshot, to?: string) {
  const rows = accountTotals(s, { to }).map((a) => {
    const net = a.debit - a.credit;
    return { code: a.code, name: a.name, account: a.account, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  }).filter((r) => r.debit || r.credit);
  const debit = rows.reduce((t, r) => t + r.debit, 0);
  const credit = rows.reduce((t, r) => t + r.credit, 0);
  return { rows, debit, credit, balanced: debit === credit };
}

const accountColumns = [
  { key: "code", label: "Code", type: "text" as const },
  { key: "label", label: "Account", type: "text" as const },
];

export const trialBalanceReport: ReportImpl = {
  reads: LEDGER_READS,
  run(s, ctx) {
    const tb = trialBalance(s, ctx.today);
    return {
      headline: { label: tb.balanced ? "The books balance" : "Out of balance by", value: Math.abs(tb.debit - tb.credit), unit: "money" },
      columns: [...accountColumns, { key: "debit", label: "Debit", type: "money" }, { key: "credit", label: "Credit", type: "money" }],
      rows: tb.rows.map((r) => ({ code: r.code, label: r.name, debit: r.debit || null, credit: r.credit || null })),
      totals: { code: "", label: "Total", debit: tb.debit, credit: tb.credit },
      note: "Every posted entry to date. Total debits equal total credits when the books balance.",
      empty: "Nothing has been posted yet.",
    };
  },
};

export const profitAndLoss: ReportImpl = {
  reads: LEDGER_READS,
  period: "month",
  run(s, ctx) {
    const range = ctx.range!;
    const now = accountTotals(s, range);
    const before = new Map(accountTotals(s, previousPeriod(range)).map((a) => [a.account, a.balance]));
    const section = (kind: Kind, label: string) => {
      const accs = now.filter((a) => a.kind === kind && a.balance !== 0);
      const total = accs.reduce((t, a) => t + a.balance, 0);
      const prev = [...before.entries()].filter(([id]) => kindOf(s, s.get("account", id)) === kind).reduce((t, [, v]) => t + v, 0);
      return { total, prev, rows: [{ code: "", label, amount: null, previous: null, heading: 1 } as ReportRow, ...accs.map((a) => ({ code: a.code, label: a.name, amount: a.balance, previous: before.get(a.account) ?? 0 }))] };
    };
    const inc = section("income", "Income");
    const cos = section("cost_of_sales", "Cost of sales");
    const exp = section("expense", "Expenses");
    const gross = inc.total - cos.total;
    const net = gross - exp.total;
    const rows: ReportRow[] = [
      ...inc.rows,
      ...cos.rows,
      { code: "", label: "Gross profit", amount: gross, previous: inc.prev - cos.prev },
      ...exp.rows,
    ];
    return {
      headline: { label: net >= 0 ? `Profit ${range.label.toLowerCase()}` : `Loss ${range.label.toLowerCase()}`, value: net, unit: "money" },
      columns: [...accountColumns, { key: "amount", label: range.label, type: "money" }, { key: "previous", label: "Period before", type: "money" }],
      rows: now.length ? rows : [],
      totals: { code: "", label: "Net profit", amount: net, previous: inc.prev - cos.prev - exp.prev },
      note: "Income less cost of sales and expenses, from posted entries in the period.",
      empty: "Nothing has been posted in this period yet.",
    };
  },
};

export const balanceSheet: ReportImpl = {
  reads: LEDGER_READS,
  run(s, ctx) {
    const all = accountTotals(s, { to: ctx.today });
    const of = (k: Kind) => all.filter((a) => a.kind === k && a.balance !== 0);
    const sum = (xs: { balance: number }[]) => xs.reduce((t, a) => t + a.balance, 0);
    const profit = sum(of("income")) - sum(of("cost_of_sales")) - sum(of("expense"));
    const assets = sum(of("asset"));
    const liabilities = sum(of("liability"));
    const equity = sum(of("equity")) + profit;
    const rows: ReportRow[] = [
      { code: "", label: "What you own", amount: null, heading: 1 },
      ...of("asset").map((a) => ({ code: a.code, label: a.name, amount: a.balance })),
      { code: "", label: "Total assets", amount: assets },
      { code: "", label: "What you owe", amount: null, heading: 1 },
      ...of("liability").map((a) => ({ code: a.code, label: a.name, amount: a.balance })),
      { code: "", label: "Total liabilities", amount: liabilities },
      { code: "", label: "Owner's equity", amount: null, heading: 1 },
      ...of("equity").map((a) => ({ code: a.code, label: a.name, amount: a.balance })),
      { code: "", label: "Profit not yet closed to retained earnings", amount: profit },
      { code: "", label: "Total equity", amount: equity },
    ];
    return {
      headline: { label: "Net assets", value: assets - liabilities, unit: "money" },
      columns: [...accountColumns, { key: "amount", label: "Balance", type: "money" }],
      rows: all.length ? rows : [],
      totals: { code: "", label: "Liabilities and equity", amount: liabilities + equity },
      note: "Balances of every account today. Assets equal liabilities plus equity.",
      empty: "Nothing has been posted yet.",
    };
  },
};

const CASH_ROLES = new Set(["cash", "bank"]);

/** Accounts that hold money: those a bank or cash line has posted to, or subtyped cash or bank. */
function cashAccounts(s: Snapshot): Set<string> {
  const ids = new Set<string>();
  for (const a of s.list("account")) if (a.data.subtype === "cash" || a.data.subtype === "bank") ids.add(a.id);
  for (const l of ledgerLines(s)) if (l.bank_account || (l.role && CASH_ROLES.has(l.role))) ids.add(l.account);
  return ids;
}

export const cashPosition: ReportImpl = {
  reads: [...LEDGER_READS, "bank_account"],
  run(s, ctx) {
    const banks = s.list("bank_account").filter((b) => b.status !== "archived");
    const ids = cashAccounts(s);
    const ledger = accountTotals(s, { to: ctx.today }).filter((a) => ids.has(a.account)).reduce((t, a) => t + a.balance, 0);
    const rows: ReportRow[] = banks.map((b) => ({ label: str(b.data.name) ?? "Account", kind: str(b.data.kind) ?? "bank", balance: num(b.data.balance) }));
    const named = rows.reduce((t, r) => t + num(r.balance), 0);
    if (ledger !== named) rows.push({ label: "Not linked to a bank or cash account", kind: "", balance: ledger - named });
    return {
      headline: { label: "Cash and bank", value: ledger, unit: "money", items: rows.filter((r) => num(r.balance) !== 0).map((r) => ({ label: String(r.label), value: num(r.balance) })) },
      columns: [{ key: "label", label: "Account", type: "text" }, { key: "kind", label: "Kind", type: "text" }, { key: "balance", label: "Balance", type: "money" }],
      rows,
      totals: { label: "Total", kind: "", balance: ledger },
      note: "Money in every bank and cash account today, from posted receipts, payments and other entries.",
      empty: "Add a bank or cash account to see your cash.",
    };
  },
};

const SOURCE_LABEL: Record<string, string> = {
  receipt: "Customers paid",
  payment: "Suppliers paid",
  expense: "Expenses paid",
  vendor_advance: "Advances to suppliers",
  pos_shift: "Counter takings",
  pos_sale: "Counter refunds",
  cheque: "Cheques cleared",
  vat_return: "VAT paid",
  journal: "Journals",
};

export const cashFlow: ReportImpl = {
  reads: LEDGER_READS,
  period: "month",
  run(s, ctx) {
    const range = ctx.range!;
    const ids = cashAccounts(s);
    const moves = ledgerLines(s, range).filter((l) => ids.has(l.account));
    const groups = groupSum(moves, (l) => SOURCE_LABEL[l.source_target] ?? "Other", (l) => l.debit - l.credit);
    const opening = accountTotals(s, { to: dayBefore(range.from) }).filter((a) => ids.has(a.account)).reduce((t, a) => t + a.balance, 0);
    const net = groups.reduce((t, g) => t + g.value, 0);
    return {
      headline: { label: `Net cash ${range.label.toLowerCase()}`, value: net, unit: "money" },
      columns: [{ key: "label", label: "From", type: "text" }, { key: "amount", label: "In or out", type: "money" }],
      rows: [{ label: "Cash at the start", amount: opening }, ...groups.map((g) => ({ label: g.label, amount: g.value })), { label: "Cash at the end", amount: opening + net }],
      chart: { type: "bar", unit: "money", points: groups.map((g) => ({ label: g.label, value: g.value })) },
      note: "Money in and out of bank and cash accounts in the period, by where it came from.",
      empty: "No money moved in this period.",
    };
  },
};

interface TaxReportSpec {
  /** The report's name for this business, when it isn't the catalogue's. */
  label?: string;
  roles: { role: string; label: string; sign: 1 | -1 }[];
  headline: string;
  note: string;
  empty: string;
}

/** A tax in a period, from the lines posted to that tax's accounts, named the way the business knows it. */
function taxReport(spec: (taxes: BusinessTaxes | undefined) => TaxReportSpec): ReportImpl {
  return {
    reads: LEDGER_READS,
    period: "month",
    run(s, ctx) {
      const opts = spec(s.taxes);
      const range = ctx.range!;
      // Settling the tax (a VAT return) moves balances between the tax accounts; it isn't tax for the period.
      const lines = ledgerLines(s, range).filter((l) => l.source_target !== "vat_return");
      const rows = opts.roles.map((r) => {
        const xs = lines.filter((l) => l.role === r.role);
        const amount = xs.reduce((t, l) => t + (l.credit - l.debit), 0) * r.sign;
        return { label: r.label, documents: new Set(xs.map((x) => x.source_id)).size, amount };
      });
      const net = rows.reduce((t, r, i) => t + r.amount * opts.roles[i]!.sign, 0);
      return {
        ...(opts.label ? { label: opts.label } : {}),
        headline: { label: opts.headline, value: net, unit: "money" },
        columns: [{ key: "label", label: "", type: "text" }, { key: "documents", label: "Documents", type: "count" }, { key: "amount", label: range.label, type: "money" }],
        rows,
        totals: { label: "Net", documents: null, amount: net },
        note: opts.note,
        empty: opts.empty,
      };
    },
  };
}

/** The registered taxes of these kinds, else the business's first one, else none. */
function taxesOfKind(taxes: BusinessTaxes | undefined, ...kinds: TaxKind[]): TaxDef[] {
  const reg = taxes?.registered.filter((t) => kinds.includes(t.kind)) ?? [];
  if (reg.length) return reg;
  const any = taxes?.all.find((t) => kinds.includes(t.kind) && !t.with);
  return any ? [any] : [];
}

/** VAT, GST or sales tax: what's charged on sales less what can be claimed on purchases, part by part. */
export const vatSummary = taxReport((taxes) => {
  const defs = taxesOfKind(taxes, "value_added", "sales");
  const name = taxList(defs) || "VAT";
  const roles: TaxReportSpec["roles"] = [];
  const parts = defs.length ? defs.flatMap((t) => taxParts(t).map((p) => ({ ...p, input: t.appliesTo === "sales" ? undefined : p.input }))) : [{ label: "VAT", output: "vat_output", input: "vat_input" }];
  for (const p of parts) if (!roles.some((r) => r.role === p.output)) roles.push({ role: p.output, label: `${p.label} on sales`, sign: 1 });
  for (const p of parts) if (p.input && !roles.some((r) => r.role === p.input)) roles.push({ role: p.input, label: `${p.label} on purchases you can claim`, sign: -1 });
  const claims = parts.some((p) => p.input);
  return {
    label: name === "VAT" ? undefined : `${name} summary`,
    roles,
    headline: `${name} payable for the period`,
    note: claims ? `${name} charged on posted sales less ${name} on posted purchases and expenses in the period.` : `${name} charged on posted sales in the period.`,
    empty: `No ${name} was posted in this period.`,
  };
});

export const whtSummary = taxReport((taxes) => {
  const t = taxesOfKind(taxes, "withholding")[0];
  const short = t?.short ?? "WHT";
  return {
    label: short === "WHT" ? undefined : t!.label,
    roles: [{ role: "wht_payable", label: `${short} you deducted from suppliers`, sign: 1 }, { role: "wht_receivable", label: `${short} customers deducted from you`, sign: -1 }],
    headline: `${short} to pay over, less ${short} suffered`,
    note: `${t?.label ?? "Withholding tax"} on posted receipts and payments in the period.`,
    empty: `No ${t && t.short !== "WHT" ? t.short : "withholding tax"} was posted in this period.`,
  };
});

export const ssclSummary = taxReport((taxes) => {
  const t = taxesOfKind(taxes, "levy")[0];
  const short = t?.short ?? "SSCL";
  return {
    label: short === "SSCL" ? undefined : short,
    roles: [{ role: "sscl_payable", label: `${short} on sales`, sign: 1 }],
    headline: `${short} for the period`,
    note: `${short} charged on posted sales in the period.`,
    empty: `No ${short} was posted in this period.`,
  };
});

/** Sales less the cost of the goods that left, by product. */
export const grossMargin: ReportImpl = {
  reads: ["invoice", "pos_sale", "credit_note", "customer", "item", "_stock_move"],
  period: "month",
  run(s, ctx) {
    const range = ctx.range!;
    const sales = saleLines(s, ctx, range);
    const cost = new Map<string, number>();
    for (const m of s.list("_stock_move")) {
      const src = String(m.data.source_target);
      if (!within(String(m.data.date), range) || !["delivery_note", "pos_shift", "credit_note", "pos_sale"].includes(src)) continue;
      cost.set(String(m.data.item), (cost.get(String(m.data.item)) ?? 0) - num(m.data.value));
    }
    const by = new Map<string, { revenue: number; cost: number }>();
    for (const l of sales) {
      if (!l.item) continue;
      const g = by.get(l.item) ?? { revenue: 0, cost: 0 };
      g.revenue += l.amount;
      by.set(l.item, g);
    }
    for (const [item, c] of cost) (by.get(item) ?? by.set(item, { revenue: 0, cost: 0 }).get(item)!).cost = c;
    const rows = [...by.entries()]
      .map(([item, g]) => ({ label: s.title("item", item), revenue: g.revenue, cost: g.cost, margin: g.revenue - g.cost, margin_pct: g.revenue > 0 ? Math.round(((g.revenue - g.cost) / g.revenue) * 1000) / 10 : null }))
      .sort((a, b) => b.margin - a.margin);
    const revenue = rows.reduce((t, r) => t + r.revenue, 0);
    const costs = rows.reduce((t, r) => t + r.cost, 0);
    return {
      headline: { label: "Gross margin", value: revenue > 0 ? Math.round(((revenue - costs) / revenue) * 1000) / 10 : null, unit: "percent", items: rows.slice(0, 3).map((r) => ({ label: r.label, value: r.margin })) },
      columns: [{ key: "label", label: "Product", type: "text" }, { key: "revenue", label: "Sales", type: "money" }, { key: "cost", label: "Cost", type: "money" }, { key: "margin", label: "Margin", type: "money" }, { key: "margin_pct", label: "Margin %", type: "percent" }],
      rows,
      totals: { label: "Total", revenue, cost: costs, margin: revenue - costs, margin_pct: revenue > 0 ? Math.round(((revenue - costs) / revenue) * 1000) / 10 : null },
      note: "Sales before tax less the cost of the goods delivered or sold at the counter in the period.",
      empty: "No sales in this period yet.",
    };
  },
};

/** What each batch cost: materials issued, labour and overheads absorbed, per unit of good output. */
export const batchCost: ReportImpl = {
  reads: ["batch", "production_order", "item", JOURNAL],
  period: "quarter",
  run(s, ctx) {
    const range = ctx.range!;
    const finish = new Map<string, { labour: number; overhead: number }>();
    for (const e of s.list(JOURNAL)) {
      if (e.data.source_target !== "batch" || e.data.action !== "finish") continue;
      const ls = (e.data.lines as StoredLine[]) ?? [];
      const of = (role: string) => ls.filter((l) => l.role === role).reduce((t, l) => t + l.credit - l.debit, 0);
      finish.set(String(e.data.source_id), { labour: of("labour_absorbed"), overhead: of("overhead_absorbed") });
    }
    const rows = s
      .list("batch")
      .filter((b) => finish.has(b.id) && within(str(b.data.mfg_date) ?? b.createdAt.slice(0, 10), range))
      .map((b) => {
        const f = finish.get(b.id)!;
        const material = num(b.data.material_cost);
        const output = num(b.data.output_quantity) || num(b.data.planned_quantity);
        const total = material + f.labour + f.overhead;
        const order = s.get("production_order", b.data.production_order);
        return { label: b.number ?? "Batch", product: s.title("item", order?.data.item), output, material, labour: f.labour, overhead: f.overhead, total, unit_cost: output > 0 ? Math.round(total / output) : null, status: b.status ?? "" };
      })
      .sort((a, b) => String(b.label).localeCompare(String(a.label)));
    const total = rows.reduce((t, r) => t + r.total, 0);
    const output = rows.reduce((t, r) => t + r.output, 0);
    return {
      headline: { label: "Production cost", value: total, unit: "money" },
      columns: [
        { key: "label", label: "Batch", type: "text" },
        { key: "product", label: "Product", type: "text" },
        { key: "output", label: "Good output", type: "quantity" },
        { key: "material", label: "Materials", type: "money" },
        { key: "labour", label: "Labour", type: "money" },
        { key: "overhead", label: "Overheads", type: "money" },
        { key: "total", label: "Total", type: "money" },
        { key: "unit_cost", label: "Per unit", type: "money" },
      ],
      rows,
      totals: { label: "Total", product: "", output, material: rows.reduce((t, r) => t + r.material, 0), labour: rows.reduce((t, r) => t + r.labour, 0), overhead: rows.reduce((t, r) => t + r.overhead, 0), total, unit_cost: null },
      chart: { type: "bar", unit: "money", points: rows.slice(0, 12).map((r) => ({ label: String(r.label), value: r.unit_cost ?? 0 })) },
      note: "Batches whose output has been recorded in the period, costed from the materials issued and the time on their operations.",
      empty: "No batch output recorded in this period.",
    };
  },
};

function dayBefore(d: string): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

