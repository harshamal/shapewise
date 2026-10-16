/**
 * Live check of the workspace assistant on real records in memory.
 *   pnpm --filter @shapewise/ai exec tsx evals/assistant.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Blueprint } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import { MemoryStore, compile, createExecutor, type Command } from "@shapewise/runtime";
import { createLlm, runAssistant, type Message, type ToolContext } from "../src";

const envPath = fileURLToPath(new URL("../../../apps/web/.env.local", import.meta.url));
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
}

const compiled = compile(Blueprint.parse(plasticsFactory));
const store = new MemoryStore();
const exec = createExecutor({ store, blueprint: async () => compiled, now: () => new Date("2026-10-16T08:00:00Z") });
let n = 0;
const run = async (command: Command) => {
  const r = await exec({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, tenantId: "t", actor: { kind: "user", id: "u", roleKey: "owner", channel: "web" }, command, issuedAt: "2026-10-16T08:00:00Z" });
  if (r.status !== "ok") throw new Error(JSON.stringify(r));
  return r.recordId!;
};

const customers = await Promise.all(["Perera Stores", "Silva Traders", "Lanka Foods", "Kandy Mart"].map((name) => run({ type: "record.create", target: "customer", data: { name } })));
const item = await run({ type: "record.create", target: "item", data: { name: "500 ml container", type: "goods" } });
const plan: [number, string, number, boolean][] = [
  [0, "2026-08-10", 1200, true],
  [0, "2026-10-01", 300, true],
  [1, "2026-07-15", 5000, true],
  [2, "2026-10-12", 800, false],
  [3, "2026-09-20", 2500, true],
];
for (const [c, date, qty, post] of plan) {
  const inv = await run({ type: "record.create", target: "invoice", data: { customer: customers[c], date, lines: [{ item, quantity: qty, unit_price: 25 }] } });
  if (post) await run({ type: "record.action", target: "invoice", recordId: inv, action: "post" });
}

const llm = createLlm();
console.log(`provider: ${llm.provider}\n`);
const ctx: ToolContext = { compiled, store, tenant: "t", roleKey: "owner", today: "2026-10-16", now: "2026-10-16T08:00:00Z" };
let history: Message[] = [];
for (const q of ["Which posted invoices are overdue, and how much is owed in total?", "Who are my top 3 customers by invoiced amount?", "Add a new customer called Galle Bakers with 14-day payment terms."]) {
  const t0 = Date.now();
  const r = await runAssistant(llm, ctx, history, q);
  history = r.messages;
  console.log(`Q: ${q}\n   tools: ${r.toolsUsed.map((u) => `${u.name}${u.ok ? "" : "(error)"}`).join(", ") || "none"} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`A: ${r.reply.replace(/\n/g, "\n   ")}`);
  if (r.proposals.length) console.log(`   proposals: ${r.proposals.map((p) => `${p.kind} ${p.record} ${JSON.stringify(p.data)}`).join("; ")}`);
  console.log();
}
const count = (await store.read("t", (tx) => tx.list("customer"))).length;
console.log(`customers still ${count} (proposals are not written until confirmed)`);
