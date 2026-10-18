import { describe, expect, it } from "vitest";
import { Blueprint } from "@shapewise/blueprint";
import { bakery } from "@shapewise/blueprint/fixtures";
import { JOURNAL, MemoryStore, compile, createExecutor, type Command, type CommandResult, type StoredLine } from "../src";

// The till: a role that may only use the terminal can sell, and closing a
// shift books cash and card takings to the right places and works out the
// cash over or short.

const base = Blueprint.parse(bakery);
const bp = Blueprint.parse({ ...base, roles: [...base.roles, { id: "rol_till", key: "till", label: "Till", grants: [{ target: "pos_terminal", actions: ["view", "create"] }] }] });
const compiled = compile(bp);
const store = new MemoryStore();
const execute = createExecutor({ store, blueprint: async () => compiled });
const owner = { kind: "user", id: "u_owner", roleKey: "owner", channel: "web", displayName: "Owner" } as const;
const till = { kind: "user", id: "u_till", roleKey: "till", channel: "web", displayName: "Tina" } as const;
const run = (command: Command, actor: object = owner): Promise<CommandResult> => execute({ id: crypto.randomUUID(), tenantId: "t_pos", actor: actor as never, command, issuedAt: new Date().toISOString() });
const okId = async (p: Promise<CommandResult>) => {
  const r = await p;
  if (r.status !== "ok") throw new Error(JSON.stringify(r));
  return r.recordId!;
};

describe("the till", () => {
  it("sells as a terminal-only role and books the shift by tender", async () => {
    await okId(run({ type: "record.create", target: "bank_account", data: { name: "Cash drawer", kind: "cash" } }));
    const bank = await okId(run({ type: "record.create", target: "bank_account", data: { name: "Current account", kind: "bank" } }));
    const item = await okId(run({ type: "record.create", target: "item", data: { name: "Sandwich bread", type: "service", sales_price: 250 } }));

    const shift = await okId(run({ type: "record.create", target: "pos_shift", data: { terminal: "Counter", cashier: "u_till", opened_at: new Date().toISOString(), opening_float: 5000 } }, till));
    await okId(run({ type: "record.create", target: "pos_sale", data: { at: new Date().toISOString(), shift, tender: "cash", lines: [{ item, quantity: 4, unit_price: 250 }] } }, till));
    await okId(run({ type: "record.create", target: "pos_sale", data: { at: new Date().toISOString(), shift, tender: "card", lines: [{ item, quantity: 2, unit_price: 250 }] } }, till));

    const s1 = await store.read("t_pos", (tx) => tx.get("pos_shift", shift));
    await okId(run({ type: "record.update", target: "pos_shift", recordId: shift, patch: { counted_cash: 5900 }, expectedVersion: s1!.version }, till));
    const s2 = await store.read("t_pos", (tx) => tx.get("pos_shift", shift));
    await okId(run({ type: "record.action", target: "pos_shift", recordId: shift, action: "close", expectedVersion: s2!.version }, till));

    const closed = await store.read("t_pos", (tx) => tx.get("pos_shift", shift));
    expect(closed!.status).toBe("closed");
    // Float 5,000 plus cash sales 1,000, counted 5,900: 100 short.
    expect(closed!.data.variance).toBe(-10_000);

    const entry = (await store.read("t_pos", (tx) => tx.list(JOURNAL))).find((e) => e.data.source_id === shift)!;
    const lines = entry.data.lines as StoredLine[];
    const accounts = await store.read("t_pos", (tx) => tx.list("account"));
    const role = (r: string) => lines.filter((l) => l.role === r).reduce((t, l) => t + l.debit - l.credit, 0);
    expect(role("cash")).toBe(100_000);
    expect(role("bank")).toBe(50_000);
    expect(lines.find((l) => l.role === "bank")?.bank_account).toBe(bank);
    expect(lines.reduce((t, l) => t + l.debit - l.credit, 0)).toBe(0);
    expect(accounts.length).toBeGreaterThan(0);
  });

  it("still keeps a terminal-only role away from other records", async () => {
    const r = await run({ type: "record.create", target: "customer", data: { name: "Someone" } }, till);
    expect(r.status === "error" && r.error.code).toBe("forbidden");
  });
});

describe("closed books", () => {
  it("refuses anything dated on or before the lock date, and allows later dates", async () => {
    const locked = compile(Blueprint.parse({ ...bp, settings: { ...bp.settings, general: { ...bp.settings.general, lockDate: "2026-09-30" } } }));
    const exec = createExecutor({ store: new MemoryStore(), blueprint: async () => locked });
    const go = (command: Command) => exec({ id: crypto.randomUUID(), tenantId: "t_lock", actor: owner, command, issuedAt: new Date().toISOString() });
    const vendor = await go({ type: "record.create", target: "vendor", data: { name: "CEB" } });
    if (vendor.status !== "ok") throw new Error("vendor");
    const bank = await go({ type: "record.create", target: "bank_account", data: { name: "Current account", kind: "bank" } });
    const account = await go({ type: "record.create", target: "account", data: { code: "6100", name: "Electricity", type: "expense" } });
    if (bank.status !== "ok" || account.status !== "ok") throw new Error("setup");
    const paid = { vendor: vendor.recordId, account: account.recordId, paid_from: bank.recordId, amount: 1200 };
    const early = await go({ type: "record.create", target: "expense", data: { date: "2026-09-15", ...paid } });
    expect(early.status === "error" && early.error.message).toMatch(/closed up to 2026-09-30/);
    const later = await go({ type: "record.create", target: "expense", data: { date: "2026-10-02", ...paid } });
    expect(later.status === "error" ? later.error.message : "ok").toBe("ok");
    const backdate = await go({ type: "record.update", target: "expense", recordId: (later as { recordId: string }).recordId, patch: { date: "2026-09-29" } });
    expect(backdate.status === "error" && backdate.error.code).toBe("engine_rule");
  });
});
