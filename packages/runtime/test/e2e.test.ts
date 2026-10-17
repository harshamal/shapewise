import { beforeEach, describe, expect, it } from "vitest";
import { Blueprint, applyOps } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import { MemoryStore, compile, createExecutor, type Command, type CommandResult } from "../src";

/**
 * The whole ERP end to end through the command pipeline, as different
 * people: every module's documents from first draft to last step, approvals
 * (one and several stages, approve and reject, who may decide) and what
 * each role may and may not do.
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

beforeEach(() => {
  store = new MemoryStore();
  let i = 0;
  execute = createExecutor({ store, blueprint: async () => compiled, now: () => new Date("2026-10-16T08:00:00Z"), newId: (p) => `${p}${++i}` });
});

async function masters() {
  const customer = await ok(create("customer", { name: "Perera Stores", payment_terms_days: 30 }));
  const vendor = await ok(create("vendor", { name: "Lanka Resins" }));
  const item = await ok(create("item", { name: "500 ml container", type: "goods" }));
  const resin = await ok(create("item", { name: "PP resin", type: "goods" }));
  const wh = await ok(create("warehouse", { code: "FG", name: "Finished goods" }));
  const rm = await ok(create("warehouse", { code: "RM", name: "Raw materials" }));
  const bank = await ok(create("bank_account", { name: "BOC current", kind: "bank" }));
  return { customer, vendor, item, resin, wh, rm, bank };
}

/* ------------------------------------------------------------- flows */

describe("sales: quote to cash", () => {
  it("runs quote, order, delivery, invoice and payment, numbering each and linking them", async () => {
    const m = await masters();
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
    expect(code(await act("delivery_note", dn, "dispatch", stores))).toBe("ok");
    const inv = await ok(convert("delivery_note", dn, "invoice", undefined, sales));
    // The delivery note has no prices: the invoice takes them from the sales order behind it.
    expect(((await get("invoice", inv))?.data.lines as { unit_price: number }[])[0]!.unit_price).toBe(6000);
    expect(code(await act("invoice", inv, "post", sales))).toBe("forbidden"); // sales drafts, accounts posts
    expect(code(await act("invoice", inv, "post", accountant))).toBe("ok");
    const posted = await get("invoice", inv);
    expect(posted).toMatchObject({ status: "posted", data: { payment_status: "unpaid" } });
    expect(posted?.data.due_date).toBe("2026-11-15");

    const rc = await ok(convert("invoice", inv, "receipt", { amount: 70800, deposit_to: m.bank }, accountant));
    expect(code(await act("receipt", rc, "post", accountant))).toBe("ok");
  });

  it("raises a credit note against a posted invoice, and refuses to edit or delete posted documents", async () => {
    const m = await masters();
    const inv = await ok(create("invoice", { customer: m.customer, date: "2026-10-16", lines: [{ item: m.item, quantity: 10, unit_price: 100 }] }));
    expect(code(await convert("invoice", inv, "credit_note"))).toBe("conflict"); // draft first
    await ok(act("invoice", inv, "post"));
    const cn = await ok(convert("invoice", inv, "credit_note"));
    // The template holds every credit note for a manager or the owner.
    const held = await act("credit_note", cn, "post", accountant);
    expect(held.status).toBe("pending_approval");
    expect(await run({ type: "approval.decide", approvalId: held.status === "pending_approval" ? held.approvalId : "", decision: "approve" }, manager)).toMatchObject({ status: "ok", effects: { approval: "approved" } });
    expect(await status("credit_note", cn)).toBe("posted");
    expect(code(await run({ type: "record.update", target: "invoice", recordId: inv, patch: { notes: "x" } }))).toBe("engine_rule");
    expect(code(await run({ type: "record.delete", target: "invoice", recordId: inv }))).toBe("engine_rule");
    expect(code(await act("invoice", inv, "void"))).toBe("ok");
  });
});

describe("buying: order to payment", () => {
  it("runs purchase order, goods received, bill and payment", async () => {
    const m = await masters();
    const po = await ok(create("purchase_order", { vendor: m.vendor, date: "2026-10-16", lines: [{ item: m.resin, quantity: 100, unit_price: 500 }] }, manager));
    expect(code(await act("purchase_order", po, "issue", manager))).toBe("ok"); // 50,000: under every threshold
    const grn = await ok(convert("purchase_order", po, "goods_receipt", { warehouse: m.rm }, stores));
    expect(code(await act("goods_receipt", grn, "post", stores))).toBe("ok");
    const bill = await ok(convert("goods_receipt", grn, "bill", undefined, accountant));
    expect(((await get("bill", bill))?.data.lines as { unit_price: number }[])[0]!.unit_price).toBe(50000);
    const b = await get("bill", bill);
    expect((b?.data.lines as unknown[])?.length).toBe(1);
    expect(code(await act("bill", bill, "post", accountant))).toBe("ok");
    const pay = await ok(convert("bill", bill, "payment", { amount: 59000, paid_from: m.bank }, accountant));
    expect(code(await act("payment", pay, "post", accountant))).toBe("ok");
  });

  it("returns goods to the supplier with a vendor credit", async () => {
    const m = await masters();
    const bill = await ok(create("bill", { vendor: m.vendor, date: "2026-10-16", lines: [{ item: m.resin, quantity: 5, unit_price: 100 }] }, accountant));
    await ok(act("bill", bill, "post", accountant));
    const vc = await ok(convert("bill", bill, "vendor_credit", undefined, accountant));
    expect(code(await act("vendor_credit", vc, "post", accountant))).toBe("ok");
  });
});

describe("production: recipe to released batch", () => {
  it("activates a recipe, schedules an order, and runs a batch through quality release", async () => {
    const m = await masters();
    const recipe = await ok(create("recipe", { code: "C500", name: "500 ml container", item: m.item, output_quantity: 1000, lines: [{ item: m.resin, quantity: 20 }] }, manager));
    expect(code(await act("recipe", recipe, "activate", manager))).toBe("ok");
    const order = await ok(create("production_order", { recipe, item: m.item, planned_quantity: 5000 }, supervisor));
    expect(code(await act("production_order", order, "schedule", supervisor))).toBe("forbidden");
    expect(code(await act("production_order", order, "schedule", manager))).toBe("ok");
    expect(code(await act("production_order", order, "start", manager))).toBe("ok");
    const batch = await ok(convert("production_order", order, "batch", { planned_quantity: 5000 }, supervisor));
    for (const a of ["issue_materials", "start", "finish"]) expect(code(await act("batch", batch, a, manager)), a).toBe("ok");
    expect(code(await act("batch", batch, "release", supervisor))).toBe("forbidden"); // quality releases
    expect(code(await act("batch", batch, "release", qc))).toBe("ok");
    expect(await status("batch", batch)).toBe("released");
    expect(code(await act("production_order", order, "complete", manager))).toBe("ok");
    // Buy shortages: the recipe's materials for the planned quantity (20 per 1,000, so 100 for 5,000).
    const po = await ok(convert("production_order", order, "purchase_order", { vendor: m.vendor }, manager));
    expect((await get("purchase_order", po))?.data.lines).toEqual([expect.objectContaining({ item: m.resin, quantity: 100 })]);
  });
});

describe("stock and accounts", () => {
  it("posts a stock count and moves stock between stores", async () => {
    const m = await masters();
    const adj = await ok(create("stock_adjustment", { warehouse: m.wh, date: "2026-10-16", reason: "count", lines: [{ item: m.item, quantity_delta: -3 }] }, stores));
    expect(code(await act("stock_adjustment", adj, "post", stores))).toBe("forbidden"); // stores counts, a manager posts
    expect(code(await act("stock_adjustment", adj, "post", manager))).toBe("ok");
    const tr = await ok(create("stock_transfer", { from_warehouse: m.rm, to_warehouse: m.wh, date: "2026-10-16", lines: [{ item: m.resin, quantity: 10 }] }, stores));
    expect(code(await act("stock_transfer", tr, "send", stores))).toBe("ok");
    expect(code(await act("stock_transfer", tr, "receive", stores))).toBe("ok");
  });

  it("posts a balanced journal and refuses an unbalanced one", async () => {
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
    expect(code(await create("journal", { date: "2026-10-16", narration: "x", lines: [] }, sales))).toBe("forbidden");
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
