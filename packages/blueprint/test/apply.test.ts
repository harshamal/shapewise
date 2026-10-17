import { describe, expect, it } from "vitest";
import { Blueprint, applyOps, navigation } from "../src";
import { bakery, plasticsFactory } from "../src/fixtures";

const plastics = Blueprint.parse(plasticsFactory);

describe("applyOps", () => {
  it("switches an extension on with its requirements and bumps the version", () => {
    const bp = Blueprint.parse(bakery);
    expect(bp.extensions).not.toContain("bins");
    const r = applyOps(bp, [{ op: "set_extension", key: "bins", enabled: true }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blueprint.extensions).toContain("bins");
    expect(r.blueprint.version).toBe(bp.version + 1);
    expect(bp.extensions).not.toContain("bins"); // the original is untouched
  });

  it("switching off cascades to extensions that need it", () => {
    const r = applyOps(plastics, [{ op: "set_extension", key: "lots", enabled: false }]);
    expect(r.ok && r.blueprint.extensions).not.toContain("bins");
    expect(r.ok && r.summary[0]).toMatch(/Lot tracking.*Bin locations|Bin locations.*Lot tracking/);
  });

  it("won't switch off a module that holds the business's own record types", () => {
    const r = applyOps(plastics, [{ op: "set_module", key: "production", enabled: false }]);
    expect(r.ok === false && r.issues[0]).toMatchObject({ path: ["entities", 0, "module"], message: "The Production module is switched off." });
  });

  it("refuses an extension whose module is off", () => {
    const off = applyOps(Blueprint.parse(bakery), [{ op: "set_module", key: "production", enabled: false }]);
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.blueprint.extensions).not.toContain("ncr");
    const r = applyOps(off.blueprint, [{ op: "set_extension", key: "ncr", enabled: true }]);
    expect(r.ok === false && r.issues[0]?.message).toMatch(/needs the Production module/);
  });

  it("changes settings and validates them", () => {
    const ok = applyOps(plastics, [{ op: "set_setting", path: "sales.moqMode", value: "warn" }]);
    expect(ok.ok && ok.blueprint.settings.sales.moqMode).toBe("warn");
    const bad = applyOps(plastics, [{ op: "set_setting", path: "sales.moqMode", value: "maybe" }]);
    expect(bad.ok).toBe(false);
  });

  it("refuses switching off a core module or core submodule", () => {
    expect(applyOps(plastics, [{ op: "set_module", key: "accounting", enabled: false }]).ok).toBe(false);
    expect(applyOps(plastics, [{ op: "set_submodule", key: "invoices", enabled: false }]).ok).toBe(false);
  });

  it("hides a submodule from navigation", () => {
    const r = applyOps(plastics, [{ op: "set_submodule", key: "quotes", enabled: false }]);
    const sales = r.ok ? navigation(r.blueprint).flatMap((s) => s.modules).find((m) => m.key === "sales") : undefined;
    expect(sales?.submodules.map((s) => s.key)).not.toContain("quotes");
  });

  it("replaces a role's grant", () => {
    const r = applyOps(plastics, [{ op: "set_grant", role: "rol_sales", target: "quotes", actions: ["view"] }]);
    expect(r.ok && r.blueprint.roles.find((x) => x.id === "rol_sales")!.grants.find((g) => g.target === "quotes")?.actions).toEqual(["view"]);
  });
});

describe("approval rules as element ops", () => {
  const bp = Blueprint.parse(plasticsFactory);
  const owner = bp.roles.find((r) => r.owner)!.id;
  const rule = { id: "apr_bigbills", label: "Big bills", target: "bill", action: "post", enabled: true, stages: [{ id: "aps_bb1", name: "Owner", minAmount: 2_000_000, roles: [owner], requireAll: false }] };

  it("adds, switches off and removes a rule, validating each time", () => {
    const added = applyOps(bp, [{ op: "add", collection: "approvals", value: rule }]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.blueprint.approvals.find((a) => a.id === "apr_bigbills")?.stages[0]?.minAmount).toBe(2_000_000);
    const off = applyOps(added.blueprint, [{ op: "update", id: "apr_bigbills", patch: { enabled: false } }]);
    expect(off.ok && off.blueprint.approvals.find((a) => a.id === "apr_bigbills")?.enabled).toBe(false);
    const gone = applyOps(added.blueprint, [{ op: "remove", id: "apr_bigbills" }]);
    expect(gone.ok && gone.blueprint.approvals.some((a) => a.id === "apr_bigbills")).toBe(false);
  });

  it("refuses a rule the validator wouldn't accept, and duplicate ids", () => {
    const bad = applyOps(bp, [{ op: "add", collection: "approvals", value: { ...rule, action: "fly" } }]);
    expect(bad.ok).toBe(false);
    const added = applyOps(bp, [{ op: "add", collection: "approvals", value: rule }]);
    if (!added.ok) throw new Error("setup");
    expect(applyOps(added.blueprint, [{ op: "add", collection: "approvals", value: rule }]).ok).toBe(false);
    expect(applyOps(bp, [{ op: "add", collection: "fields", parent: "ent_x1", value: { id: "fld_x1" } }]).ok).toBe(false);
  });
});

describe("reports, roles and the catalogue", () => {
  const bp = Blueprint.parse(plasticsFactory);

  it("describes every report against real modules, features and dashboard metrics", async () => {
    const { REPORTS, MODULE_BY_KEY, EXTENSION_BY_KEY, BUILTIN_METRICS } = await import("../src");
    for (const r of REPORTS) {
      expect(MODULE_BY_KEY.has(r.module), r.key).toBe(true);
      for (const m of ("needs" in r ? (r.needs as { modules?: string[] }).modules : undefined) ?? []) expect(MODULE_BY_KEY.has(m), `${r.key} needs ${m}`).toBe(true);
      for (const e of ("needs" in r ? (r.needs as { extensions?: string[] }).extensions : undefined) ?? []) expect(e in EXTENSION_BY_KEY, `${r.key} needs ${e}`).toBe(true);
      if ("metric" in r && r.metric) expect(BUILTIN_METRICS as readonly string[], r.key).toContain(r.metric);
    }
  });

  it("places a report and unpins it again", () => {
    const placed = applyOps(bp, [{ op: "set_report", key: "aged_receivables", places: ["dashboard", "module"] }]);
    expect(placed.ok && placed.blueprint.reports.find((r) => r.key === "aged_receivables")).toEqual({ key: "aged_receivables", places: ["dashboard", "module"] });
    if (!placed.ok) return;
    const gone = applyOps(placed.blueprint, [{ op: "set_report", key: "aged_receivables", places: [] }]);
    expect(gone.ok && gone.blueprint.reports.map((r) => r.key)).not.toContain("aged_receivables");
    expect(gone.ok && gone.blueprint.reports.length).toBe(placed.blueprint.reports.length - 1);
    expect(applyOps(bp, [{ op: "set_report", key: "nonsense", places: ["dashboard"] }]).ok).toBe(false);
  });

  it("adds and removes roles, and never edits the owner's access", () => {
    const added = applyOps(bp, [{ op: "add", collection: "roles", value: { id: "rol_driver", key: "driver", label: "Driver", grants: [{ target: "delivery_notes", actions: ["view"] }] } }]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(applyOps(added.blueprint, [{ op: "remove", id: "rol_driver" }]).ok).toBe(true);
    const owner = bp.roles.find((r) => r.owner)!;
    expect(applyOps(bp, [{ op: "set_grant", role: owner.id, target: "invoices", actions: ["view"] }]).ok).toBe(false);
    expect(applyOps(bp, [{ op: "remove", id: owner.id }]).ok).toBe(false);
  });
});
