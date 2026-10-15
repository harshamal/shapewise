import { beforeEach, describe, expect, it } from "vitest";
import { Blueprint } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import { MemoryStore, compile, createExecutor, type Command, type CommandResult } from "../src";

const bp = Blueprint.parse(plasticsFactory);
const compiled = compile(bp);
let store: MemoryStore;
let execute: ReturnType<typeof createExecutor>;
let n = 0;

const owner = { kind: "user", id: "u_owner", roleKey: "owner", channel: "web", displayName: "Owner" } as const;
const sales = { kind: "user", id: "u_sales", roleKey: "sales", channel: "web", displayName: "Sam" } as const;
const agent = { kind: "agent", id: "tok_1", roleKey: "stores", channel: "mcp", clientName: "Demo agent" } as const;

function run(command: Command, actor: object = owner, extra: object = {}): Promise<CommandResult> {
  n++;
  return execute({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, tenantId: "t_test", actor, command, issuedAt: "2026-10-16T08:00:00.000Z", ...extra });
}
async function okId(p: Promise<CommandResult>): Promise<string> {
  const r = await p;
  if (r.status !== "ok") throw new Error(JSON.stringify(r));
  return r.recordId!;
}
const get = (target: string, id: string) => store.read("t_test", (tx) => tx.get(target, id));

beforeEach(() => {
  store = new MemoryStore();
  let i = 0;
  execute = createExecutor({ store, blueprint: async () => compiled, now: () => new Date("2026-10-16T08:00:00Z"), newId: (p) => `${p}${++i}` });
});

async function basics() {
  const customer = await okId(run({ type: "record.create", target: "customer", data: { name: "Perera Stores" } }));
  const item = await okId(run({ type: "record.create", target: "item", data: { name: "500 ml round container", sku: "C500", type: "goods" } }));
  const vat = await okId(run({ type: "record.create", target: "tax_code", data: { name: "VAT 18%", rate: 18, kind: "vat" } }));
  return { customer, item, vat };
}

describe("create and validate", () => {
  it("creates a record and audits it", async () => {
    const id = await okId(run({ type: "record.create", target: "customer", data: { name: "  Perera Stores ", phone: "0771234567" } }));
    const rec = await get("customer", id);
    expect(rec).toMatchObject({ status: "active", version: 1, data: { name: "Perera Stores" } });
    expect((await store.listAudit("t_test"))[0]?.summary).toBe("Created customer Perera Stores");
  });

  it("reports every problem with a path", async () => {
    const r = await run({ type: "record.create", target: "sales_order", data: { date: "16/10/2026", total: 5, lines: [{ quantity: "abc" }] } });
    expect(r.status).toBe("error");
    const issues = r.status === "error" ? r.error.issues!.map((i) => `${i.path.join(".")}: ${i.message}`) : [];
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^date: Date: expected a date/),
        expect.stringMatching(/^total: Total is set by the system/),
        expect.stringMatching(/^lines.0.quantity: Quantity: expected a number/),
        expect.stringMatching(/^customer: Customer is required/),
        expect.stringMatching(/^lines.0.item: Item is required/),
      ]),
    );
  });

  it("refuses references to records that don't exist", async () => {
    const r = await run({ type: "record.create", target: "sales_order", data: { customer: "cus_nope", date: "2026-10-16", lines: [{ item: "ite_nope", quantity: 1 }] } });
    expect(r.status === "error" && r.error.issues!.map((i) => i.path.join("."))).toEqual(["customer", "lines.0.item"]);
  });

  it("works out line amounts, tax and totals in minor units", async () => {
    const { customer, item, vat } = await basics();
    const id = await okId(run({ type: "record.create", target: "sales_order", data: { customer, date: "2026-10-16", lines: [{ item, quantity: "1,000", unit_price: "49.75", discount_pct: 10, tax_code: vat }] } }));
    const so = await get("sales_order", id);
    expect(so!.data).toMatchObject({ sub_total: 4_477_500, tax_total: 805_950, total: 5_283_450 });
  });
});

describe("lifecycle actions, numbering and approvals", () => {
  it("numbers a document when it is confirmed, gap-free per year", async () => {
    const { customer, item } = await basics();
    const mk = () => okId(run({ type: "record.create", target: "sales_order", data: { customer, date: "2026-10-16", lines: [{ item, quantity: 10, unit_price: 5 }] } }));
    const [a, b] = [await mk(), await mk()];
    expect((await get("sales_order", a))!.number).toBeUndefined();
    await run({ type: "record.action", target: "sales_order", recordId: b, action: "confirm" });
    await run({ type: "record.action", target: "sales_order", recordId: a, action: "confirm" });
    expect((await get("sales_order", b))!.number).toBe("SO-2026-00001");
    expect((await get("sales_order", a))).toMatchObject({ status: "confirmed", number: "SO-2026-00002" });
  });

  it("refuses actions from the wrong state", async () => {
    const { customer, item } = await basics();
    const id = await okId(run({ type: "record.create", target: "sales_order", data: { customer, date: "2026-10-16", lines: [{ item, quantity: 1, unit_price: 1 }] } }));
    const r = await run({ type: "record.action", target: "sales_order", recordId: id, action: "close" });
    expect(r.status === "error" && r.error.message).toBe("Can't close a draft sales order.");
  });

  it("holds large orders for the owner, then carries them out on approval", async () => {
    const { customer, item } = await basics();
    const id = await okId(run({ type: "record.create", target: "sales_order", data: { customer, date: "2026-10-16", lines: [{ item, quantity: 100_000, unit_price: 60 }] } }));
    const parked = await run({ type: "record.action", target: "sales_order", recordId: id, action: "confirm" }, sales);
    // Sales can't confirm at all: confirm needs the approve right.
    expect(parked.status === "error" && parked.error.code).toBe("forbidden");

    const held = await run({ type: "record.action", target: "sales_order", recordId: id, action: "confirm" });
    expect(held.status).toBe("pending_approval");
    expect((await get("sales_order", id))).toMatchObject({ status: "draft", pendingApproval: held.status === "pending_approval" ? held.approvalId : "" });

    const again = await run({ type: "record.action", target: "sales_order", recordId: id, action: "confirm" });
    expect(again.status === "error" && again.error.message).toMatch(/already waiting/);

    const decided = await run({ type: "approval.decide", approvalId: held.status === "pending_approval" ? held.approvalId : "", decision: "approve" });
    expect(decided).toMatchObject({ status: "ok", effects: { approval: "approved", status: "confirmed" } });
    expect((await get("sales_order", id))).toMatchObject({ status: "confirmed", number: "SO-2026-00001" });
    expect(await store.listApprovals("t_test", "approved")).toHaveLength(1);
  });

  it("holds agent goods receipts for stores or a manager", async () => {
    const vendor = await okId(run({ type: "record.create", target: "vendor", data: { name: "Lanka Resins" } }));
    const wh = await okId(run({ type: "record.create", target: "warehouse", data: { code: "RM", name: "Raw materials" } }));
    const item = await okId(run({ type: "record.create", target: "item", data: { name: "PP resin", type: "goods" } }));
    const grn = await okId(run({ type: "record.create", target: "goods_receipt", data: { vendor, warehouse: wh, date: "2026-10-16", lines: [{ item, quantity: 500 }] } }, agent));
    const r = await run({ type: "record.action", target: "goods_receipt", recordId: grn, action: "post" }, agent);
    expect(r).toMatchObject({ status: "pending_approval", policyId: "apr_agentgrn" });
  });

  it("enforces balanced journals before posting", async () => {
    const acct = await okId(run({ type: "record.create", target: "account", data: { code: "1110", name: "Cash", type: "asset" } }));
    const jv = await okId(run({ type: "record.create", target: "journal", data: { date: "2026-10-16", narration: "Test", lines: [{ account: acct, debit: 100 }, { account: acct, credit: 90 }] } }));
    const r = await run({ type: "record.action", target: "journal", recordId: jv, action: "post", }, owner, { approvalId: undefined });
    // Owner posts are held by the journal approval policy first; approve to reach the engine check.
    const decided = r.status === "pending_approval" ? await run({ type: "approval.decide", approvalId: r.approvalId, decision: "approve" }) : r;
    expect(decided.status === "error" && decided.error.message).toBe("Debits (100.00) must equal credits (90.00) across at least two lines.");
  });

  it("says plainly that postings aren't made yet", async () => {
    const { customer, item } = await basics();
    const inv = await okId(run({ type: "record.create", target: "invoice", data: { customer, date: "2026-10-16", lines: [{ item, quantity: 1, unit_price: 10 }] } }));
    const r = await run({ type: "record.action", target: "invoice", recordId: inv, action: "post" });
    expect(r.status === "ok" && r.warnings[0]?.message).toMatch(/postings arrive with/);
    expect((await get("invoice", inv))).toMatchObject({ status: "posted", number: "INV-2026-00001", data: { payment_status: "unpaid", amount_due: 1000 } });
  });
});

describe("edit, delete and convert", () => {
  it("only lets drafts change, and only unused records be deleted", async () => {
    const { customer, item } = await basics();
    const inv = await okId(run({ type: "record.create", target: "invoice", data: { customer, date: "2026-10-16", lines: [{ item, quantity: 1, unit_price: 10 }] } }));
    expect((await run({ type: "record.update", target: "invoice", recordId: inv, patch: { reference: "PO-7" } })).status).toBe("ok");
    await run({ type: "record.action", target: "invoice", recordId: inv, action: "post" });
    const edit = await run({ type: "record.update", target: "invoice", recordId: inv, patch: { reference: "x" } });
    expect(edit.status === "error" && edit.error.message).toBe("A posted invoice can't be changed. Void it and create a new one.");
    const del = await run({ type: "record.delete", target: "customer", recordId: customer });
    expect(del.status === "error" && del.error.message).toMatch(/is used on invoice INV-2026-00001.*Archive it instead/);
    const lone = await okId(run({ type: "record.create", target: "customer", data: { name: "One-off" } }));
    expect((await run({ type: "record.delete", target: "customer", recordId: lone })).status).toBe("ok");
  });

  it("rejects stale edits", async () => {
    const id = await okId(run({ type: "record.create", target: "customer", data: { name: "A" } }));
    await run({ type: "record.update", target: "customer", recordId: id, patch: { name: "B" }, expectedVersion: 1 });
    const r = await run({ type: "record.update", target: "customer", recordId: id, patch: { name: "C" }, expectedVersion: 1 });
    expect(r.status === "error" && r.error.code).toBe("conflict");
  });

  it("turns a confirmed sales order into an invoice with its lines", async () => {
    const { customer, item } = await basics();
    const so = await okId(run({ type: "record.create", target: "sales_order", data: { customer, date: "2026-10-01", lines: [{ item, quantity: 20, unit_price: 12.5 }] } }));
    await run({ type: "record.action", target: "sales_order", recordId: so, action: "confirm" });
    const inv = await okId(run({ type: "record.convert", from: "sales_order", recordId: so, to: "invoice" }));
    expect((await get("invoice", inv))!.data).toMatchObject({ customer, sales_order: so, total: 25_000, lines: [expect.objectContaining({ item, quantity: 20, unit_price: 1250 })] });
  });
});

describe("custom record types", () => {
  it("runs the maintenance workflow with its required field and notify rule", async () => {
    const res = await okId(run({ type: "record.create", target: "resource", data: { code: "IMM-01", name: "Haitian 250T", type: "machine" } }));
    const r = await run({ type: "record.create", target: "ent_maint", data: { title: "Heater band failed", resource: res, kind: "breakdown" } });
    expect(r).toMatchObject({ status: "ok", effects: { number: "MNT-0001", status: "open", notifications: [expect.objectContaining({ message: "Machine breakdown logged" })] } });
    const id = r.status === "ok" ? r.recordId! : "";
    await run({ type: "record.action", target: "ent_maint", recordId: id, action: "start" });
    const done = await run({ type: "record.action", target: "ent_maint", recordId: id, action: "complete" });
    expect(done.status === "error" && done.error.message).toBe("Fill in Downtime (min) first.");
    expect((await run({ type: "record.action", target: "ent_maint", recordId: id, action: "complete", data: { downtime_min: 45 } })).status).toBe("ok");
  });
});

describe("safety", () => {
  it("returns the first result for a repeated idempotency key without writing twice", async () => {
    const a = await run({ type: "record.create", target: "customer", data: { name: "Once" } }, owner, { idempotencyKey: "import-row-17" });
    const b = await run({ type: "record.create", target: "customer", data: { name: "Once" } }, owner, { idempotencyKey: "import-row-17" });
    expect(b).toEqual(a);
    expect(await store.read("t_test", (tx) => tx.list("customer"))).toHaveLength(1);
  });

  it("leaves nothing behind when a command fails halfway", async () => {
    const { customer, item } = await basics();
    const before = await store.read("t_test", (tx) => tx.list("sales_order"));
    await run({ type: "record.create", target: "sales_order", data: { customer, date: "2026-10-16", lines: [{ item, quantity: 1 }, { quantity: "x" }] } });
    expect(await store.read("t_test", (tx) => tx.list("sales_order"))).toEqual(before);
  });

  it("refuses record types that are switched off", async () => {
    const r = await run({ type: "record.create", target: "pos_sale", data: {} });
    expect(r.status === "error" && r.error.code).toBe("not_found");
  });
});
