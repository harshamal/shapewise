import { describe, expect, it } from "vitest";
import { navigation, validateBlueprint } from "@shapewise/blueprint";
import { BlueprintPlan, assemble, salvage } from "../src";

/** A plan like the model should write for a bakery with a delivery van. */
export const bakeryPlan: BlueprintPlan = BlueprintPlan.parse({
  businessName: "Sunrise Bakery",
  industryDescription: "Bakery selling bread and cakes at a counter and to cafés",
  preset: "food",
  modules: ["sales", "pos", "purchases", "inventory", "production", "banking", "tax", "reports"],
  hideSubmodules: ["quotes", "delivery_notes"],
  extensions: ["lots", "pack_units", "ncr"],
  settings: { sales: { defaultPaymentTermsDays: 14 }, production: { useOperations: true } },
  customFields: [
    { record: "item", part: "header", key: "allergens", label: "Allergens", type: "multiselect", required: false, options: [{ value: "gluten", label: "Gluten" }, { value: "egg", label: "Egg" }], showOnDocuments: true, showInProduction: false },
    { record: "batch", part: "header", key: "oven_temp", label: "Oven temperature", type: "quantity", unit: "°C", required: false, showOnDocuments: false, showInProduction: false },
  ],
  recordTypes: [
    {
      key: "delivery_run",
      label: "Delivery run",
      labelPlural: "Delivery runs",
      module: "sales",
      titleField: "route",
      numberingPrefix: "RUN",
      why: "The van delivers to cafés each morning on fixed routes.",
      fields: [
        { key: "route", label: "Route", type: "text", required: true },
        { key: "driver", label: "Driver", type: "user", required: false },
        { key: "customer", label: "First stop", type: "ref", refTo: "customer", required: false },
        { key: "run_date", label: "Date", type: "date", required: true },
        { key: "crates", label: "Crates", type: "integer", required: false },
      ],
      workflow: {
        initial: "planned",
        states: [
          { key: "planned", label: "Planned", tone: "neutral" },
          { key: "out", label: "Out for delivery", tone: "info" },
          { key: "done", label: "Delivered", tone: "success", terminal: true },
        ],
        transitions: [
          { key: "leave", label: "Leave bakery", from: ["planned"], to: "out", permission: "edit" },
          { key: "finish", label: "Finish run", from: ["out"], to: "done", permission: "edit", requiredFields: ["crates"] },
        ],
      },
    },
  ],
  roles: [{ key: "driver", label: "Driver", description: "Delivers orders to cafés.", grants: [{ area: "delivery_run", actions: ["view", "edit"] }, { area: "customers", actions: ["view"] }] }],
  approvals: [{ label: "Big purchase orders", record: "purchase_order", action: "issue", stages: [{ name: "Owner", minAmount: 100000, roles: ["owner"], requireAll: false }] }],
  rules: [
    { label: "No zero-crate runs", record: "delivery_run", on: ["finish"], when: "crates = 0", effect: "reject", message: "A run must carry at least one crate." },
    { label: "Tell the owner about big orders", record: "sales_order", on: ["confirm"], when: "total > 50000", effect: "notify", message: "A big order was confirmed", roles: ["owner"] },
  ],
  views: [{ record: "delivery_run", label: "Today's runs", type: "kanban", groupBy: "status" }],
  seed: { resources: [{ code: "OVEN-1", name: "Deck oven", type: "machine" }] },
  assumptions: ["Cafés pay within 14 days."],
});

describe("assemble", () => {
  it("turns a sound plan into a valid blueprint with resolved references", () => {
    const a = assemble(bakeryPlan);
    expect(a.issues).toEqual([]);
    const bp = a.blueprint!;
    expect(validateBlueprint(bp).ok).toBe(true);
    const run = bp.entities.find((e) => e.key === "delivery_run")!;
    expect(run.workflow!.transitions.find((t) => t.key === "finish")!.requires).toEqual([run.fields.find((f) => f.key === "crates")!.id]);
    expect(bp.rules.find((r) => r.label === "No zero-crate runs")!.target).toBe(run.id);
    expect(bp.roles.find((r) => r.key === "driver")!.grants[0]!.target).toBe(run.id);
    expect(bp.approvals.find((a2) => a2.target === "purchase_order" && a2.action === "issue")!.stages).toHaveLength(1); // replaced the preset's
    expect(bp.extensions).toEqual(expect.arrayContaining(["lots", "custom_fields"]));
    const sales = navigation(bp).flatMap((s) => s.modules).find((m) => m.key === "sales")!.submodules.map((s) => s.key);
    expect(sales).toContain("delivery_run");
    expect(sales).not.toContain("quotes");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(assemble(bakeryPlan).blueprint)).toBe(JSON.stringify(assemble(bakeryPlan).blueprint));
  });

  it("drops extensions whose module is off, as a note", () => {
    const a = assemble({ ...bakeryPlan, modules: bakeryPlan.modules.filter((m) => m !== "production"), customFields: bakeryPlan.customFields.filter((c) => c.record !== "batch"), extensions: ["ncr", "lots"] });
    expect(a.issues).toEqual([]);
    expect(a.blueprint!.extensions).not.toContain("ncr");
    expect(a.notes[0]).toMatch(/Non-conformance reports.*Production/);
  });

  it("points problems at the plan element that caused them", () => {
    const broken: BlueprintPlan = structuredClone(bakeryPlan);
    broken.rules[0]!.when = "crate_count = 0"; // no such field
    broken.recordTypes[0]!.workflow!.transitions[1]!.to = "delivered"; // no such state
    broken.approvals[0]!.stages[0]!.roles = ["boss"]; // no such role
    broken.views.push({ record: "spaceship", label: "Ships", type: "table" });
    const a = assemble(broken);
    const at = (path: string) => a.issues.find((i) => i.planPath.join(".") === path)?.message;
    expect(at("rules.0")).toMatch(/Unknown field "crate_count"/);
    expect(at("recordTypes.0.workflow.transitions.1.to")).toMatch(/"delivered" isn't one of Delivery run's states/);
    expect(at("approvals.0.stages.0.roles.0")).toMatch(/"boss" isn't a role/);
    expect(at("views.1.record")).toMatch(/"spaceship" isn't a record type/);
    expect(a.blueprint).toBeUndefined();
  });
});

describe("minimal plans", () => {
  const minimal = (preset: BlueprintPlan["preset"], modules: BlueprintPlan["modules"]): BlueprintPlan => ({
    ...bakeryPlan,
    preset,
    modules,
    customFields: [],
    recordTypes: [],
    roles: [],
    approvals: [],
    rules: [],
    views: [],
    hideSubmodules: [],
    extensions: [],
    settings: {},
    seed: {},
  });
  const ALL = ["sales", "pos", "purchases", "inventory", "production", "banking", "tax", "reports"] as BlueprintPlan["modules"];
  for (const preset of ["general", "plastics", "food", "chemicals", "pharma", "garments", "printing", "distribution"] as const) {
    it(`${preset} assembles with every module and with none`, () => {
      for (const modules of [ALL, [] as BlueprintPlan["modules"]]) {
        const a = assemble(minimal(preset, modules));
        expect(a.issues, `${preset} ${modules.length}`).toEqual([]);
      }
    });
  }
});

describe("salvage", () => {
  it("removes only what fails and keeps the rest", () => {
    const broken: BlueprintPlan = structuredClone(bakeryPlan);
    broken.rules[0]!.when = "crate_count = 0";
    broken.recordTypes[0]!.fields.push({ key: "stop", label: "Stop", type: "ref", refTo: "planet", required: false });
    const s = salvage(broken);
    expect(validateBlueprint(s.blueprint).ok).toBe(true);
    expect(s.removed).toEqual(expect.arrayContaining([`The rule "No zero-crate runs"`, `Delivery run: the "Stop" field`]));
    expect(s.blueprint.entities[0]!.fields.map((f) => f.key)).toContain("crates");
    expect(s.blueprint.rules.map((r) => r.label)).toContain("Tell the owner about big orders");
  });

  it("returns a sound plan untouched", () => {
    const s = salvage(bakeryPlan);
    expect(s.removed).toEqual([]);
  });

  it("cleans up values it can fix instead of failing", () => {
    const s = salvage({ ...bakeryPlan, businessName: `  ${"x".repeat(130)}  ` });
    expect(validateBlueprint(s.blueprint).ok).toBe(true);
    expect(s.blueprint.business.name).toHaveLength(120);
    expect(s.notes[0]).toMatch(/Shortened the business name/);
    expect(s.removed).toEqual([]);
  });

  it("falls back to the starting setup when the plan can't be made consistent", () => {
    // Every rule points at a field that doesn't exist, round after round: salvage drops them all.
    const broken: BlueprintPlan = structuredClone(bakeryPlan);
    broken.rules = broken.rules.map((r) => ({ ...r, when: "nonexistent > 1" }));
    const s = salvage(broken, 1);
    expect(validateBlueprint(s.blueprint).ok).toBe(true);
    expect(s.removed.at(-1)).toMatch(/Everything beyond the starting setup/);
    expect(s.blueprint.rules).toEqual([]);
  });
});
