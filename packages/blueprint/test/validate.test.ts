import { describe, expect, it } from "vitest";
import { INDUSTRY_PRESETS, presetBlueprint, validateBlueprint, type BlueprintInput, type Issue } from "../src";
import { bakery, plasticsFactory } from "../src/fixtures";

const business = { name: "Test Co", currency: "LKR", locale: "en-LK", timezone: "Asia/Colombo" };
const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "error");
const fmt = (issues: Issue[]) => issues.map((i) => `${i.severity} ${i.path.join(".")}: ${i.message}`).join("\n");

function expectError(bp: BlueprintInput, path: string, match: RegExp) {
  const r = validateBlueprint(bp);
  const hit = errors(r.issues).find((i) => i.path.join(".") === path && match.test(i.message));
  expect(hit, `expected error at ${path} matching ${match}\n${fmt(r.issues)}`).toBeTruthy();
}

describe("presets", () => {
  for (const preset of INDUSTRY_PRESETS) {
    it(`${preset.key} builds a blueprint with no issues`, () => {
      const r = validateBlueprint(presetBlueprint(preset.key, business));
      expect(r.issues, fmt(r.issues)).toEqual([]);
    });
  }
});

describe("fixtures", () => {
  it.each([["plastics", plasticsFactory], ["bakery", bakery]] as const)("%s validates with no issues", (_, bp) => {
    const r = validateBlueprint(bp);
    expect(r.issues, fmt(r.issues)).toEqual([]);
  });
});

describe("validator catches", () => {
  const base = () => structuredClone(plasticsFactory);

  it("switching off a core module", () => {
    const bp = base();
    bp.modules!.find((m) => m.key === "accounting")!.enabled = false;
    expectError(bp, `modules.${bp.modules!.findIndex((m) => m.key === "accounting")}.enabled`, /core module/);
  });

  it("a submodule whose extension is off", () => {
    const bp = base();
    bp.extensions = bp.extensions!.filter((e) => e !== "ncr");
    const i = bp.modules!.findIndex((m) => m.key === "production");
    bp.modules![i]!.submodules = [{ key: "ncr", enabled: true }];
    expectError(bp, `modules.${i}.submodules.0.enabled`, /Non-conformance reports/);
  });

  it("a submodule listed under the wrong module", () => {
    const bp = base();
    const i = bp.modules!.findIndex((m) => m.key === "sales");
    bp.modules![i]!.submodules = [{ key: "bills", enabled: false }];
    expectError(bp, `modules.${i}.submodules.0.key`, /belongs to the "purchases" module/);
  });

  it("an extension missing its requirement", () => {
    const bp = base();
    bp.extensions = bp.extensions!.filter((e) => e !== "lots");
    expectError(bp, `extensions.${bp.extensions.indexOf("bins")}`, /Lot tracking/);
  });

  it("custom fields that clash with built-in fields", () => {
    const bp = base();
    bp.customFields!.push({ target: "invoice", field: { id: "fld_dupe", key: "total", label: "Total", type: "money" } });
    expectError(bp, `customFields.${bp.customFields!.length - 1}.field.key`, /already a built-in field/);
  });

  it("line custom fields on a record without lines", () => {
    const bp = base();
    bp.customFields!.push({ target: "customer", part: "line", field: { id: "fld_cl", key: "cl", label: "X", type: "text" } });
    expectError(bp, `customFields.${bp.customFields!.length - 1}.part`, /take custom fields on: header/);
  });

  it("approvals on actions that can't be held", () => {
    const bp = base();
    bp.approvals!.push({ id: "apr_bad", label: "Bad", target: "batch", action: "start", stages: [{ id: "aps_bad", name: "X", roles: ["rol_owner"] }] });
    expectError(bp, `approvals.${bp.approvals!.length - 1}.action`, /can't be held for approval/);
  });

  it("approval stages that go down in amount", () => {
    const bp = base();
    const po = bp.approvals!.find((a) => a.id === "apr_po")!;
    po.stages[1]!.minAmount = 1;
    expectError(bp, `approvals.${bp.approvals!.indexOf(po)}.stages.1.minAmount`, /go up in amount/);
  });

  it("grants with actions the submodule doesn't have", () => {
    const bp = base();
    const i = bp.roles!.findIndex((r) => r.key === "sales");
    bp.roles![i]!.grants.push({ target: "statements", actions: ["post"] });
    expectError(bp, `roles.${i}.grants.${bp.roles![i]!.grants.length - 1}.actions.0`, /doesn't apply/);
  });

  it("a blueprint without an owner role", () => {
    const bp = base();
    bp.roles = bp.roles!.map((r) => ({ ...r, owner: false }));
    expectError(bp, "roles", /owner role/);
  });

  it("broken workflows on custom record types", () => {
    const bp = base();
    bp.entities![0]!.workflow!.transitions.push({ id: "tr_bad", key: "update", label: "Bad", from: ["st_nowhere"], to: "st_mdone" });
    const r = validateBlueprint(bp);
    const msgs = errors(r.issues).map((i) => i.message).join("\n");
    expect(msgs).toMatch(/reserved/);
    expect(msgs).toMatch(/Unknown state "st_nowhere"/);
  });

  it("views on unknown fields and calendars without dates", () => {
    const bp = base();
    bp.views!.push({ id: "vw_bad", target: "invoice", label: "Bad", type: "calendar", columns: ["colour"] });
    const i = bp.views!.length - 1;
    expectError(bp, `views.${i}.columns.0`, /Unknown field "colour"/);
    expectError(bp, `views.${i}.dateField`, /needs a date field/);
  });

  it("duplicate ids anywhere in the blueprint", () => {
    const bp = base();
    bp.views!.push({ id: "vw_maintboard", target: "invoice", label: "Dupe", type: "table" });
    expectError(bp, `views.${bp.views!.length - 1}.id`, /already used/);
  });

  it("rule conditions on fields that don't exist, with a suggestion", () => {
    const bp = base();
    bp.rules!.find((r) => r.id === "rul_loyal")!.when = "customer.order_cnt >= 5";
    expectError(bp, `rules.${bp.rules!.findIndex((r) => r.id === "rul_loyal")}.when`, /Did you mean "order_count"/);
  });

  it("status values that aren't in the lifecycle", () => {
    const bp = base();
    bp.views!.find((v) => v.id === "vw_batchhold")!.filter = "status = 'on_hold'";
    expectError(bp, `views.${bp.views!.findIndex((v) => v.id === "vw_batchhold")}.filter`, /isn't one of the options.*qc_hold/);
  });

  it("conditions that aren't yes/no", () => {
    const bp = base();
    bp.approvals!.find((a) => a.id === "apr_bigso")!.when = "amount + 1";
    expectError(bp, `approvals.${bp.approvals!.findIndex((a) => a.id === "apr_bigso")}.when`, /should give yes\/no/);
  });

  it("seed data pointing at unknown codes", () => {
    const bp = base();
    bp.seed!.production!.resources!.push({ code: "IMM-09", name: "Ghost", type: "machine", parent: "NOWHERE" });
    expectError(bp, `seed.production.resources.${bp.seed!.production!.resources!.length - 1}.parent`, /Unknown resource/);
  });
});

describe("navigation", () => {
  it("builds sections, modules and enabled submodules with custom record types placed in their module", async () => {
    const { navigation, Blueprint } = await import("../src");
    const nav = navigation(Blueprint.parse(plasticsFactory));
    const production = nav.flatMap((s) => s.modules).find((m) => m.key === "production")!;
    const keys = production.submodules.map((s) => s.key);
    expect(keys).toContain("ncr");
    expect(keys).toContain("maintenance");
    expect(production.submodules.find((s) => s.key === "maintenance")?.entity).toBe("ent_maint");
    expect(nav.map((s) => s.key)).toEqual(["workspace", "operations", "finance", "governance", "admin"]);
  });

  it("hides switched-off submodules", async () => {
    const { navigation, Blueprint } = await import("../src");
    const sales = navigation(Blueprint.parse(bakery)).flatMap((s) => s.modules).find((m) => m.key === "sales")!;
    expect(sales.submodules.map((s) => s.key)).not.toContain("quotes");
    expect(sales.submodules.map((s) => s.key)).toContain("invoices");
  });
});
