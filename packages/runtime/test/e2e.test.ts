import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Blueprint, applyOps } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import { ENGINE_TARGETS, MemoryStore, STOCK_LEVEL, compile, createExecutor, type Command, type CommandResult, type Compiled, type StoredRecord } from "../src";
import { accountTotals, runReport, snapshotOf, trialBalance } from "../src/reports";

/**
 * The whole ERP end to end through the command pipeline, as different
 * people: every module's documents from first draft to last step, approvals
 * (one and several stages, approve and reject, who may decide) and what
 * each role may and may not do. Every test ends by checking the books:
 * the trial balance balances, account balances agree with the entries, and
 * stock at cost equals the inventory accounts.
 */

const base = Blueprint.parse(plasticsFactory);
const roleId = (key: string) => base.roles.find((r) => r.key === key)!.id;
// Extra approval rules on top of the factory's own, to exercise every path.
const withRules = applyOps(base, [
  { op: "remove", id: base.approvals.find((a) => a.target === "purchase_order")?.id ?? "apr_none" },
  {
    op: "add",
    collection: "approvals",
    value: {
      id: "apr_bigpo",
      label: "Large purchase orders",
      target: "purchase_order",
      action: "issue",
      enabled: true,
      stages: [
        { id: "aps_po1", name: "Manager", minAmount: 250_000, roles: [roleId("manager")], requireAll: false },
        { id: "aps_po2", name: "Owner", minAmount: 1_000_000, roles: [roleId("owner")], requireAll: false },
      ],
    },
  },
  {
    op: "add",
    collection: "approvals",
    value: {
      id: "apr_bills",
      label: "Bills",
      target: "bill",
      action: "post",
      enabled: true,
      stages: [{ id: "aps_bill", name: "Accounts and manager", minAmount: 500_000, roles: [roleId("accountant"), roleId("manager")], requireAll: true }],
    },
  },
].filter((op) => op.op !== "remove" || op.id !== "apr_none") as never);
if (!withRules.ok) throw new Error(withRules.issues[0]?.message);
const bp = withRules.blueprint;
const compiled = compile(bp);

let store: MemoryStore;
/** The blueprint the executor runs on; a test can switch a setting. */
let active: Compiled;
let execute: ReturnType<typeof createExecutor>;
let n = 0;
const T = "t_e2e";

const person = (roleKey: string, id = `u_${roleKey}`) => ({ kind: "user", id, roleKey, channel: "web", displayName: id }) as const;
const owner = person("owner");
const manager = person("manager");
const manager2 = person("manager", "u_manager2");
const accountant = person("accountant");
const sales = person("sales");
const stores = person("stores");
const supervisor = person("supervisor");
const qc = person("qc");

function run(command: Command, actor: object = owner): Promise<CommandResult> {
  n++;
  return execute({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, tenantId: T, actor, command, issuedAt: "2026-10-16T08:00:00.000Z" });
}
async function ok(p: Promise<CommandResult>): Promise<string> {
  const r = await p;
  if (r.status !== "ok") throw new Error(JSON.stringify(r));
  return r.recordId!;
}
const act = (target: string, recordId: string, action: string, actor: object = owner, data?: Record<string, unknown>) => run({ type: "record.action", target, recordId, action, data } as Command, actor);
const convert = (from: string, recordId: string, to: string, data?: Record<string, unknown>, actor: object = owner) => run({ type: "record.convert", from, recordId, to, data } as Command, actor);
const create = (target: string, data: Record<string, unknown>, actor: object = owner) => run({ type: "record.create", target, data }, actor);
const get = (target: string, id: string) => store.read(T, (tx) => tx.get(target, id));
const status = async (target: string, id: string) => (await get(target, id))?.status;
const code = (r: CommandResult) => (r.status === "error" ? r.error.code : r.status);

/** A new empty workspace on this blueprint. */
function fresh(c: Compiled = compiled) {
  store = new MemoryStore();
  active = c;
  let i = 0;
  execute = createExecutor({ store, blueprint: async () => active, now: () => new Date("2026-10-16T08:00:00Z"), newId: (p) => `${p}${++i}` });
}
beforeEach(() => fresh());

async function masters() {
  const customer = await ok(create("customer", { name: "Perera Stores", payment_terms_days: 30 }));
  const vendor = await ok(create("vendor", { name: "Lanka Resins" }));
  const item = await ok(create("item", { name: "500 ml container", type: "goods" }));
  const resin = await ok(create("item", { name: "PP resin", type: "goods" }));
  const wh = await ok(create("warehouse", { code: "FG", name: "Finished goods", kind: "finished_goods" }));
  const rm = await ok(create("warehouse", { code: "RM", name: "Raw materials", kind: "raw_material" }));
  const bank = await ok(create("bank_account", { name: "BOC current", kind: "bank" }));
  return { customer, vendor, item, resin, wh, rm, bank };
}

/* ------------------------------------------------------------- books */

/** Everything the reports and checks read: records, journal, stock. */
async function snap() {
  const targets = [...compiled.targets.keys(), ...ENGINE_TARGETS];
  const records: Record<string, StoredRecord[]> = {};
  await store.read(T, async (tx) => {
    for (const t of targets) records[t] = await tx.list(t);
  });
  return snapshotOf(active, records);
}
/** Balance of the account with this code, on its normal side, in minor units. */
async function bal(code: string): Promise<number> {
  const acc = (await store.read(T, (tx) => tx.list("account"))).find((a) => a.data.code === code);
  return (acc?.data.balance as number | undefined) ?? 0;
}
const field = async (target: string, id: string, key: string) => (await get(target, id))?.data[key];
const onHand = (item: string) => field("item", item, "on_hand");
/** Approve whatever a command waits for, as the owner. */
async function settle(r: CommandResult): Promise<CommandResult> {
  for (let k = 0; k < 4 && r.status === "pending_approval"; k++) r = await run({ type: "approval.decide", approvalId: r.approvalId, decision: "approve" }, owner);
  return r;
}
const done = async (p: Promise<CommandResult>) => {
  const r = await settle(await p);
  if (r.status !== "ok") throw new Error(JSON.stringify(r));
  return r;
};
/** Opening stock from a count, posted. */
async function opening(item: string, warehouse: string, quantity: number, unitCost: number, reason = "opening") {
  const adj = await ok(create("stock_adjustment", { warehouse, date: "2026-10-16", reason, lines: [{ item, quantity_delta: quantity, unit_cost: unitCost }] }));
  await done(act("stock_adjustment", adj, "post"));
  return adj;
}
/** Every account's balance, to compare before and after a void. */
async function balances() {
  return Object.fromEntries((await store.read(T, (tx) => tx.list("account"))).map((a) => [a.data.code, a.data.balance ?? 0]));
}

afterEach(async () => {
  const s = await snap();
  // The books always balance.
  const tb = trialBalance(s);
  expect(tb.debit).toBe(tb.credit);
  // Balances kept on accounts agree with the entries.
  const totals = new Map(accountTotals(s).map((a) => [a.account, a.balance]));
  for (const a of s.list("account")) expect(a.data.balance ?? 0, `account ${a.data.code}`).toBe(totals.get(a.id) ?? 0);
  // Stock at cost equals the inventory accounts (work in progress isn't stock).
  const stockValue = s.list(STOCK_LEVEL).reduce((t, l) => t + (l.data.value as number), 0);
  const inventory = s.list("account").filter((a) => ["1310", "1330", "1340"].includes(String(a.data.code))).reduce((t, a) => t + ((a.data.balance as number) ?? 0), 0);
  expect(stockValue).toBe(inventory);
});

/* ------------------------------------------------------------- flows */

describe("sales: quote to cash", () => {
  it("runs quote, order, delivery, invoice and payment, moving stock and posting each step", async () => {
    const m = await masters();
    await opening(m.item, m.wh, 2000, 40);
    expect(await onHand(m.item)).toBe(2000);
    expect(await bal("1330")).toBe(8_000_000);
    expect(await bal("3900")).toBe(8_000_000);

    const quote = await ok(create("quote", { customer: m.customer, date: "2026-10-16", lines: [{ item: m.item, quantity: 1000, unit_price: 60 }] }, sales));
    expect(code(await act("quote", quote, "send", sales))).toBe("ok");
    expect(code(await act("quote", quote, "accept", sales))).toBe("ok");
    const so = await ok(convert("quote", quote, "sales_order", undefined, sales));
    expect(await status("quote", quote)).toBe("converted");
    const order = await get("sales_order", so);
    expect(order?.data.lines).toHaveLength(1);

    expect(code(await act("sales_order", so, "confirm", sales))).toBe("forbidden"); // confirming needs the approve right
    expect(code(await act("sales_order", so, "confirm", manager))).toBe("ok");
    expect((await get("sales_order", so))?.number).toMatch(/^SO-2026-/);

    const dn = await ok(convert("sales_order", so, "delivery_note", { warehouse: m.wh }, stores));
    const dispatched = await act("delivery_note", dn, "dispatch", stores);
    expect(dispatched).toMatchObject({ status: "ok", effects: { posted: { moves: 1 } } });
    // A thousand containers leave at their cost of 40 each.
    expect(await onHand(m.item)).toBe(1000);
    expect(await bal("5100")).toBe(4_000_000);
    expect(await bal("1330")).toBe(4_000_000);

    const inv = await ok(convert("delivery_note", dn, "invoice", undefined, sales));
    // The delivery note has no prices: the invoice takes them from the sales order behind it.
    expect(((await get("invoice", inv))?.data.lines as { unit_price: number }[])[0]!.unit_price).toBe(6000);
    expect(code(await act("invoice", inv, "post", sales))).toBe("forbidden"); // sales drafts, accounts posts
    expect(code(await act("invoice", inv, "post", accountant))).toBe("ok");
    const posted = await get("invoice", inv);
    expect(posted).toMatchObject({ status: "posted", data: { payment_status: "unpaid", amount_due: 6_000_000 } });
    expect(posted?.data.due_date).toBe("2026-11-15");
    expect(await bal("1210")).toBe(6_000_000);
    expect(await bal("4100")).toBe(6_000_000);
    expect(await field("customer", m.customer, "balance")).toBe(6_000_000);

    // Paid in two parts: partly paid, then paid.
    const rc = await ok(convert("invoice", inv, "receipt", { amount: 40000, deposit_to: m.bank }, accountant));
    expect(code(await act("receipt", rc, "post", accountant))).toBe("ok");
    expect(await get("invoice", inv)).toMatchObject({ data: { payment_status: "partly_paid", amount_due: 2_000_000 } });
    const rc2 = await ok(convert("invoice", inv, "receipt", { deposit_to: m.bank }, accountant));
    expect(await field("receipt", rc2, "amount")).toBe(2_000_000); // what was still owed
    expect(code(await act("receipt", rc2, "post", accountant))).toBe("ok");
    expect(await get("invoice", inv)).toMatchObject({ data: { payment_status: "paid", amount_due: 0 } });
    expect(await field("bank_account", m.bank, "balance")).toBe(6_000_000);
    expect(await bal("1120")).toBe(6_000_000);
    expect(await bal("1210")).toBe(0);
    expect(await field("customer", m.customer, "balance")).toBe(0);

    // A paid invoice can't be voided; voiding the receipt puts the amount back.
    expect(code(await act("invoice", inv, "void", accountant))).toBe("engine_rule");
    await done(act("receipt", rc2, "void", accountant));
    expect(await get("invoice", inv)).toMatchObject({ data: { payment_status: "partly_paid", amount_due: 2_000_000 } });
    expect(await field("bank_account", m.bank, "balance")).toBe(4_000_000);

    // Voiding the delivery brings the goods back at exactly what they left at.
    await done(act("delivery_note", dn, "void", manager));
    expect(await onHand(m.item)).toBe(2000);
    expect(await bal("5100")).toBe(0);
    expect(await bal("1330")).toBe(8_000_000);
  });

  it("raises a credit note against a posted invoice, and refuses to edit or delete posted documents", async () => {
    const m = await masters();
    await opening(m.item, m.wh, 50, 30);
    const inv = await ok(create("invoice", { customer: m.customer, date: "2026-10-16", lines: [{ item: m.item, quantity: 10, unit_price: 100 }] }));
    expect(code(await convert("invoice", inv, "credit_note"))).toBe("conflict"); // draft first
    await ok(act("invoice", inv, "post"));
    expect(await bal("1210")).toBe(100_000);
    const cn = await ok(convert("invoice", inv, "credit_note"));
    // The template holds every credit note for a manager or the owner.
    const held = await act("credit_note", cn, "post", accountant);
    expect(held.status).toBe("pending_approval");
    expect(await run({ type: "approval.decide", approvalId: held.status === "pending_approval" ? held.approvalId : "", decision: "approve" }, manager)).toMatchObject({ status: "ok", effects: { approval: "approved" } });
    expect(await status("credit_note", cn)).toBe("posted");
    // The goods come back at their cost and the invoice is settled by the credit.
    expect(await onHand(m.item)).toBe(60);
    expect(await bal("1330")).toBe(180_000);
    expect(await bal("1210")).toBe(0);
    expect(await bal("4100")).toBe(0);
    expect(await get("invoice", inv)).toMatchObject({ data: { payment_status: "paid", amount_due: 0 } });

    expect(code(await run({ type: "record.update", target: "invoice", recordId: inv, patch: { notes: "x" } }))).toBe("engine_rule");
    expect(code(await run({ type: "record.delete", target: "invoice", recordId: inv }))).toBe("engine_rule");
    expect(code(await act("invoice", inv, "void"))).toBe("engine_rule"); // the credit note settles it
    await done(act("credit_note", cn, "void"));
    expect(await get("invoice", inv)).toMatchObject({ data: { payment_status: "unpaid", amount_due: 100_000 } });
    expect(code(await act("invoice", inv, "void"))).toBe("ok");
    expect(await bal("1210")).toBe(0);
    expect(await onHand(m.item)).toBe(50);
  });
});

describe("buying: order to payment", () => {
  it("runs purchase order, goods received, bill and payment", async () => {
    const m = await masters();
    const po = await ok(create("purchase_order", { vendor: m.vendor, date: "2026-10-16", lines: [{ item: m.resin, quantity: 100, unit_price: 500 }] }, manager));
    expect(code(await act("purchase_order", po, "issue", manager))).toBe("ok"); // 50,000: under every threshold
    const grn = await ok(convert("purchase_order", po, "goods_receipt", { warehouse: m.rm }, stores));
    expect(code(await act("goods_receipt", grn, "post", stores))).toBe("ok");
    // Received at the order's price, into raw materials, owed until billed.
    expect(await onHand(m.resin)).toBe(100);
    expect(await field("item", m.resin, "avg_cost")).toBe(50_000);
    expect(await field("goods_receipt", grn, "total")).toBe(5_000_000);
    expect(await bal("1310")).toBe(5_000_000);
    expect(await bal("2130")).toBe(5_000_000);

    const bill = await ok(convert("goods_receipt", grn, "bill", undefined, accountant));
    expect(((await get("bill", bill))?.data.lines as { unit_price: number }[])[0]!.unit_price).toBe(50000);
    const b = await get("bill", bill);
    expect((b?.data.lines as unknown[])?.length).toBe(1);
    expect(code(await act("bill", bill, "post", accountant))).toBe("ok");
    expect(await bal("2130")).toBe(0);
    expect(await bal("2110")).toBe(5_000_000);
    expect(await field("vendor", m.vendor, "balance")).toBe(5_000_000);
    const pay = await ok(convert("bill", bill, "payment", { paid_from: m.bank }, accountant));
    expect(code(await act("payment", pay, "post", accountant))).toBe("ok");
    expect(await get("bill", bill)).toMatchObject({ data: { payment_status: "paid", amount_due: 0 } });
    expect(await bal("2110")).toBe(0);
    expect(await field("bank_account", m.bank, "balance")).toBe(-5_000_000);

    // Voiding the goods received after they were billed takes the stock back out at what it came in at.
    await done(act("goods_receipt", grn, "void", manager));
    expect(await onHand(m.resin)).toBe(0);
    expect(await bal("1310")).toBe(0);
  });

  it("returns goods to the supplier with a vendor credit", async () => {
    const m = await masters();
    const grn = await ok(create("goods_receipt", { vendor: m.vendor, warehouse: m.rm, date: "2026-10-16", lines: [{ item: m.resin, quantity: 5, unit_cost: 100 }] }, stores));
    await done(act("goods_receipt", grn, "post", manager));
    // Billed at a higher price than received at: the difference waits in goods not yet billed.
    const bill = await ok(create("bill", { vendor: m.vendor, date: "2026-10-16", lines: [{ item: m.resin, quantity: 5, unit_price: 120 }] }, accountant));
    await ok(act("bill", bill, "post", accountant));
    expect(await bal("2130")).toBe(-10_000);
    const vc = await ok(convert("bill", bill, "vendor_credit", undefined, accountant));
    expect(code(await act("vendor_credit", vc, "post", accountant))).toBe("ok");
    expect(await onHand(m.resin)).toBe(0);
    expect(await bal("1310")).toBe(0);
    expect(await bal("2130")).toBe(0);
    expect(await bal("2110")).toBe(0);
    expect(await get("bill", bill)).toMatchObject({ data: { payment_status: "paid", amount_due: 0 } });
  });
});

describe("production: recipe to released batch", () => {
  it("activates a recipe, schedules an order, and runs a batch through quality release", async () => {
    const m = await masters();
    await opening(m.resin, m.rm, 200, 50);
    const recipe = await ok(create("recipe", { code: "C500", name: "500 ml container", item: m.item, output_quantity: 1000, lines: [{ item: m.resin, quantity: 20 }] }, manager));
    expect(code(await act("recipe", recipe, "activate", manager))).toBe("ok");
    const order = await ok(create("production_order", { recipe, item: m.item, planned_quantity: 5000 }, supervisor));
    expect(code(await act("production_order", order, "schedule", supervisor))).toBe("forbidden");
    expect(code(await act("production_order", order, "schedule", manager))).toBe("ok");
    expect(code(await act("production_order", order, "start", manager))).toBe("ok");
    const batch = await ok(convert("production_order", order, "batch", { planned_quantity: 5000 }, supervisor));
    for (const a of ["issue_materials", "start", "finish"]) expect(code(await act("batch", batch, a, manager)), a).toBe("ok");
    // 100 kg of resin at 50 went in; 5,000 containers came out on hold, carrying that cost.
    expect(await onHand(m.resin)).toBe(100);
    expect(await field("batch", batch, "material_cost")).toBe(500_000);
    expect(await field("batch", batch, "unit_cost")).toBe(100);
    expect(await bal("1320")).toBe(0);
    expect(await bal("1330")).toBe(500_000);
    expect(await onHand(m.item)).toBe(5000);
    const s1 = await snap();
    expect(s1.list(STOCK_LEVEL).find((l) => l.data.item === m.item && l.data.held)?.data.qty).toBe(5000);

    expect(code(await act("batch", batch, "release", supervisor))).toBe("forbidden"); // quality releases
    expect(code(await act("batch", batch, "release", qc))).toBe("ok");
    expect(await status("batch", batch)).toBe("released");
    const s2 = await snap();
    expect(s2.list(STOCK_LEVEL).find((l) => l.data.item === m.item && !l.data.held)).toMatchObject({ data: { qty: 5000, value: 500_000, warehouse: m.wh } });
    const cost = runReport(s2, "batch_cost", { today: "2026-10-16", timezone: "Asia/Colombo" });
    expect(cost.state === "ready" && cost.rows[0]).toMatchObject({ material: 500_000, total: 500_000, unit_cost: 100, output: 5000 });

    expect(code(await act("production_order", order, "complete", manager))).toBe("ok");
    // Buy shortages: the recipe's materials for the planned quantity (20 per 1,000, so 100 for 5,000).
    const po = await ok(convert("production_order", order, "purchase_order", { vendor: m.vendor }, manager));
    expect((await get("purchase_order", po))?.data.lines).toEqual([expect.objectContaining({ item: m.resin, quantity: 100 })]);
  });
});

describe("stock and accounts", () => {
  it("posts a stock count and moves stock between stores", async () => {
    const m = await masters();
    await opening(m.item, m.wh, 10, 40);
    await opening(m.resin, m.rm, 10, 50);
    const adj = await ok(create("stock_adjustment", { warehouse: m.wh, date: "2026-10-16", reason: "count", lines: [{ item: m.item, quantity_delta: -3 }] }, stores));
    expect(code(await act("stock_adjustment", adj, "post", stores))).toBe("forbidden"); // stores counts, a manager posts
    expect(code(await act("stock_adjustment", adj, "post", manager))).toBe("ok");
    expect(await onHand(m.item)).toBe(7);
    expect(await bal("5200")).toBe(12_000);

    const tr = await ok(create("stock_transfer", { from_warehouse: m.rm, to_warehouse: m.wh, date: "2026-10-16", lines: [{ item: m.resin, quantity: 10 }] }, stores));
    expect(code(await act("stock_transfer", tr, "send", stores))).toBe("ok");
    expect(await onHand(m.resin)).toBe(0); // on the road
    expect(code(await act("stock_transfer", tr, "receive", stores))).toBe("ok");
    expect(await onHand(m.resin)).toBe(10);
    // Raw materials to finished goods: the value moves between the two stock accounts.
    expect(await bal("1310")).toBe(0);
    expect(await bal("1330")).toBe(28_000 + 50_000);
  });

  it("posts a balanced journal, refuses an unbalanced one, and reverses exactly", async () => {
    const cash = await ok(create("account", { code: "1010", name: "Cash", type: "asset" }, accountant));
    const sales_ = await ok(create("account", { code: "4010", name: "Sales", type: "income" }, accountant));
    const bad = await ok(create("journal", { date: "2026-10-16", narration: "Wrong", lines: [{ account: cash, debit: 100 }, { account: sales_, credit: 90 }] }, accountant));
    expect(code(await act("journal", bad, "post", accountant))).toBe("engine_rule");
    const good = await ok(create("journal", { date: "2026-10-16", narration: "Cash sale", lines: [{ account: cash, debit: 100 }, { account: sales_, credit: 100 }] }, accountant));
    // Manual journals wait for the owner.
    const held = await act("journal", good, "post", accountant);
    expect(held.status).toBe("pending_approval");
    expect(code(await run({ type: "approval.decide", approvalId: held.status === "pending_approval" ? held.approvalId : "", decision: "approve" }, owner))).toBe("ok");
    expect(await status("journal", good)).toBe("posted");
    expect(await bal("1010")).toBe(10_000);
    expect(await bal("4010")).toBe(10_000);
    expect(code(await create("journal", { date: "2026-10-16", narration: "x", lines: [] }, sales))).toBe("forbidden");
    await done(act("journal", good, "reverse"));
    expect(await bal("1010")).toBe(0);
    expect(await bal("4010")).toBe(0);
  });
});

describe("the engines", () => {
  it("costs by weighted average, or first in first out when the business chooses", async () => {
    const issueValue = async () => {
      const m = await masters();
      await opening(m.resin, m.rm, 10, 10);
      await opening(m.resin, m.rm, 10, 20);
      await opening(m.resin, m.rm, -15, 0, "count");
      return { m, value: await bal("5200") };
    };
    expect((await issueValue()).value).toBe(15 * 1500);
    fresh(compile({ ...bp, settings: { ...bp.settings, inventory: { ...bp.settings.inventory, costingMethod: "fifo" } } }));
    const fifo = await issueValue();
    expect(fifo.value).toBe(10 * 1000 + 5 * 2000);
    expect(await field("item", fifo.m.resin, "avg_cost")).toBe(2000);
  });

  it("blocks, warns about or allows stock going below zero, per the setting", async () => {
    const m = await masters();
    const dn = await ok(create("delivery_note", { customer: m.customer, warehouse: m.wh, date: "2026-10-16", lines: [{ item: m.item, quantity: 5 }] }));
    const blocked = await act("delivery_note", dn, "dispatch");
    expect(blocked.status === "error" && blocked.error).toMatchObject({ code: "engine_rule", message: "Not enough 500 ml container in Finished goods: 0 on hand, 5 needed." });
    expect(await status("delivery_note", dn)).toBe("draft"); // nothing was changed
    active = compile({ ...bp, settings: { ...bp.settings, inventory: { ...bp.settings.inventory, negativeStock: "warn" } } });
    const warned = await act("delivery_note", dn, "dispatch");
    expect(warned.status === "ok" && warned.warnings[0]?.message).toMatch(/below zero/);
    expect(await onHand(m.item)).toBe(-5);
    // The next goods in fill the gap.
    await opening(m.item, m.wh, 10, 40);
    expect(await onHand(m.item)).toBe(5);
  });

  it("posts VAT when registered, and settles it with a VAT return", async () => {
    const m = await masters();
    const vat = await ok(create("tax_code", { name: "VAT 18%", rate: 18, kind: "vat" }));
    const inv = await ok(create("invoice", { customer: m.customer, date: "2026-10-16", lines: [{ description: "Moulds", quantity: 1, unit_price: 1000, tax_code: vat }] }));
    await done(act("invoice", inv, "post"));
    expect(await bal("1210")).toBe(118_000);
    expect(await bal("4100")).toBe(100_000);
    expect(await bal("2210")).toBe(18_000);
    const bill = await ok(create("bill", { vendor: m.vendor, date: "2026-10-16", lines: [{ description: "Repairs", quantity: 1, unit_price: 500, tax_code: vat }] }));
    await done(act("bill", bill, "post"));
    expect(await bal("1240")).toBe(9_000);
    expect(await bal("6900")).toBe(50_000);
    const summary = runReport(await snap(), "vat_summary", { today: "2026-10-16", timezone: "Asia/Colombo" });
    expect(summary.state === "ready" && summary.headline?.value).toBe(9_000);

    const ret = await ok(create("vat_return", { period: "2026-10" }));
    for (const a of ["finalise", "file", "pay"]) await done(act("vat_return", ret, a));
    expect(await get("vat_return", ret)).toMatchObject({ data: { output_vat: 18_000, input_vat: 9_000, net_payable: 9_000 } });
    expect(await bal("2210")).toBe(0);
    expect(await bal("1240")).toBe(0);
    expect(await field("bank_account", m.bank, "balance")).toBe(-9_000);
  });

  it("posts GST in India as CGST and SGST within the state and IGST between states, and settles each part", async () => {
    const india = applyOps(bp, [
      { op: "set_business", patch: { country: "IN", currency: "INR", locale: "en-IN", timezone: "Asia/Kolkata" } },
      { op: "set_setting", path: "tax.registered", value: ["gst"] },
      { op: "set_setting", path: "tax.invoiceFormat", value: "in_gst" },
    ]);
    if (!india.ok) throw new Error(india.issues[0]?.message);
    fresh(compile(india.blueprint));
    const m = await masters();
    const gst = await ok(create("tax_code", { name: "GST 18%", rate: 18, kind: "vat", tax: "gst" }));
    const igst = await ok(create("tax_code", { name: "IGST 18%", rate: 18, kind: "vat", tax: "igst" }));
    const inv = await ok(
      create("invoice", {
        customer: m.customer,
        date: "2026-10-16",
        lines: [
          { description: "Moulds, within the state", quantity: 1, unit_price: 1000, tax_code: gst },
          { description: "Moulds, to another state", quantity: 1, unit_price: 2000, tax_code: igst },
        ],
      }),
    );
    await done(act("invoice", inv, "post"));
    expect(await bal("1210")).toBe(354_000);
    expect(await bal("4100")).toBe(300_000);
    expect([await bal("2211"), await bal("2212"), await bal("2210")]).toEqual([9_000, 9_000, 36_000]);
    const accounts = await store.read(T, (tx) => tx.list("account"));
    expect(accounts.find((a) => a.data.code === "2211")?.data.name).toBe("CGST output");
    expect(accounts.find((a) => a.data.code === "2210")?.data.name).toBe("IGST output");

    const bill = await ok(create("bill", { vendor: m.vendor, date: "2026-10-16", lines: [{ description: "Repairs", quantity: 1, unit_price: 500, tax_code: gst }] }));
    await done(act("bill", bill, "post"));
    expect([await bal("1241"), await bal("1242")]).toEqual([4_500, 4_500]);
    const summary = runReport(await snap(), "vat_summary", { today: "2026-10-16", timezone: "Asia/Kolkata" });
    expect(summary.label).toBe("GST summary");
    expect(summary.state === "ready" && summary.headline).toMatchObject({ label: "GST payable for the period", value: 45_000 });
    expect(summary.state === "ready" && summary.rows.map((r) => r.label)).toEqual(["CGST on sales", "SGST on sales", "IGST on sales", "CGST on purchases you can claim", "SGST on purchases you can claim", "IGST on purchases you can claim"]);

    const ret = await ok(create("vat_return", { period: "2026-10" }));
    for (const a of ["finalise", "file", "pay"]) await done(act("vat_return", ret, a));
    expect(await get("vat_return", ret)).toMatchObject({ data: { output_vat: 54_000, input_vat: 9_000, net_payable: 45_000 } });
    for (const c of ["2210", "2211", "2212", "1241", "1242"]) expect(await bal(c), c).toBe(0);
    expect(await field("bank_account", m.bank, "balance")).toBe(-45_000);
  });

  it("keeps a sales tax in the cost of purchases, as in the US", async () => {
    const us = applyOps(bp, [
      { op: "set_business", patch: { country: "US", currency: "USD", locale: "en-US", timezone: "America/Chicago" } },
      { op: "set_setting", path: "tax.registered", value: ["sales_tax"] },
    ]);
    if (!us.ok) throw new Error(us.issues[0]?.message);
    fresh(compile(us.blueprint));
    const m = await masters();
    const tx = await ok(create("tax_code", { name: "Texas sales tax 8.25%", rate: 8.25, kind: "sales_tax", tax: "sales_tax" }));
    const inv = await ok(create("invoice", { customer: m.customer, date: "2026-10-16", lines: [{ description: "Moulds", quantity: 1, unit_price: 1000, tax_code: tx }] }));
    await done(act("invoice", inv, "post"));
    expect(await bal("2210")).toBe(8_250);
    const bill = await ok(create("bill", { vendor: m.vendor, date: "2026-10-16", lines: [{ description: "Repairs", quantity: 1, unit_price: 500, tax_code: tx }] }));
    await done(act("bill", bill, "post"));
    expect(await bal("1240")).toBe(0);
    expect(await bal("6900")).toBe(54_125);
  });

  it("voids leave every account exactly as before", async () => {
    const m = await masters();
    await opening(m.item, m.wh, 7, 33.33);
    const before = await balances();
    const dn = await ok(create("delivery_note", { customer: m.customer, warehouse: m.wh, date: "2026-10-16", lines: [{ item: m.item, quantity: 3 }] }));
    await done(act("delivery_note", dn, "dispatch"));
    const inv = await ok(create("invoice", { customer: m.customer, date: "2026-10-16", lines: [{ item: m.item, quantity: 3, unit_price: 77.77, discount_pct: 3 }] }));
    await done(act("invoice", inv, "post"));
    await done(act("invoice", inv, "void"));
    await done(act("delivery_note", dn, "void"));
    const after = await balances();
    for (const [k, v] of Object.entries(after)) expect(v, k).toBe(before[k] ?? 0);
    expect(await onHand(m.item)).toBe(7);
  });

  it("makes the stock and ledger reports ready", async () => {
    const m = await masters();
    await opening(m.item, m.wh, 100, 40);
    await ok(create("item", { name: "Lids", type: "goods", reorder_level: 50, min_order_qty: 200 }));
    const inv = await ok(create("invoice", { customer: m.customer, date: "2026-10-16", lines: [{ item: m.item, quantity: 10, unit_price: 60 }] }));
    await done(act("invoice", inv, "post"));
    const s = await snap();
    const ctx = { today: "2026-10-16", timezone: "Asia/Colombo" };
    const r = (key: Parameters<typeof runReport>[1]) => runReport(s, key, ctx);
    for (const key of ["stock_on_hand", "stock_valuation", "reorder", "stock_movement", "profit_and_loss", "balance_sheet", "trial_balance", "cash_position", "cash_flow", "gross_margin"] as const) expect(r(key).state, key).toBe("ready");
    const valuation = r("stock_valuation");
    expect(valuation.state === "ready" && valuation.headline?.value).toBe(400_000);
    const pl = r("profit_and_loss");
    expect(pl.state === "ready" && pl.headline?.value).toBe(60_000);
    const reorderRows = r("reorder");
    expect(reorderRows.state === "ready" && reorderRows.rows).toEqual([expect.objectContaining({ label: "Lids", on_hand: 0, suggested: 200 })]);
    const bs = r("balance_sheet");
    // Stock 4,000 and a receivable of 600 against opening equity of 4,000 and the period's profit.
    expect(bs.state === "ready" && bs.headline?.value).toBe(460_000);
    expect(bs.state === "ready" && bs.totals?.amount).toBe(460_000);
  });
});

/* --------------------------------------------------------- approvals */

describe("approvals", () => {
  async function bigPo(amount: number, by = manager) {
    const m = await masters();
    return ok(create("purchase_order", { vendor: m.vendor, date: "2026-10-16", lines: [{ item: m.resin, quantity: 1, unit_price: amount }] }, by));
  }
  const approvalOf = (r: CommandResult) => (r.status === "pending_approval" ? r.approvalId : "");
  const decide = (approvalId: string, decision: "approve" | "reject", actor: object) => run({ type: "approval.decide", approvalId, decision }, actor);

  it("lets small amounts through, holds mid amounts for one stage and large ones for two", async () => {
    expect(code(await act("purchase_order", await bigPo(100_000), "issue", manager))).toBe("ok");
    const mid = await act("purchase_order", await bigPo(500_000), "issue", manager);
    expect(mid).toMatchObject({ status: "pending_approval", reason: expect.stringMatching(/^Waiting for Manager \(/) });
    const big = await act("purchase_order", await bigPo(2_000_000), "issue", manager);
    expect(big).toMatchObject({ status: "pending_approval", reason: expect.stringMatching(/Manager, then Owner/) });
  });

  it("goes stage by stage: not the requester, not the wrong role, then carries out the action", async () => {
    const po = await bigPo(2_000_000);
    const held = await act("purchase_order", po, "issue", manager);
    const id = approvalOf(held);
    expect(code(await decide(id, "approve", manager))).toBe("forbidden"); // own request
    expect(code(await decide(id, "approve", sales))).toBe("forbidden"); // wrong role
    expect(code(await run({ type: "record.update", target: "purchase_order", recordId: po, patch: { notes: "sneaky" } }, manager))).toBe("conflict"); // locked while waiting
    expect(await decide(id, "approve", manager2)).toMatchObject({ status: "ok", effects: { approval: "next_stage" } });
    expect(await status("purchase_order", po)).toBe("draft");
    expect(code(await decide(id, "approve", manager2))).toBe("forbidden"); // owner's stage now
    expect(await decide(id, "approve", owner)).toMatchObject({ status: "ok", effects: { approval: "approved" } });
    expect(await status("purchase_order", po)).toBe("issued");
    expect(code(await decide(id, "approve", owner))).toBe("conflict"); // already decided
  });

  it("leaves the record as it was when rejected, and lets it be asked again", async () => {
    const po = await bigPo(500_000);
    const id = approvalOf(await act("purchase_order", po, "issue", manager));
    expect(await decide(id, "reject", owner)).toMatchObject({ status: "ok", effects: { approval: "rejected" } });
    expect(await get("purchase_order", po)).toMatchObject({ status: "draft" });
    expect((await get("purchase_order", po))?.pendingApproval).toBeUndefined();
    expect(code(await act("purchase_order", po, "issue", manager))).toBe("pending_approval");
  });

  it("needs one person from each role when a stage says all must approve", async () => {
    const m = await masters();
    const bill = await ok(create("bill", { vendor: m.vendor, date: "2026-10-16", lines: [{ item: m.resin, quantity: 1, unit_price: 600_000 }] }, owner));
    const id = approvalOf(await act("bill", bill, "post", owner));
    expect(id).not.toBe("");
    const first = await decide(id, "approve", accountant);
    expect(first.status).toBe("ok");
    expect(await status("bill", bill)).toBe("draft"); // still waiting for the manager
    expect(code(await decide(id, "approve", person("accountant", "u_acc2")))).toBe("conflict"); // accounts already signed
    expect(await decide(id, "approve", manager)).toMatchObject({ status: "ok", effects: { approval: "approved" } });
    expect(await status("bill", bill)).toBe("posted");
  });
});

/* ------------------------------------------------------- permissions */

describe("permissions", () => {
  it("refuses each role what it isn't given, across modules", async () => {
    const m = await masters();
    const cases: [object, Command, string][] = [
      [stores, { type: "record.create", target: "invoice", data: { customer: m.customer, date: "2026-10-16" } }, "forbidden"],
      [qc, { type: "record.create", target: "purchase_order", data: { vendor: m.vendor, date: "2026-10-16" } }, "forbidden"],
      [sales, { type: "record.create", target: "bill", data: { vendor: m.vendor, date: "2026-10-16" } }, "forbidden"],
      [supervisor, { type: "record.create", target: "customer", data: { name: "X" } }, "forbidden"],
      [sales, { type: "record.create", target: "account", data: { code: "9", name: "X", type: "asset" } }, "forbidden"],
      [manager, { type: "record.create", target: "journal", data: { date: "2026-10-16", narration: "x" } }, "forbidden"],
      [sales, { type: "record.create", target: "quote", data: { customer: m.customer, date: "2026-10-16", lines: [{ item: m.item, quantity: 1 }] } }, "ok"],
      [stores, { type: "record.create", target: "goods_receipt", data: { vendor: m.vendor, warehouse: m.rm, date: "2026-10-16", lines: [{ item: m.resin, quantity: 5 }] } }, "ok"],
      [accountant, { type: "record.create", target: "expense", data: { date: "2026-10-16", account: await ok(create("account", { code: "6010", name: "Rent", type: "expense" })), amount: 1000, paid_from: m.bank } }, "ok"],
    ];
    for (const [actor, cmd, want] of cases) expect(code(await run(cmd, actor)), `${(actor as { roleKey: string }).roleKey} ${cmd.type} ${"target" in cmd ? cmd.target : ""}`).toBe(want);
  });

  it("can't create a document by converting into a screen the role can't use", async () => {
    const m = await masters();
    const so = await ok(create("sales_order", { customer: m.customer, date: "2026-10-16", lines: [{ item: m.item, quantity: 1, unit_price: 10 }] }));
    await ok(act("sales_order", so, "confirm"));
    expect(code(await convert("sales_order", so, "production_order", { recipe: "x", planned_quantity: 1 }, sales))).toBe("forbidden");
  });

  it("only lets the owner role's people decide owner stages and change settings", () => {
    expect(compiled.can("manager", "extensions", "manage")).toBe(false);
    expect(compiled.can("owner", "extensions", "manage")).toBe(true);
  });

  it("keeps records a role may only see when they're its own (row scope)", async () => {
    const resource = await ok(create("resource", { code: "IMM-01", name: "Moulder 1", type: "machine" }));
    const mine = await ok(create("ent_maint", { title: "Hopper jam", resource, kind: "breakdown", technician: "u_supervisor" } as never, supervisor));
    const other = await ok(create("ent_maint", { title: "Mould polish", resource, kind: "planned", technician: "u_other" } as never, owner));
    expect(code(await run({ type: "record.update", target: "ent_maint", recordId: mine, patch: { notes: "fixed" } }, supervisor))).toBe("ok");
    expect(code(await run({ type: "record.update", target: "ent_maint", recordId: other, patch: { notes: "not mine" } }, supervisor))).toBe("forbidden");
  });
});
