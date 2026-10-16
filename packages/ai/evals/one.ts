/**
 * One design case with every model call timed, for diagnosing slow runs.
 *   tsx evals/one.ts [timeoutSeconds]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AzureOpenAi, azureConfigFromEnv, designBlueprint, type Llm } from "../src";

const envPath = fileURLToPath(new URL("../../../apps/web/.env.local", import.meta.url));
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
}

const timeoutMs = Number(process.argv[2] ?? 600) * 1000;
const base = new AzureOpenAi({ ...azureConfigFromEnv()!, timeoutMs, attempts: 1 });
let call = 0;
const timed: Llm = {
  provider: base.provider,
  async json(args) {
    const n = ++call;
    const t0 = Date.now();
    process.stderr.write(`call ${n} (${args.tier}) started\n`);
    try {
      const r = await base.json(args);
      process.stderr.write(`call ${n} ok in ${((Date.now() - t0) / 1000).toFixed(1)}s, tokens in ${r.usage.input} out ${r.usage.output}\n`);
      return r;
    } catch (e) {
      process.stderr.write(`call ${n} FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${(e as Error).message}\n`);
      throw e;
    }
  },
  turn: (a) => base.turn(a),
};

const t0 = Date.now();
const r = await designBlueprint(timed, {
  businessName: "Sunrise Bakery",
  whatTheyDo: "Bakes bread, buns and cakes; sells at its own shop counter and delivers to cafés every morning.",
  products: ["sandwich bread", "fish buns", "butter cake"],
  customers: ["walk-in customers paying cash", "cafés on weekly credit"],
  makesThings: true,
  productionSteps: ["mixing", "proofing", "baking", "cooling", "packing"],
  machines: ["deck oven", "spiral mixer"],
  stockPractices: ["products expire in 2-3 days"],
  thingsToTrack: ["allergens on each product", "delivery van route each morning"],
  team: ["owner", "baker", "cashier", "driver"],
});
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s: firstPass=${r.firstPassValid} repairs=${r.repairRounds} removed=${r.removed.length}`);
console.log(`modules: ${r.blueprint.modules.filter((m) => m.enabled).map((m) => m.key).join(", ")}`);
console.log(`extensions: ${r.blueprint.extensions.join(", ")}`);
console.log(`record types: ${r.blueprint.entities.map((e) => `${e.label} (${e.fields.map((f) => f.key).join(", ")})`).join("; ")}`);
console.log(`custom fields: ${r.blueprint.customFields.map((c) => `${c.target}.${c.field.key}`).join(", ")}`);
console.log(`rules: ${r.blueprint.rules.map((x) => x.label).join("; ")}`);
console.log(`assumptions: ${r.plan.assumptions.join(" | ")}`);
if (r.issuesSeen.length) console.log(`issues seen: ${JSON.stringify(r.issuesSeen.map((round) => round.map((i) => `${i.planPath.join(".")}: ${i.message}`)))}`);
if (r.removed.length) console.log(`removed: ${r.removed.join("; ")}`);
