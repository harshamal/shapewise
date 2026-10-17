import { describe, expect, it } from "vitest";
import { Blueprint, applyOps } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import { actionsFor, addRoleOp, grantedOn, levelOf, levelOps, permissionModel } from "./permissions";
import { approvalStep } from "./blueprint-summary";

const bp = Blueprint.parse(plasticsFactory);

describe("permission levels", () => {
  it("maps levels onto the actions a screen has", () => {
    expect(actionsFor("edit", ["view", "create", "edit", "post", "void"])).toEqual(["view", "create", "edit"]);
    expect(actionsFor("approve", ["view", "create", "edit", "post", "void"])).toEqual(["view", "create", "edit", "post"]);
    expect(levelOf(new Set(["view", "create", "edit", "post"]), ["view", "create", "edit", "post", "void"])).toBe("approve");
    expect(levelOf(new Set(["view", "create", "edit", "post", "void"]), ["view", "create", "edit", "post", "void"])).toBe("full");
    expect(levelOf(new Set(), ["view"])).toBe("none");
  });

  it("sets a role's level on a module and the blueprint accepts it", () => {
    const model = permissionModel(bp);
    const sales = model.roles.find((r) => r.label === "Sales")!;
    const purchases = model.modules.find((m) => m.key === "purchases")!;
    const r = applyOps(bp, levelOps(model, sales.id, purchases.screens.map((s) => s.target), "view"));
    expect(r.ok, r.ok ? "" : r.issues[0]?.message).toBe(true);
    if (!r.ok) return;
    const after = permissionModel(r.blueprint).roles.find((x) => x.id === sales.id)!;
    for (const s of purchases.screens) expect(levelOf(grantedOn(after, s.target), s.actions)).toBe("view");
  });

  it("spells out an 'everything' grant before lowering one screen", () => {
    const withStar = applyOps(bp, [addRoleOp("Auditor")]);
    if (!withStar.ok) throw new Error("setup");
    const auditor = withStar.blueprint.roles.find((r) => r.label === "Auditor")!;
    const star = applyOps(withStar.blueprint, [{ op: "set_grant", role: auditor.id, target: "*", actions: ["view"] }]);
    if (!star.ok) throw new Error(star.issues[0]?.message);
    const model = permissionModel(star.blueprint);
    const r = applyOps(star.blueprint, levelOps(model, auditor.id, ["invoices"], "none"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = permissionModel(r.blueprint).roles.find((x) => x.id === auditor.id)!;
    expect(levelOf(grantedOn(after, "invoices"), ["view"])).toBe("none");
    expect(levelOf(grantedOn(after, "quotes"), ["view"])).toBe("view");
  });
});

describe("approval switch", () => {
  it("finds the step a document waits at, never a void", () => {
    expect(approvalStep(bp, "purchase_order")?.action).toBe("issue");
    expect(approvalStep(bp, "customer")).toBeUndefined();
  });
});
