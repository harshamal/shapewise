import type { StoredRecord } from "../store";
import {
  addDays,
  addMonths,
  businessDate,
  dayLabel,
  daysBetween,
  groupSum,
  lines,
  monthLabel,
  monthStart,
  num,
  pct,
  previousPeriod,
  str,
  topPoints,
  within,
  type Period,
  type ReportBody,
  type ReportImpl,
  type ReportRow,
  type RunContext,
  type Snapshot,
} from "./engine";

/**
 * Sales counts posted invoices and completed counter sales, less posted
 * credit notes, before tax and after line discounts. Drafts, void documents
 * and refunded counter sales are left out.
 */

export interface SaleLine {
  date: string;
  source: "invoice" | "pos" | "credit_note";
  doc: string;
  customer?: string;
  salesperson?: string;
  item?: string;
  description?: string;
  quantity: number;
  /** Minor units, negative for credit notes. */
  amount: number;
}

const lineAmount = (l: Record<string, unknown>) => (typeof l.amount === "number" ? l.amount : Math.round(num(l.quantity) * num(l.unit_price) * (1 - num(l.discount_pct) / 100)));

export function saleLines(s: Snapshot, ctx: RunContext, range: { from: string; to: string }): SaleLine[] {
  const out: SaleLine[] = [];
  for (const inv of s.list("invoice")) {
    const date = str(inv.data.date);
    if (inv.status !== "posted" || !within(date, range)) continue;
    const salesperson = str(inv.data.salesperson) ?? str(s.get("customer", inv.data.customer)?.data.salesperson);
    for (const l of lines(inv)) out.push({ date: date!, source: "invoice", doc: inv.id, customer: str(inv.data.customer), salesperson, item: str(l.item), description: str(l.description), quantity: num(l.quantity), amount: lineAmount(l) });
  }
  for (const sale of s.list("pos_sale")) {
    const date = businessDate(sale.data.at, ctx.timezone) ?? sale.createdAt.slice(0, 10);
    if (sale.status !== "completed" || !within(date, range)) continue;
    for (const l of lines(sale)) out.push({ date, source: "pos", doc: sale.id, customer: str(sale.data.customer), item: str(l.item), description: str(l.description), quantity: num(l.quantity), amount: lineAmount(l) });
  }
  for (const cn of s.list("credit_note")) {
    const date = str(cn.data.date);
    if (cn.status !== "posted" || !within(date, range)) continue;
    const inv = s.get("invoice", cn.data.invoice);
    const salesperson = str(inv?.data.salesperson) ?? str(s.get("customer", cn.data.customer)?.data.salesperson);
    for (const l of lines(cn)) out.push({ date: date!, source: "credit_note", doc: cn.id, customer: str(cn.data.customer), salesperson, item: str(l.item), description: str(l.description), quantity: -num(l.quantity), amount: -lineAmount(l) });
  }
  return out;
}

const SALES_READS = ["invoice", "pos_sale", "credit_note", "customer"] as const;
const SALES_NOTE = "Posted invoices and counter sales less credit notes, before tax.";
const sum = (xs: readonly SaleLine[]) => xs.reduce((t, x) => t + x.amount, 0);
const docs = (xs: readonly SaleLine[]) => new Set(xs.filter((x) => x.source !== "credit_note").map((x) => x.doc)).size;

/* ------------------------------------------------------------ sales summary */

export const salesSummary: ReportImpl = {
  reads: SALES_READS,
  period: "month",
  run(s, ctx) {
    const range = ctx.range!;
    const now = saleLines(s, ctx, range);
    const before = saleLines(s, ctx, previousPeriod(range));
    const part = (xs: SaleLine[], src: SaleLine["source"]) => xs.filter((x) => x.source === src);
    const row = (label: string, a: SaleLine[], b: SaleLine[]): ReportRow => ({ label, documents: docs(a) || new Set(a.map((x) => x.doc)).size, amount: sum(a), previous: sum(b), change: change(sum(a), sum(b)) });
    const rows = [
      ...(s.list("invoice").length ? [row("Invoices", part(now, "invoice"), part(before, "invoice"))] : []),
      ...(s.list("pos_sale").length ? [row("Counter sales", part(now, "pos"), part(before, "pos"))] : []),
      ...(s.list("credit_note").length ? [row("Credit notes", part(now, "credit_note"), part(before, "credit_note"))] : []),
    ].filter((r) => r.amount !== 0 || r.previous !== 0);
    const total = sum(now);
    return {
      headline: { label: `Sales ${range.label.toLowerCase()}`, value: total, unit: "money" },
      columns: [
        { key: "label", label: "From", type: "text" },
        { key: "documents", label: "Documents", type: "count" },
        { key: "amount", label: range.label, type: "money" },
        { key: "previous", label: "Period before", type: "money" },
        { key: "change", label: "Change", type: "percent" },
      ],
      rows,
      totals: { label: "Net sales", documents: docs(now), amount: total, previous: sum(before), change: change(total, sum(before)) },
      chart: { type: "bar", unit: "money", points: dailyPoints(now, range) },
      note: SALES_NOTE,
      empty: "No sales in this period yet.",
    };
  },
};

function change(now: number, before: number): number | null {
  return before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null;
}

function dailyPoints(xs: readonly SaleLine[], range: Period) {
  const days = Math.min(daysBetween(range.from, range.to), 92);
  const byDay = new Map<string, number>();
  for (const x of xs) byDay.set(x.date, (byDay.get(x.date) ?? 0) + x.amount);
  if (days > 31) {
    const byMonth = new Map<string, number>();
    for (const [d, v] of byDay) byMonth.set(monthStart(d), (byMonth.get(monthStart(d)) ?? 0) + v);
    return [...byMonth.entries()].sort().map(([d, v]) => ({ label: monthLabel(d), value: v }));
  }
  return Array.from({ length: days + 1 }, (_, i) => addDays(range.from, i)).map((d) => ({ label: dayLabel(d), value: byDay.get(d) ?? 0 }));
}

/* ------------------------------------------------------------- rankings */

function ranking(opts: { key: (x: SaleLine, s: Snapshot) => string; first: string; headline: string; withQty?: boolean; empty: string }): ReportImpl {
  return {
    reads: [...SALES_READS, "item", "salesperson"],
    period: "quarter",
    run(s, ctx) {
      const xs = saleLines(s, ctx, ctx.range!);
      const total = sum(xs);
      const groups = groupSum(xs, (x) => opts.key(x, s), (x) => x.amount);
      const qty = new Map<string, number>();
      const docCount = new Map<string, Set<string>>();
      for (const x of xs) {
        const k = opts.key(x, s);
        qty.set(k, (qty.get(k) ?? 0) + x.quantity);
        if (x.source !== "credit_note") docCount.set(k, (docCount.get(k) ?? new Set()).add(x.doc));
      }
      const rows = groups.map((g) => ({ label: g.label, ...(opts.withQty ? { quantity: Math.round((qty.get(g.label) ?? 0) * 1000) / 1000 } : { documents: docCount.get(g.label)?.size ?? 0 }), amount: g.value, share: pct(g.value, total) }));
      const top = groups[0];
      return {
        headline: { label: opts.headline, value: top?.value ?? null, unit: "money", text: top?.label, items: groups.slice(0, 3).map((g) => ({ label: g.label, value: g.value })) },
        columns: [
          { key: "label", label: opts.first, type: "text" },
          opts.withQty ? { key: "quantity", label: "Quantity", type: "quantity" } : { key: "documents", label: "Sales", type: "count" },
          { key: "amount", label: "Sales value", type: "money" },
          { key: "share", label: "Share", type: "percent" },
        ],
        rows,
        totals: { label: "Total", amount: total, share: rows.length ? 100 : null },
        chart: { type: "bar", unit: "money", points: topPoints(groups) },
        note: SALES_NOTE,
        empty: opts.empty,
      };
    },
  };
}

export const salesByCustomer = ranking({
  key: (x, s) => (x.customer ? s.title("customer", x.customer) : x.source === "pos" ? "Walk in customers" : "No customer"),
  first: "Customer",
  headline: "Top customer",
  empty: "No sales in this period yet.",
});

export const salesByItem = ranking({
  key: (x, s) => (x.item ? s.title("item", x.item) : (x.description ?? "Other")),
  first: "Product",
  headline: "Top product",
  withQty: true,
  empty: "No sales in this period yet.",
});

export const salesBySalesperson = ranking({
  key: (x, s) => (x.salesperson ? s.title("salesperson", x.salesperson) : x.source === "pos" ? "Counter" : "No salesperson"),
  first: "Salesperson",
  headline: "Top salesperson",
  empty: "No sales in this period yet.",
});

/* ------------------------------------------------------------- sales trend */

export const salesTrend: ReportImpl = {
  reads: SALES_READS,
  run(s, ctx) {
    const first = addMonths(ctx.today, -11);
    const xs = saleLines(s, ctx, { from: first, to: ctx.today });
    const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i));
    const rows = months.map((m) => {
      const inMonth = xs.filter((x) => monthStart(x.date) === m);
      const by = (src: SaleLine["source"]) => sum(inMonth.filter((x) => x.source === src));
      return { label: monthLabel(m), invoices: by("invoice"), counter: by("pos"), credits: by("credit_note"), amount: sum(inMonth) };
    });
    const [prev, last] = [rows.at(-3)!.amount, rows.at(-2)!.amount];
    const started = rows.findIndex((r) => r.amount !== 0);
    return {
      headline: { label: "Last month against the month before", value: change(last, prev), unit: "percent" },
      columns: [
        { key: "label", label: "Month", type: "text" },
        ...(s.list("invoice").length ? [{ key: "invoices", label: "Invoices", type: "money" } as const] : []),
        ...(s.list("pos_sale").length ? [{ key: "counter", label: "Counter sales", type: "money" } as const] : []),
        ...(s.list("credit_note").length ? [{ key: "credits", label: "Credit notes", type: "money" } as const] : []),
        { key: "amount", label: "Net sales", type: "money" },
      ],
      rows: started < 0 ? [] : rows.slice(started),
      chart: { type: "line", unit: "money", points: (started < 0 ? [] : rows.slice(started)).map((r) => ({ label: r.label, value: r.amount })) },
      note: `${SALES_NOTE} The current month is so far.`,
      empty: "No sales in the last twelve months yet.",
    };
  },
};

/* ------------------------------------------------------- orders to deliver */

const OPEN_SO = new Set(["confirmed", "in_production", "partly_delivered"]);
const STATE_LABEL: Record<string, string> = { confirmed: "Confirmed", in_production: "In production", partly_delivered: "Partly delivered", issued: "Issued", partly_received: "Partly received" };

/** Value still to come on an order: undelivered (or unreceived) quantity at the line price. */
function outstanding(r: StoredRecord, doneKey: "delivered_qty" | "received_qty"): number {
  return lines(r).reduce((t, l) => {
    const left = Math.max(0, num(l.quantity) - num(l[doneKey]));
    return t + Math.round(left * num(l.unit_price) * (1 - num(l.discount_pct) / 100));
  }, 0);
}

function whenBucket(due: string | undefined, today: string): string {
  if (!due) return "No date";
  const d = daysBetween(today, due);
  return d < 0 ? "Late" : d <= 7 ? "Next 7 days" : d <= 14 ? "The week after" : "Later";
}
const BUCKET_ORDER = ["Late", "Next 7 days", "The week after", "Later", "No date"];

export function openOrdersReport(opts: { target: "sales_order" | "purchase_order"; party: "customer" | "vendor"; dateKey: string; doneKey: "delivered_qty" | "received_qty"; open: Set<string>; headline: string; partyLabel: string; dateLabel: string; valueLabel: string; empty: string; note: string }): ReportImpl {
  return {
    reads: [opts.target, opts.party],
    run(s, ctx) {
      const open = s.list(opts.target).filter((r) => r.status && opts.open.has(r.status) && !r.pendingApproval);
      const rows = open
        .map((r) => {
          const due = str(r.data[opts.dateKey]);
          return { id: r.id, label: r.number ?? "Draft", party: s.title(opts.party, r.data[opts.party]), due: due ?? null, status: STATE_LABEL[r.status!] ?? r.status!, amount: outstanding(r, opts.doneKey), days_late: due && due < ctx.today ? daysBetween(due, ctx.today) : null };
        })
        .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
      const soon = rows.filter((r) => r.due && daysBetween(ctx.today, r.due) <= 7).length;
      const buckets = new Map<string, number>(BUCKET_ORDER.map((b) => [b, 0]));
      for (const r of rows) buckets.set(whenBucket(r.due ?? undefined, ctx.today), buckets.get(whenBucket(r.due ?? undefined, ctx.today))! + r.amount);
      return {
        headline: { label: opts.headline, value: soon, unit: "count" },
        columns: [
          { key: "label", label: "Order", type: "text" },
          { key: "party", label: opts.partyLabel, type: "text" },
          { key: "due", label: opts.dateLabel, type: "date" },
          { key: "status", label: "Status", type: "text" },
          { key: "amount", label: opts.valueLabel, type: "money" },
          { key: "days_late", label: "Days late", type: "count" },
        ],
        rows: rows.map(({ id: _id, ...r }) => r),
        totals: { label: `${rows.length} open`, amount: rows.reduce((t, r) => t + r.amount, 0) },
        chart: { type: "bar", unit: "money", points: [...buckets.entries()].filter(([b, v]) => v || b !== "No date").map(([label, value]) => ({ label, value })) },
        note: opts.note,
        empty: opts.empty,
      };
    },
  };
}

export const openOrders = openOrdersReport({
  target: "sales_order", party: "customer", dateKey: "delivery_date", doneKey: "delivered_qty", open: OPEN_SO,
  headline: "Orders due in the next 7 days", partyLabel: "Customer", dateLabel: "Delivery date", valueLabel: "Still to deliver", empty: "Nothing waiting to be delivered.",
  note: "Confirmed sales orders not yet fully delivered, valued at the order price before tax.",
});

/* -------------------------------------------------------------- aged balances */

export const AGE_BUCKETS = [
  { key: "current", label: "Not yet due" },
  { key: "d30", label: "1 to 30 days" },
  { key: "d60", label: "31 to 60 days" },
  { key: "d90", label: "61 to 90 days" },
  { key: "over90", label: "Over 90 days" },
] as const;

export interface OpenDoc {
  id: string;
  party: string;
  date: string;
  due: string;
  /** Minor units still owed. */
  open: number;
}

/**
 * What is still owed on each document. Payments carry no allocation yet, so
 * they settle a party's oldest documents first; a credit against a named
 * document settles that one first.
 */
export function openDocuments(opts: { docs: StoredRecord[]; payments: StoredRecord[]; credits: StoredRecord[]; party: string; creditRef: string; terms: (party: string) => number; deduct?: (doc: StoredRecord) => number }): OpenDoc[] {
  const byParty = new Map<string, OpenDoc[]>();
  for (const d of opts.docs) {
    if (d.status !== "posted") continue;
    const party = str(d.data[opts.party]);
    const date = str(d.data.date);
    if (!party || !date) continue;
    const due = str(d.data.due_date) ?? addDays(date, opts.terms(party));
    const list = byParty.get(party) ?? [];
    list.push({ id: d.id, party, date, due, open: num(d.data.total) - (opts.deduct?.(d) ?? 0) });
    byParty.set(party, list);
  }
  for (const list of byParty.values()) list.sort((a, b) => a.due.localeCompare(b.due) || a.date.localeCompare(b.date));

  const pool = new Map<string, number>();
  for (const c of opts.credits) {
    if (c.status !== "posted") continue;
    const party = str(c.data[opts.party]);
    if (!party) continue;
    let left = num(c.data.total);
    const target = byParty.get(party)?.find((d) => d.id === c.data[opts.creditRef]);
    if (target) {
      const used = Math.min(left, Math.max(0, target.open));
      target.open -= used;
      left -= used;
    }
    pool.set(party, (pool.get(party) ?? 0) + left);
  }
  for (const p of opts.payments) {
    if (p.status !== "posted") continue;
    const party = str(p.data[opts.party]);
    if (party) pool.set(party, (pool.get(party) ?? 0) + num(p.data.amount) + num(p.data.wht_deducted));
  }
  for (const [party, amount] of pool) {
    let left = amount;
    for (const d of byParty.get(party) ?? []) {
      if (left <= 0) break;
      const used = Math.min(left, Math.max(0, d.open));
      d.open -= used;
      left -= used;
    }
  }
  return [...byParty.values()].flat().filter((d) => d.open > 0);
}

export function ageBucket(due: string, today: string): (typeof AGE_BUCKETS)[number]["key"] {
  const late = daysBetween(due, today);
  return late <= 0 ? "current" : late <= 30 ? "d30" : late <= 60 ? "d60" : late <= 90 ? "d90" : "over90";
}

export const agedReceivables: ReportImpl = {
  reads: ["invoice", "receipt", "credit_note", "customer"],
  run(s, ctx) {
    const terms = (c: string) => num(s.get("customer", c)?.data.payment_terms_days);
    const open = openDocuments({ docs: s.list("invoice"), payments: s.list("receipt"), credits: s.list("credit_note"), party: "customer", creditRef: "invoice", terms });
    const rows = new Map<string, ReportRow & { total: number }>();
    const totals: Record<string, number> = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 };
    for (const d of open) {
      const row = rows.get(d.party) ?? { label: s.title("customer", d.party), current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0, oldest: null };
      const b = ageBucket(d.due, ctx.today);
      row[b] = num(row[b]) + d.open;
      row.total += d.open;
      totals[b]! += d.open;
      totals.total! += d.open;
      const late = Math.max(0, daysBetween(d.due, ctx.today));
      row.oldest = Math.max(num(row.oldest), late) || null;
      rows.set(d.party, row);
    }
    const overdue = totals.total! - totals.current!;
    return {
      headline: { label: "Overdue from customers", value: overdue, unit: "money", items: [...rows.values()].map((r) => ({ label: String(r.label), value: r.total - num(r.current) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 3) },
      columns: [
        { key: "label", label: "Customer", type: "text" },
        ...AGE_BUCKETS.map((b) => ({ key: b.key, label: b.key === "current" ? b.label : `${b.label} late`, type: "money" as const })),
        { key: "total", label: "Owed", type: "money" },
        { key: "oldest", label: "Most days late", type: "count" },
      ],
      rows: [...rows.values()].sort((a, b) => b.total - a.total),
      totals: { label: "Total", ...totals },
      chart: { type: "bar", unit: "money", points: AGE_BUCKETS.map((b) => ({ label: b.label, value: totals[b.key]! })) },
      note: "Posted invoices less payments received and credit notes. Payments settle each customer's oldest invoices first. Due dates come from the invoice, or the customer's payment terms.",
      empty: "Nobody owes you anything.",
    };
  },
};

/* ------------------------------------------------------------ daily takings */

const TENDERS = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "qr", label: "QR" },
  { key: "mixed", label: "Mixed" },
] as const;

export const dailyTakings: ReportImpl = {
  reads: ["pos_sale"],
  run(s, ctx) {
    const from = addDays(ctx.today, -13);
    const days = new Map<string, ReportRow & { total: number; sales: number }>();
    for (let i = 13; i >= 0; i--) {
      const d = addDays(ctx.today, -i);
      days.set(d, { label: dayLabel(d), date: d, sales: 0, cash: 0, card: 0, qr: 0, mixed: 0, total: 0 });
    }
    for (const sale of s.list("pos_sale")) {
      const date = businessDate(sale.data.at, ctx.timezone) ?? sale.createdAt.slice(0, 10);
      if (sale.status !== "completed" || date < from || date > ctx.today) continue;
      const row = days.get(date)!;
      const tender = str(sale.data.tender) ?? "cash";
      const amount = num(sale.data.total);
      row[tender] = num(row[tender]) + amount;
      row.sales++;
      row.total += amount;
    }
    const rows = [...days.values()].reverse();
    const today = days.get(ctx.today)!;
    const any = rows.some((r) => r.sales > 0);
    return {
      headline: { label: "Takings today", value: today.total, unit: "money" },
      columns: [
        { key: "date", label: "Day", type: "date" },
        { key: "sales", label: "Sales", type: "count" },
        ...TENDERS.filter((t) => rows.some((r) => num(r[t.key]) > 0) || t.key === "cash").map((t) => ({ key: t.key, label: t.label, type: "money" as const })),
        { key: "total", label: "Total", type: "money" },
      ],
      rows: any ? rows.map(({ label: _l, ...r }) => r) : [],
      totals: { date: null, sales: rows.reduce((t, r) => t + r.sales, 0), ...Object.fromEntries(TENDERS.map((t) => [t.key, rows.reduce((x, r) => x + num(r[t.key]), 0)])), total: rows.reduce((t, r) => t + r.total, 0) },
      chart: { type: "bar", unit: "money", points: [...days.values()].map((r) => ({ label: String(r.label), value: r.total })) },
      note: "Completed counter sales for the last 14 days, including tax. Refunded sales are left out.",
      empty: "No counter sales in the last 14 days.",
    };
  },
};

export type { ReportBody };
