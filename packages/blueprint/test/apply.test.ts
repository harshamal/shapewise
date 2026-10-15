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
