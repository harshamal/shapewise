import { describe, expect, it } from "vitest";
import { Blueprint, REPORTS, type ReportKey } from "@shapewise/blueprint";
import { bakery, plasticsFactory } from "@shapewise/blueprint/fixtures";
import { MemoryStore, compile, type StoredRecord } from "../src";
import { dashboardTiles, periodOf, previousPeriod, reportsFor, runReport, runReports, seedDemoRecords, snapshotOf, RECORD_REPORTS, type ReportResult } from "../src/reports";

const plastics = compile(Blueprint.parse(plasticsFactory));
const bakeryC = compile(Blueprint.parse(bakery));
const today = "2026-10-17";
const ctx = { today, timezone: "Asia/Colombo" };

let n = 0;
function rec(target: string, data: Record<string, unknown>, status?: string, number?: string): StoredRecord {
  const id = `${target}_${++n}`;
  return { id, target, data, status, number: number ?? id.toUpperCase(), version: 1, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", createdBy: "t", updatedBy: "t", links: [] };
}
/** A priced line; money in rupees here, stored in cents. */
const line = (item: string, quantity: number, price: number, extra: Record<string, unknown> = {}) => ({ item, quantity, unit_price: price * 100, amount: quantity * price * 100, ...extra });
const doc = (ls: ReturnType<typeof line>[]) => {
  const sub = ls.reduce((t, l) => t + l.amount, 0);
  return { lines: ls, sub_total: sub, tax_total: 0, total: sub };
};
function snap(compiled: typeof plastics, recs: StoredRecord[]) {
  const by: Record<string, StoredRecord[]> = {};
  for (const r of recs) (by[r.target] ??= []).push(r);
  return snapshotOf(compiled, by);
}
function ready(r: ReportResult) {
  if (r.state !== "ready") throw new Error(`${r.key} is waiting`);
  return r;
}
const col = (r: ReturnType<typeof ready>, key: string) => r.rows.map((x) => x[key]);

/* shared masters */
const perera = rec("customer", { name: "Perera Stores", payment_terms_days: 30 }, "active");
const lanka = rec("customer", { name: "Lanka Dairies", payment_terms_days: 0 }, "active");
const sam = rec("salesperson", { name: "Sam" }, "active");
const cup = rec("item", { name: "Cup", type: "goods" }, "active");
const lid = rec("item", { name: "Lid", type: "goods" }, "active");
const masters = [perera, lanka, sam, cup, lid];

describe("sales", () => {
  const recs = [
    ...masters,
    rec("invoice", { date: "2026-10-03", customer: perera.id, salesperson: sam.id, ...doc([line(cup.id, 100, 50), line(lid.id, 100, 10)]) }, "posted"), // 6,000
    rec("invoice", { date: "2026-10-10", customer: lanka.id, ...doc([line(cup.id, 20, 50)]) }, "posted"), // 1,000
    rec("invoice", { date: "2026-10-12", customer: lanka.id, ...doc([line(cup.id, 1000, 50)]) }, "draft"), // ignored
    rec("invoice", { date: "2026-10-11", customer: lanka.id, ...doc([line(cup.id, 1000, 50)]) }, "void"), // ignored
    rec("invoice", { date: "2026-09-05", customer: perera.id, ...doc([line(lid.id, 200, 10)]) }, "posted"), // 2,000 last month
    rec("credit_note", { date: "2026-10-12", customer: perera.id, ...doc([line(cup.id, 10, 50)]) }, "posted"), // -500
  ];
  const s = snap(plastics, recs);

  it("summarises the month against the same days last month", () => {
    const r = ready(runReport(s, "sales_summary", ctx));
    expect(r.headline).toMatchObject({ value: 650_000, unit: "money" });
    expect(r.totals).toMatchObject({ amount: 650_000, previous: 200_000, change: 225 });
    expect(r.rows.map((x) => [x.label, x.amount])).toEqual([["Invoices", 700_000], ["Credit notes", -50_000]]);
    expect(r.chart!.points).toHaveLength(17);
  });

  it("ranks customers, products and salespeople", () => {
    const byCustomer = ready(runReport(s, "sales_by_customer", ctx));
    expect(byCustomer.rows.map((x) => [x.label, x.amount, x.share])).toEqual([["Perera Stores", 750_000, 88.2], ["Lanka Dairies", 100_000, 11.8]]);
    expect(byCustomer.headline).toMatchObject({ text: "Perera Stores", value: 750_000 });

    const byItem = ready(runReport(s, "sales_by_item", ctx));
    expect(byItem.rows.map((x) => [x.label, x.quantity, x.amount])).toEqual([["Cup", 110, 550_000], ["Lid", 300, 300_000]].sort((a, b) => Number(b[2]) - Number(a[2])) as never);

    const bySp = ready(runReport(s, "sales_by_salesperson", ctx));
    expect(bySp.rows.map((x) => [x.label, x.amount])).toEqual([["Sam", 600_000], ["No salesperson", 250_000]]);
  });

  it("follows the period asked for", () => {
    const r = ready(runReport(s, "sales_by_customer", { ...ctx, period: "last_month" }));
    expect(r.period).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(col(r, "amount")).toEqual([200_000]);
  });

  it("trends twelve months from the first with sales", () => {
    const r = ready(runReport(s, "sales_trend", ctx));
    expect(r.rows.map((x) => [x.label, x.amount])).toEqual([["Sep 2026", 200_000], ["Oct 2026", 650_000]]);
    expect(r.headline!.value).toBeNull(); // no month before last to compare with
  });
});

describe("orders to deliver", () => {
  it("values what is left to deliver and counts what is due this week", () => {
    const s = snap(plastics, [
      ...masters,
      rec("sales_order", { date: "2026-10-01", customer: perera.id, delivery_date: "2026-10-14", ...doc([line(cup.id, 100, 50, { delivered_qty: 40 })]) }, "partly_delivered", "SO-1"),
      rec("sales_order", { date: "2026-10-05", customer: lanka.id, delivery_date: "2026-10-20", ...doc([line(lid.id, 100, 10)]) }, "confirmed", "SO-2"),
      rec("sales_order", { date: "2026-10-05", customer: lanka.id, delivery_date: "2026-11-30", ...doc([line(lid.id, 10, 10)]) }, "confirmed", "SO-3"),
      rec("sales_order", { date: "2026-10-05", customer: lanka.id, delivery_date: "2026-10-18", ...doc([line(lid.id, 10, 10)]) }, "delivered", "SO-4"),
      rec("sales_order", { date: "2026-10-05", customer: lanka.id, delivery_date: "2026-10-18", ...doc([line(lid.id, 10, 10)]) }, "draft"),
    ]);
    const r = ready(runReport(s, "open_orders", ctx));
    expect(r.rows.map((x) => [x.label, x.amount, x.days_late])).toEqual([["SO-1", 300_000, 3], ["SO-2", 100_000, null], ["SO-3", 10_000, null]]);
    expect(r.headline!.value).toBe(2);
    expect(r.chart!.points.find((p) => p.label === "Late")!.value).toBe(300_000);
  });
});

describe("aged receivables", () => {
  it("settles the oldest invoices first and ages the rest by due date", () => {
    const inv1 = rec("invoice", { date: "2026-06-01", customer: perera.id, total: 100_000 }, "posted"); // due Jul 1, 108 days late
    const inv2 = rec("invoice", { date: "2026-08-20", customer: perera.id, total: 50_000 }, "posted"); // due Sep 19, 28 days late
    const inv3 = rec("invoice", { date: "2026-10-10", customer: perera.id, total: 70_000, due_date: "2026-11-09" }, "posted"); // not yet due
    const inv4 = rec("invoice", { date: "2026-08-01", customer: lanka.id, total: 40_000 }, "posted"); // due Aug 1, 77 days late
    const s = snap(plastics, [
      ...masters, inv1, inv2, inv3, inv4,
      rec("receipt", { date: "2026-07-10", customer: perera.id, amount: 90_000, wht_deducted: 10_000 }, "posted"), // clears inv1
      rec("receipt", { date: "2026-10-01", customer: perera.id, amount: 20_000 }, "posted"), // 20k off inv2
      rec("receipt", { date: "2026-10-01", customer: perera.id, amount: 999_999 }, "draft"),
      rec("credit_note", { date: "2026-08-05", customer: lanka.id, invoice: inv4.id, total: 15_000 }, "posted"),
    ]);
    const r = ready(runReport(s, "aged_receivables", ctx));
    expect(r.rows).toEqual([
      { label: "Perera Stores", current: 70_000, d30: 30_000, d60: 0, d90: 0, over90: 0, total: 100_000, oldest: 28 },
      { label: "Lanka Dairies", current: 0, d30: 0, d60: 0, d90: 25_000, over90: 0, total: 25_000, oldest: 77 },
    ]);
    expect(r.headline!.value).toBe(55_000);
    expect(r.totals).toMatchObject({ total: 125_000, current: 70_000 });
  });
});

describe("daily takings", () => {
  it("adds up completed counter sales by day and tender", () => {
    const s = snap(bakeryC, [
      rec("pos_sale", { at: "2026-10-17T03:00:00.000Z", total: 50_000, tender: "cash" }, "completed"),
      rec("pos_sale", { at: "2026-10-17T05:00:00.000Z", total: 20_000, tender: "card" }, "completed"),
      rec("pos_sale", { at: "2026-10-17T05:00:00.000Z", total: 99_000, tender: "card" }, "refunded"),
      rec("pos_sale", { at: "2026-10-16T19:00:00.000Z", total: 10_000, tender: "cash" }, "completed"), // 00:30 on the 17th in Colombo
      rec("pos_sale", { at: "2026-10-15T08:00:00.000Z", total: 30_000, tender: "qr" }, "completed"),
    ]);
    const r = ready(runReport(s, "daily_takings", ctx));
    expect(r.headline!.value).toBe(80_000);
    expect(r.rows[0]).toMatchObject({ date: "2026-10-17", sales: 3, cash: 60_000, card: 20_000, total: 80_000 });
    expect(r.rows.find((x) => x.date === "2026-10-15")).toMatchObject({ qr: 30_000, total: 30_000 });
    expect(r.rows).toHaveLength(14);
    expect(r.totals).toMatchObject({ total: 110_000, sales: 4 });
  });
});

describe("purchases", () => {
  const acme = rec("vendor", { name: "Acme Resins", payment_terms_days: 30 }, "active");
  const pack = rec("vendor", { name: "Packwell", payment_terms_days: 0 }, "active");
  const power = rec("account", { code: "6001", name: "Electricity", type: "expense" }, "active");
  const rent = rec("account", { code: "6002", name: "Rent", type: "expense" }, "active");
  const bill1 = rec("bill", { date: "2026-10-01", vendor: acme.id, sub_total: 80_000, total: 94_400 }, "posted"); // due Oct 31
  const bill2 = rec("bill", { date: "2026-09-01", vendor: pack.id, sub_total: 20_000, total: 20_000 }, "posted"); // due Sep 1
  const bill3 = rec("bill", { date: "2026-10-15", vendor: pack.id, sub_total: 30_000, total: 30_000, due_date: "2026-10-20" }, "posted");
  const s = snap(plastics, [
    acme, pack, power, rent, bill1, bill2, bill3, ...masters,
    rec("bill", { date: "2026-10-02", vendor: acme.id, sub_total: 1, total: 1 }, "draft"),
    rec("vendor_credit", { date: "2026-10-05", vendor: acme.id, bill: bill1.id, sub_total: 10_000, total: 11_800 }, "posted"),
    rec("payment", { date: "2026-10-03", vendor: pack.id, amount: 5_000 }, "posted"),
    rec("expense", { date: "2026-10-02", account: power.id, amount: 30_000 }, "posted"),
    rec("expense", { date: "2026-10-09", account: power.id, amount: 10_000 }, "posted"),
    rec("expense", { date: "2026-10-01", account: rent.id, amount: 60_000 }, "posted"),
    rec("expense", { date: "2026-09-01", account: rent.id, amount: 60_000 }, "posted"),
    rec("purchase_order", { date: "2026-10-01", vendor: acme.id, expected_date: "2026-10-15", ...doc([line(cup.id, 100, 10, { received_qty: 25 })]) }, "partly_received", "PO-1"),
    rec("purchase_order", { date: "2026-10-01", vendor: acme.id, expected_date: "2026-10-30", ...doc([line(cup.id, 100, 10)]) }, "received", "PO-2"),
  ]);

  it("ranks suppliers by what was bought, net of credits", () => {
    const r = ready(runReport(s, "purchases_by_vendor", ctx));
    expect(r.rows.map((x) => [x.label, x.documents, x.amount])).toEqual([["Acme Resins", 1, 70_000], ["Packwell", 2, 50_000]]);
  });

  it("splits what is owed into overdue, this week and later", () => {
    const r = ready(runReport(s, "aged_payables", ctx));
    expect(r.rows).toEqual([
      { label: "Packwell", overdue: 15_000, week: 30_000, later: 0, total: 45_000, next_due: "2026-09-01" },
      { label: "Acme Resins", overdue: 0, week: 0, later: 82_600, total: 82_600, next_due: "2026-10-31" },
    ]);
    expect(r.headline!.value).toBe(45_000);
  });

  it("groups expenses by account", () => {
    const r = ready(runReport(s, "expense_summary", ctx));
    expect(r.rows.map((x) => [x.label, x.documents, x.amount, x.share])).toEqual([["Rent", 1, 60_000, 60], ["Electricity", 2, 40_000, 40]]);
    expect(r.headline!.value).toBe(100_000);
  });

  it("lists purchase orders still to arrive", () => {
    const r = ready(runReport(s, "open_purchase_orders", ctx));
    expect(r.rows.map((x) => [x.label, x.amount, x.days_late])).toEqual([["PO-1", 75_000, 2]]);
  });
});

describe("production", () => {
  const m1 = rec("resource", { code: "IMM-01", name: "Haitian 250T", type: "machine", hours_per_day: 20 }, "active");
  const m2 = rec("resource", { code: "IMM-02", name: "Haitian 160T", type: "machine", hours_per_day: 10 }, "active");
  const recipe = rec("recipe", { code: "R1", name: "Cup", item: cup.id, output_quantity: 1000, expected_yield_pct: 96, operations: [{ machine: m1.id, setup_minutes: 60, run_minutes: 120 }] }, "active");
  const running = rec("production_order", { recipe: recipe.id, item: cup.id, planned_quantity: 10_000, due_date: "2026-10-14" }, "in_progress", "PRD-1");
  const soon = rec("production_order", { recipe: recipe.id, item: lid.id, planned_quantity: 2_000, start_date: "2026-10-20", due_date: "2026-10-25" }, "scheduled", "PRD-2");
  const later = rec("production_order", { recipe: recipe.id, item: lid.id, planned_quantity: 2_000, start_date: "2026-11-20", due_date: "2026-11-25" }, "scheduled", "PRD-3");
  const done = rec("production_order", { recipe: recipe.id, item: lid.id, planned_quantity: 2_000, due_date: "2026-10-01" }, "completed", "PRD-4");
  const qc = (passed: boolean[]) => passed.map((p, i) => ({ check: ["Weight", "Lid fit"][i], value: p ? "OK" : "Out", passed: p }));
  const s = snap(plastics, [
    ...masters, m1, m2, recipe, running, soon, later, done,
    rec("batch", { production_order: running.id, machine: m1.id, output_quantity: 4_800, scrap_quantity: 200, mfg_date: "2026-10-05", qc_results: qc([true, true]) }, "released", "B1"),
    rec("batch", { production_order: running.id, machine: m2.id, output_quantity: 900, scrap_quantity: 100, mfg_date: "2026-10-08", qc_results: qc([true, false]) }, "qc_hold", "B2"),
    rec("batch", { production_order: done.id, machine: m2.id, output_quantity: 1_000, scrap_quantity: 0, mfg_date: "2026-10-09" }, "rejected", "B3"),
    rec("batch", { production_order: done.id, machine: m1.id, output_quantity: 999, scrap_quantity: 999, mfg_date: "2026-09-09" }, "released", "B4"),
    rec("inspection", { item: cup.id }, "failed"),
  ]);

  it("shows open orders with progress from their batches", () => {
    const r = ready(runReport(s, "production_status", ctx));
    expect(r.rows.map((x) => [x.label, x.status, x.made, x.progress])).toEqual([
      ["PRD-1", "In progress", 5_700, 57],
      ["PRD-2", "Scheduled", 0, 0],
      ["PRD-3", "Scheduled", 0, 0],
    ]);
    expect(r.headline!.value).toBe(1);
  });

  it("lists late orders", () => {
    const r = ready(runReport(s, "late_jobs", ctx));
    expect(r.rows.map((x) => [x.label, x.days_late])).toEqual([["PRD-1", 3]]);
  });

  it("works out yield by product and scrap by machine", () => {
    const y = ready(runReport(s, "yield", ctx));
    expect(y.rows.map((x) => [x.label, x.good, x.scrap, x.yield, x.expected])).toEqual([["Cup", 5_700, 300, 95, 96], ["Lid", 1_000, 0, 100, null]]);
    expect(y.headline!.value).toBe(95.7);

    const m = ready(runReport(s, "scrap_by_machine", ctx));
    expect(m.rows.map((x) => [x.label, x.scrap_pct])).toEqual([["Haitian 250T", 4], ["Haitian 160T", 5]].reverse() as never);
    expect(m.headline).toMatchObject({ text: "Haitian 160T", value: 5 });
  });

  it("counts failed checks, rejected batches and failed inspections", () => {
    const r = ready(runReport(s, "qc_failures", ctx));
    expect(r.rows.map((x) => [x.label, x.check])).toEqual(expect.arrayContaining([["B2", "Lid fit"], ["B3", "Batch rejected"]]));
    expect(r.headline!.value).toBe(3);
  });

  it("books machine hours from recipe operations for the next 7 days", () => {
    const r = ready(runReport(s, "capacity", ctx));
    // PRD-1: 4,300 left = 4.3 runs → 60 + 516 min = 9.6 h; PRD-2: 2 runs → 60 + 240 min = 5 h; PRD-3 starts too late.
    expect(r.rows.map((x) => [x.label, x.booked, x.available, x.load])).toEqual([["Haitian 250T", 14.6, 140, 10.4], ["Haitian 160T", 0, 70, 0]]);
  });
});

describe("periods", () => {
  it("compares month to date with the same days last month", () => {
    expect(previousPeriod(periodOf("month", today))).toEqual({ from: "2026-09-01", to: "2026-09-17" });
    expect(previousPeriod(periodOf("month", "2026-03-31"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod(periodOf("quarter", today))).toEqual({ from: "2026-04-21", to: "2026-07-19" });
  });
});

describe("access", () => {
  it("shows a report only to roles that can open its module", () => {
    const owner = reportsFor(plastics, "owner").map((r) => r.def.key);
    expect(owner).toEqual(expect.arrayContaining(["sales_summary", "aged_payables", "scrap_by_machine", "capacity"]));
    expect(owner).not.toContain("daily_takings"); // no counter in the factory

    const supervisor = new Set(reportsFor(plastics, "supervisor").map((r) => r.def.key));
    expect(supervisor.has("scrap_by_machine")).toBe(true);
    expect(supervisor.has("aged_receivables")).toBe(false);
  });

  it("honours the roles a business sets on a report", () => {
    const bp = Blueprint.parse({ ...plasticsFactory, reports: [{ key: "sales_summary", places: ["reports"], roles: ["rol_owner"] }] });
    const c = compile(bp);
    const sales = bp.roles.find((r) => r.key === "sales")!;
    expect(c.can(sales.key, "invoices", "view")).toBe(true);
    expect(reportsFor(c, "sales").map((r) => r.def.key)).not.toContain("sales_summary");
    expect(reportsFor(c, "owner")[0]!.def.key).toBe("sales_summary");
  });

  it("puts the demo factory's placed reports on their modules", () => {
    const placed = reportsFor(plastics, "owner").filter((r) => r.setting?.places.includes("module"));
    expect(placed.map((r) => [r.def.module, r.def.key])).toEqual(expect.arrayContaining([["sales", "sales_summary"], ["production", "production_status"]]));
  });

  it("has an engine for every report but budget against actual", () => {
    const records = REPORTS.filter((r) => r.key !== "budget_vs_actual").map((r) => r.key);
    expect(Object.keys(RECORD_REPORTS).sort()).toEqual([...records].sort());
  });
});

describe("demo workspaces", () => {
  for (const [name, c] of [["demo", plastics], ["bakery", bakeryC]] as const) {
    it(`gives ${name} real numbers on every tile and report`, async () => {
      const store = new MemoryStore();
      await seedDemoRecords(store, name, c, today);
      const keys = reportsFor(c, "owner").map((r) => r.def.key as ReportKey);
      const results = await runReports({ store, tenant: name, compiled: c, keys, ctx });
      for (const r of results) {
        if (r.state === "waiting") {
          expect(RECORD_REPORTS[r.key]).toBeUndefined();
          continue;
        }
        expect(r.rows.length, `${r.key} has rows`).toBeGreaterThan(0);
      }
      const tiles = await dashboardTiles({ store, tenant: name, compiled: c, roleKey: "owner", widgets: c.bp.dashboard, ctx });
      expect(tiles.size).toBe(c.bp.dashboard.length);
      for (const [id, t] of tiles) if (t.state === "ready" && id !== "wdg_approvals" && id !== "wdg_downtime") expect(t.value, id).not.toBeNull();
      const tb = results.find((r) => r.key === "trial_balance");
      expect(tb?.state === "ready" && tb.totals?.debit).toBe(tb?.state === "ready" && tb.totals?.credit);
      expect(tb?.state === "ready" && tb.headline?.label).toBe("The books balance");
      const sales = [...tiles.values()].find((t) => t.state === "ready" && t.label.startsWith("Sales"));
      expect(sales && sales.state === "ready" && sales.value).toBeGreaterThan(0);
    });
  }
});
