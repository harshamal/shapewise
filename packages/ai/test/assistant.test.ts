import { beforeAll, describe, expect, it } from "vitest";
import { Blueprint } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import { MemoryStore, compile, createExecutor, type Command } from "@shapewise/runtime";
import { runAssistant, runTool, systemPrompt, toolSpecs, type Llm, type Message, type Proposal, type ToolContext } from "../src";

const compiled = compile(Blueprint.parse(plasticsFactory));
const store = new MemoryStore();
const ctx = (roleKey = "owner"): ToolContext => ({ compiled, store, tenant: "t", roleKey, today: "2026-10-16", now: "2026-10-16T08:00:00Z" });
const ids: Record<string, string> = {};

beforeAll(async () => {
  let n = 0;
  const exec = createExecutor({ store, blueprint: async () => compiled, now: () => new Date("2026-10-16T08:00:00Z") });
  const run = async (command: Command) => {
    const r = await exec({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, tenantId: "t", actor: { kind: "user", id: "u", roleKey: "owner", channel: "web" }, command, issuedAt: "2026-10-16T08:00:00Z" });
    if (r.status !== "ok") throw new Error(JSON.stringify(r));
    return r.recordId!;
  };
  ids.perera = await run({ type: "record.create", target: "customer", data: { name: "Perera Stores" } });
  ids.silva = await run({ type: "record.create", target: "customer", data: { name: "Silva Traders" } });
  ids.item = await run({ type: "record.create", target: "item", data: { name: "500 ml container", type: "goods" } });
  for (const [c, qty, post] of [[ids.perera, 100, true], [ids.perera, 50, false], [ids.silva, 300, true]] as const) {
    const inv = await run({ type: "record.create", target: "invoice", data: { customer: c, date: "2026-09-01", lines: [{ item: ids.item, quantity: qty, unit_price: 10 }] } });
    if (post) await run({ type: "record.action", target: "invoice", recordId: inv, action: "post" });
  }
});

describe("tools", () => {
  it("only offers record types the role can see", () => {
    const sales = toolSpecs(ctx("sales"))[0]!.parameters as { properties: { record: { enum: string[] } } };
    expect(sales.properties.record.enum).toContain("invoice");
    expect(sales.properties.record.enum).not.toContain("journal");
    expect(systemPrompt(ctx("sales"))).not.toMatch(/- journal /);
  });

  it("searches with a type-checked filter and shows money in rupees with names for references", async () => {
    const r = (await runTool(ctx(), "search_records", { record: "invoice", where: "status = 'posted' and amount_due > 500" }, [])) as { matched: number; rows: Record<string, unknown>[] };
    expect(r.matched).toBe(2);
    expect(r.rows.map((x) => x.customer).sort()).toEqual(["Perera Stores", "Silva Traders"]);
    expect(r.rows.find((x) => x.customer === "Silva Traders")!.total).toBe(3000);
  });

  it("follows references in filters", async () => {
    const r = (await runTool(ctx(), "search_records", { record: "invoice", where: "customer.name = 'Perera Stores'" }, [])) as { matched: number };
    expect(r.matched).toBe(2);
  });

  it("explains bad filters instead of failing", async () => {
    const r = (await runTool(ctx(), "search_records", { record: "invoice", where: "amount_dew > 5" }, [])) as { error: string };
    expect(r.error).toMatch(/Did you mean "amount_due"/);
    const agg = (await runTool(ctx(), "search_records", { record: "invoice", where: "count(invoice) > 1" }, [])) as { error: string };
    expect(agg.error).toMatch(/summarise/);
  });

  it("summarises and groups", async () => {
    const total = (await runTool(ctx(), "summarise", { record: "invoice", measure: "sum", field: "total", where: "status = 'posted'" }, [])) as { value: number; unit: string };
    expect(total).toMatchObject({ value: 4000, unit: "Rs" });
    const by = (await runTool(ctx(), "summarise", { record: "invoice", measure: "sum", field: "total", group_by: "customer" }, [])) as { groups: { group: string; value: number }[] };
    expect(by.groups).toEqual([
      { group: "Silva Traders", value: 3000, records: 1 },
      { group: "Perera Stores", value: 1500, records: 2 },
    ]);
  });

  it("refuses record types outside the role", async () => {
    const r = (await runTool(ctx("sales"), "search_records", { record: "journal" }, [])) as { error: string };
    expect(r.error).toMatch(/isn't a record type you can see/);
  });

  it("records proposals without writing, and checks the role can do them", async () => {
    const proposals: Proposal[] = [];
    const ok = await runTool(ctx(), "propose_change", { kind: "create", record: "customer", data: { name: "New Café" }, summary: "Add New Café as a customer" }, proposals);
    expect(ok).toMatchObject({ proposed: true });
    expect(proposals).toHaveLength(1);
    expect(await store.read("t", (tx) => tx.list("customer"))).toHaveLength(2); // nothing written
    const denied = (await runTool(ctx("sales"), "propose_change", { kind: "action", record: "invoice", id: "x", action: "post", summary: "Post it" }, [])) as { error: string };
    expect(denied.error).toMatch(/can't do that/);
  });
});

describe("runAssistant", () => {
  it("loops through tool calls and returns the final answer with what it used", async () => {
    const script: Message[] = [
      { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "summarise", args: { record: "invoice", measure: "sum", field: "amount_due", where: "status = 'posted'" } }] },
      { role: "assistant", text: "Customers owe Rs 4,000.00 on posted invoices." },
    ];
    const seen: Message[][] = [];
    const llm: Llm = {
      provider: "gemini",
      json: async () => {
        throw new Error("unused");
      },
      turn: async ({ messages }) => {
        seen.push(structuredClone(messages));
        return { message: script.shift() as Extract<Message, { role: "assistant" }>, usage: { input: 1, output: 1, model: "fake" } };
      },
    };
    const r = await runAssistant(llm, ctx(), [], "How much do customers owe?");
    expect(r.reply).toBe("Customers owe Rs 4,000.00 on posted invoices.");
    expect(r.toolsUsed).toEqual([{ name: "summarise", args: expect.any(Object), ok: true }]);
    const toolResult = seen[1]!.at(-1) as Extract<Message, { role: "tool" }>;
    expect(toolResult).toMatchObject({ role: "tool", callId: "c1", result: { value: 4000 } });
  });
});
