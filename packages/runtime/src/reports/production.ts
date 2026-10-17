import type { StoredRecord } from "../store";
import { addDays, businessDate, daysBetween, groupSum, lines, num, pct, round, str, within, type ReportImpl, type ReportRow, type Snapshot } from "./engine";

/**
 * Production reports read production orders and their batches. Good output
 * and scrap come from batches as recorded; an order's progress is the good
 * output of its batches.
 */

const ORDER_STATE: Record<string, string> = { draft: "Draft", scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
const OPEN_ORDER = new Set(["scheduled", "in_progress"]);

function madeByOrder(s: Snapshot): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of s.list("batch")) {
    const o = str(b.data.production_order);
    if (o && b.status !== "rejected") out.set(o, (out.get(o) ?? 0) + num(b.data.output_quantity));
  }
  return out;
}

function orderRow(s: Snapshot, o: StoredRecord, made: Map<string, number>, today: string): ReportRow {
  const planned = num(o.data.planned_quantity);
  const done = Math.max(num(o.data.completed_quantity), made.get(o.id) ?? 0);
  const due = str(o.data.due_date);
  return {
    label: o.number ?? "Draft order",
    product: s.title("item", o.data.item),
    status: ORDER_STATE[o.status ?? ""] ?? o.status ?? "",
    planned,
    made: done,
    progress: pct(done, planned),
    due: due ?? null,
    days_late: due && due < today ? daysBetween(due, today) : null,
  };
}

const ORDER_COLUMNS = [
  { key: "label", label: "Order", type: "text" },
  { key: "product", label: "Product", type: "text" },
  { key: "status", label: "Status", type: "text" },
  { key: "planned", label: "Planned", type: "quantity" },
  { key: "made", label: "Made", type: "quantity" },
  { key: "progress", label: "Progress", type: "percent" },
  { key: "due", label: "Due", type: "date" },
] as const;

export const productionStatus: ReportImpl = {
  reads: ["production_order", "batch", "item"],
  run(s, ctx) {
    const made = madeByOrder(s);
    const open = s.list("production_order").filter((o) => OPEN_ORDER.has(o.status ?? ""));
    const rows = open.map((o) => orderRow(s, o, made, ctx.today)).sort((a, b) => String(a.status).localeCompare(String(b.status)) || String(a.due ?? "9999").localeCompare(String(b.due ?? "9999")));
    const running = open.filter((o) => o.status === "in_progress").length;
    return {
      headline: { label: "Production orders in progress", value: running, unit: "count" },
      columns: [...ORDER_COLUMNS],
      rows,
      chart: { type: "bar", unit: "percent", points: rows.filter((r) => r.status === "In progress").slice(0, 12).map((r) => ({ label: `${r.label} ${r.product}`.trim(), value: num(r.progress) })) },
      note: "Scheduled and running production orders. Made is the good output of their batches so far.",
      empty: "Nothing is scheduled or running.",
    };
  },
};

export const lateJobs: ReportImpl = {
  reads: ["production_order", "batch", "item"],
  run(s, ctx) {
    const made = madeByOrder(s);
    const late = s.list("production_order").filter((o) => OPEN_ORDER.has(o.status ?? "") && (str(o.data.due_date) ?? "9999") < ctx.today);
    const rows = late.map((o) => orderRow(s, o, made, ctx.today)).sort((a, b) => num(b.days_late) - num(a.days_late));
    return {
      headline: { label: "Production orders late", value: rows.length, unit: "count" },
      columns: [...ORDER_COLUMNS, { key: "days_late", label: "Days late", type: "count" }],
      rows,
      chart: { type: "bar", unit: "count", points: rows.slice(0, 12).map((r) => ({ label: String(r.label), value: num(r.days_late) })) },
      note: "Scheduled and running production orders past their due date.",
      empty: "No production orders are late.",
    };
  },
};

/* ------------------------------------------------------------ output */

interface BatchOut {
  b: StoredRecord;
  good: number;
  scrap: number;
  product: string;
  machine: string;
}

/** Batches with output recorded in the period, dated by when they were made. */
function batchesIn(s: Snapshot, range: { from: string; to: string }): BatchOut[] {
  return s
    .list("batch")
    .filter((b) => (num(b.data.output_quantity) > 0 || num(b.data.scrap_quantity) > 0) && within(str(b.data.mfg_date) ?? b.createdAt.slice(0, 10), range))
    .map((b) => {
      const order = s.get("production_order", b.data.production_order);
      return { b, good: num(b.data.output_quantity), scrap: num(b.data.scrap_quantity), product: s.title("item", order?.data.item) || "No product", machine: s.title("resource", b.data.machine) || "No machine recorded" };
    });
}

const OUTPUT_READS = ["batch", "production_order", "item", "resource", "recipe"] as const;

export const yieldReport: ReportImpl = {
  reads: OUTPUT_READS,
  period: "month",
  run(s, ctx) {
    const xs = batchesIn(s, ctx.range!);
    const expected = new Map<string, number>();
    for (const r of s.list("recipe")) if (r.status !== "archived" && typeof r.data.expected_yield_pct === "number") expected.set(s.title("item", r.data.item), r.data.expected_yield_pct);
    const by = new Map<string, { good: number; scrap: number; batches: number }>();
    for (const x of xs) {
      const g = by.get(x.product) ?? { good: 0, scrap: 0, batches: 0 };
      g.good += x.good;
      g.scrap += x.scrap;
      g.batches++;
      by.set(x.product, g);
    }
    const good = xs.reduce((t, x) => t + x.good, 0);
    const scrap = xs.reduce((t, x) => t + x.scrap, 0);
    const rows = [...by.entries()]
      .map(([label, g]) => ({ label, batches: g.batches, good: round(g.good, 3), scrap: round(g.scrap, 3), yield: pct(g.good, g.good + g.scrap), expected: expected.get(label) ?? null }))
      .sort((a, b) => num(a.yield) - num(b.yield));
    return {
      headline: { label: "Yield", value: pct(good, good + scrap), unit: "percent" },
      columns: [
        { key: "label", label: "Product", type: "text" },
        { key: "batches", label: "Batches", type: "count" },
        { key: "good", label: "Good output", type: "quantity" },
        { key: "scrap", label: "Scrap", type: "quantity" },
        { key: "yield", label: "Yield", type: "percent" },
        { key: "expected", label: "Expected", type: "percent" },
      ],
      rows,
      totals: { label: "All products", batches: xs.length, good: round(good, 3), scrap: round(scrap, 3), yield: pct(good, good + scrap) },
      chart: { type: "bar", unit: "percent", points: rows.map((r) => ({ label: r.label, value: num(r.yield) })) },
      note: "Good output as a share of everything batches produced, good and scrap, by the date each batch was made.",
      empty: "No batch output recorded in this period.",
    };
  },
};

export const scrapByMachine: ReportImpl = {
  reads: OUTPUT_READS,
  period: "month",
  run(s, ctx) {
    const xs = batchesIn(s, ctx.range!);
    const by = new Map<string, { good: number; scrap: number; batches: number }>();
    for (const x of xs) {
      const g = by.get(x.machine) ?? { good: 0, scrap: 0, batches: 0 };
      g.good += x.good;
      g.scrap += x.scrap;
      g.batches++;
      by.set(x.machine, g);
    }
    const rows = [...by.entries()]
      .map(([label, g]) => ({ label, batches: g.batches, good: round(g.good, 3), scrap: round(g.scrap, 3), scrap_pct: pct(g.scrap, g.good + g.scrap) }))
      .sort((a, b) => num(b.scrap_pct) - num(a.scrap_pct));
    const good = xs.reduce((t, x) => t + x.good, 0);
    const scrap = xs.reduce((t, x) => t + x.scrap, 0);
    const worst = rows[0];
    return {
      headline: { label: "Highest scrap rate", value: worst?.scrap_pct ?? null, unit: "percent", text: worst?.label, items: rows.slice(0, 3).map((r) => ({ label: r.label, value: num(r.scrap_pct) })) },
      columns: [
        { key: "label", label: "Machine", type: "text" },
        { key: "batches", label: "Batches", type: "count" },
        { key: "good", label: "Good output", type: "quantity" },
        { key: "scrap", label: "Scrap", type: "quantity" },
        { key: "scrap_pct", label: "Scrap rate", type: "percent" },
      ],
      rows,
      totals: { label: "All machines", batches: xs.length, good: round(good, 3), scrap: round(scrap, 3), scrap_pct: pct(scrap, good + scrap) },
      chart: { type: "bar", unit: "percent", points: rows.map((r) => ({ label: r.label, value: num(r.scrap_pct) })) },
      note: "Scrap as a share of everything each machine's batches produced, by the date each batch was made.",
      empty: "No batch output recorded in this period.",
    };
  },
};

/** Overall scrap rate, for the scrap rate tile. */
export function scrapRate(s: Snapshot, range: { from: string; to: string }): number | null {
  const xs = batchesIn(s, range);
  const good = xs.reduce((t, x) => t + x.good, 0);
  const scrap = xs.reduce((t, x) => t + x.scrap, 0);
  return pct(scrap, good + scrap);
}

/* ---------------------------------------------------------------- quality */

export const qcFailures: ReportImpl = {
  reads: ["batch", "production_order", "inspection", "item", "goods_receipt"],
  period: "month",
  run(s, ctx) {
    const rows: (ReportRow & { check: string })[] = [];
    const failing = new Set<string>();
    for (const b of s.list("batch")) {
      const date = str(b.data.mfg_date) ?? b.createdAt.slice(0, 10);
      if (!within(date, ctx.range!)) continue;
      const product = s.title("item", s.get("production_order", b.data.production_order)?.data.item);
      const failed = lines(b, "qc_results").filter((q) => q.passed === false);
      for (const q of failed) rows.push({ date, label: b.number ?? "Batch", product, check: str(q.check) ?? "Check", result: str(q.value) ?? "Failed" });
      if (b.status === "rejected" && !failed.length) rows.push({ date, label: b.number ?? "Batch", product, check: "Batch rejected", result: "Rejected" });
      if (failed.length || b.status === "rejected") failing.add(b.id);
    }
    for (const i of s.list("inspection")) {
      const date = businessDate(i.updatedAt, ctx.timezone) ?? i.updatedAt.slice(0, 10);
      if (i.status !== "failed" || !within(date, ctx.range!)) continue;
      const grn = s.get("goods_receipt", i.data.goods_receipt);
      rows.push({ date, label: grn?.number ?? "Incoming inspection", product: s.title("item", i.data.item), check: "Incoming inspection", result: "Failed" });
      failing.add(i.id);
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const byCheck = groupSum(rows, (r) => r.check, () => 1);
    return {
      headline: { label: "Quality failures", value: failing.size, unit: "count", text: byCheck[0] ? `Most often ${byCheck[0].label}` : undefined },
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "label", label: "Batch or receipt", type: "text" },
        { key: "product", label: "Product", type: "text" },
        { key: "check", label: "Check", type: "text" },
        { key: "result", label: "Result", type: "text" },
      ],
      rows,
      chart: { type: "bar", unit: "count", points: byCheck.slice(0, 10).map((g) => ({ label: g.label, value: g.value })) },
      note: "Failed batch checks, rejected batches and failed incoming inspections.",
      empty: "Nothing failed a quality check in this period.",
    };
  },
};

/* --------------------------------------------------------------- capacity */

const HORIZON = 7;

export const capacity: ReportImpl = {
  reads: ["production_order", "batch", "recipe", "resource"],
  run(s, ctx) {
    const until = addDays(ctx.today, HORIZON - 1);
    const made = madeByOrder(s);
    const booked = new Map<string, number>();
    for (const o of s.list("production_order")) {
      if (!OPEN_ORDER.has(o.status ?? "")) continue;
      const start = str(o.data.start_date);
      if (start && start > until) continue;
      const recipe = s.get("recipe", o.data.recipe);
      const perRun = num(recipe?.data.output_quantity);
      if (!recipe || perRun <= 0) continue;
      const left = Math.max(0, num(o.data.planned_quantity) - (made.get(o.id) ?? 0));
      if (!left) continue;
      for (const op of lines(recipe, "operations")) {
        const machine = str(op.machine) ?? str(op.work_centre);
        if (!machine) continue;
        const minutes = num(op.setup_minutes) + num(op.run_minutes) * (left / perRun);
        booked.set(machine, (booked.get(machine) ?? 0) + minutes / 60);
      }
    }
    const machines = s.list("resource").filter((r) => r.status !== "archived" && (r.data.type === "machine" || booked.has(r.id)) && num(r.data.hours_per_day) > 0);
    const rows = machines
      .map((m) => {
        const available = num(m.data.hours_per_day) * HORIZON;
        const hours = round(booked.get(m.id) ?? 0, 1);
        return { label: s.title("resource", m.id), booked: hours, available, load: pct(hours, available), free: round(Math.max(0, available - hours), 1) };
      })
      .sort((a, b) => num(b.load) - num(a.load));
    const total = rows.reduce((t, r) => t + r.booked, 0);
    const avail = rows.reduce((t, r) => t + r.available, 0);
    return {
      headline: { label: "Machine load, next 7 days", value: pct(total, avail), unit: "percent", text: rows[0] && num(rows[0].load) > 0 ? `Busiest ${rows[0].label}` : undefined },
      columns: [
        { key: "label", label: "Machine", type: "text" },
        { key: "booked", label: "Booked", type: "hours" },
        { key: "available", label: "Available", type: "hours" },
        { key: "free", label: "Free", type: "hours" },
        { key: "load", label: "Load", type: "percent" },
      ],
      rows,
      totals: { label: "All machines", booked: round(total, 1), available: avail, free: round(Math.max(0, avail - total), 1), load: pct(total, avail) },
      chart: { type: "bar", unit: "percent", points: rows.map((r) => ({ label: r.label, value: num(r.load) })) },
      note: "Hours still to run on scheduled and running production orders starting within 7 days, from each recipe's operations, against each machine's hours per day.",
      empty: "No machines with working hours are set up yet.",
    };
  },
};
