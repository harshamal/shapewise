/**
 * Live evaluation of blueprint design: business profiles → blueprints.
 *   pnpm --filter @shapewise/ai eval            (all cases)
 *   pnpm --filter @shapewise/ai eval bakery     (cases whose id contains "bakery")
 * Reads the Gemini key from apps/web/.env.local. Prints one line per case
 * and a summary; exits non-zero if any expectation fails.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { taxFlags, validateBlueprint, type Blueprint } from "@shapewise/blueprint";
import { createLlm, designBlueprint, type BusinessProfile } from "../src";

const envPath = fileURLToPath(new URL("../../../apps/web/.env.local", import.meta.url));
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
}

interface Case {
  id: string;
  profile: BusinessProfile;
  expect: { label: string; check: (bp: Blueprint) => boolean }[];
}

const has = (bp: Blueprint, module: string) => bp.modules.some((m) => m.key === module && m.enabled);
const ext = (bp: Blueprint, key: string) => bp.extensions.includes(key as never);
const fieldLike = (bp: Blueprint, re: RegExp) => bp.customFields.some((c) => re.test(c.field.key) || re.test(c.field.label)) || bp.entities.some((e) => e.fields.some((f) => re.test(f.key)));

const CASES: Case[] = [
  {
    id: "plastics-moulder",
    profile: {
      businessName: "Lanka Containers",
      country: "LK",
      teamSize: "11_50",
      turnover: "60_250m",
      whatTheyDo: "Injection-moulded food containers and lids, some with in-mould labels, sold to food manufacturers.",
      products: ["500 ml round container", "1 L square container", "95 mm lid"],
      customers: ["food manufacturers on 30-day credit", "orders by email"],
      makesThings: true,
      productionSteps: ["dry resin", "injection moulding", "IML labelling", "packing in cartons"],
      machines: ["three injection moulding machines", "several moulds"],
      qualityChecks: ["part weight per batch", "visual check for flash"],
      stockPractices: ["raw material and finished goods stores", "resin lots from suppliers", "cartons of 500"],
      thingsToTrack: ["colour code per order line", "label version"],
      approvals: ["owner approves purchases over Rs 500,000"],
      team: ["owner", "production supervisor", "QC officer", "storekeeper", "accountant"],
      taxRegistrations: ["vat", "sscl"],
      taxConfirmed: true,
    },
    expect: [
      { label: "production on", check: (bp) => has(bp, "production") },
      { label: "lots on", check: (bp) => ext(bp, "lots") },
      { label: "colour code tracked", check: (bp) => fieldLike(bp, /colou?r/i) },
      { label: "VAT registered", check: (bp) => taxFlags(bp).vat },
      { label: "PO approval from 500k", check: (bp) => bp.approvals.some((a) => a.target === "purchase_order" && a.stages.some((s) => s.minAmount >= 500_000)) },
    ],
  },
  {
    id: "bakery",
    profile: {
      businessName: "Sunrise Bakery",
      country: "LK",
      teamSize: "2_10",
      turnover: "15_36m",
      whatTheyDo: "Bakes bread, buns and cakes; sells at its own shop counter and delivers to cafés every morning.",
      products: ["sandwich bread", "fish buns", "butter cake"],
      customers: ["walk-in customers paying cash at the counter", "cafés on weekly credit"],
      makesThings: true,
      productionSteps: ["mixing", "proofing", "baking", "cooling", "packing"],
      machines: ["deck oven", "spiral mixer"],
      stockPractices: ["flour and sugar store", "products expire in 2-3 days"],
      thingsToTrack: ["allergens on each product", "delivery van route each morning"],
      team: ["owner", "baker", "cashier", "driver"],
    },
    expect: [
      { label: "POS on", check: (bp) => has(bp, "pos") },
      { label: "lots/expiry on", check: (bp) => ext(bp, "lots") },
      { label: "allergens tracked", check: (bp) => fieldLike(bp, /allergen/i) },
      { label: "deliveries covered", check: (bp) => bp.entities.some((e) => /deliver|route|run/i.test(e.key)) || has(bp, "sales") },
    ],
  },
  {
    id: "hardware-distributor",
    profile: {
      businessName: "Kandy Hardware Distributors",
      country: "LK",
      teamSize: "11_50",
      turnover: "250_750m",
      whatTheyDo: "Imports and distributes hardware to retail shops across the Central Province.",
      products: ["paint", "PVC pipes", "hand tools"],
      customers: ["hardware shops on 45-day credit", "sales reps take orders"],
      suppliers: ["overseas manufacturers", "local paint companies"],
      makesThings: false,
      stockPractices: ["one main warehouse with racks", "cartons and pallets"],
      documents: ["quotations", "delivery notes", "invoices"],
      team: ["owner", "sales reps", "storekeeper", "accountant"],
      approvals: ["manager approves discounts over 10%"],
    },
    expect: [
      { label: "no production", check: (bp) => !has(bp, "production") },
      { label: "pack units on", check: (bp) => ext(bp, "pack_units") },
      { label: "quotes kept", check: (bp) => !bp.modules.find((m) => m.key === "sales")?.submodules.some((s) => s.key === "quotes" && s.enabled === false) },
    ],
  },
  {
    id: "garment-factory",
    profile: {
      businessName: "Colombo Apparel",
      country: "LK",
      teamSize: "51_200",
      turnover: "250_750m",
      whatTheyDo: "Makes uniforms and t-shirts to order for schools and companies.",
      products: ["school uniforms", "branded t-shirts"],
      customers: ["schools", "companies placing bulk orders"],
      makesThings: true,
      productionSteps: ["cutting", "sewing", "printing or embroidery", "finishing", "packing"],
      machines: ["sewing lines", "embroidery machine"],
      qualityChecks: ["measurements", "stitching quality"],
      thingsToTrack: ["size breakdown per order", "school or company logo artwork"],
      team: ["owner", "line supervisors", "QC", "accountant"],
    },
    expect: [
      { label: "production on", check: (bp) => has(bp, "production") },
      { label: "sizes tracked", check: (bp) => fieldLike(bp, /size/i) },
    ],
  },
];

const filter = process.argv[2];
const llm = createLlm();
console.log(`provider: ${llm.provider}`);
let failures = 0;
const rows: string[] = [];

for (const c of CASES.filter((x) => !filter || x.id.includes(filter))) {
  const t0 = Date.now();
  try {
    const r = await designBlueprint(llm, c.profile);
    const valid = validateBlueprint(r.blueprint).ok;
    const misses = c.expect.filter((e) => !e.check(r.blueprint)).map((e) => e.label);
    if (!valid || misses.length) failures++;
    const tokens = r.usage.reduce((s, u) => s + u.input + u.output, 0);
    rows.push(
      `${c.id.padEnd(22)} valid:${valid ? "yes" : "NO "} firstPass:${r.firstPassValid ? "yes" : "no "} repairs:${r.repairRounds} removed:${r.removed.length} ` +
        `entities:${r.blueprint.entities.length} customFields:${r.blueprint.customFields.length} rules:${r.blueprint.rules.length} ` +
        `${((Date.now() - t0) / 1000).toFixed(0)}s ${tokens}tok${misses.length ? `  MISSING: ${misses.join(", ")}` : ""}`,
    );
    if (r.issuesSeen.length) rows.push(`    issues seen: ${r.issuesSeen.map((round) => round.slice(0, 4).map((i) => `${i.planPath.join(".")}: ${i.message.slice(0, 90)}`).join(" | ")).join("  //  ")}`);
    if (r.removed.length) rows.push(`    removed: ${r.removed.join("; ")}`);
    console.log(rows.at(-1 - (r.removed.length ? 1 : 0) - (r.issuesSeen.length ? 1 : 0)) ?? "");
  } catch (e) {
    failures++;
    rows.push(`${c.id.padEnd(22)} ERROR ${(e as Error).message}`);
    console.log(rows.at(-1));
  }
}
console.log("\n" + rows.join("\n"));
console.log(`\n${failures ? `${failures} case(s) failed` : "all cases passed"}`);
process.exit(failures ? 1 : 0);
