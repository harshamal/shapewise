import { describe, expect, it } from "vitest";
import { CHART_TEMPLATES, accountForRole, requiredRoles, validateBlueprint } from "../src";
import { plasticsFactory } from "../src/fixtures";

describe("chart of accounts templates", () => {
  for (const [key, chart] of Object.entries(CHART_TEMPLATES)) {
    it(`${key} has unique codes, real parents, one account per role and no posting to groups`, () => {
      const codes = chart.accounts.map((a) => a.code);
      expect(new Set(codes).size, "codes").toBe(codes.length);
      for (const a of chart.accounts) if (a.parent) expect(codes, `${a.code} parent`).toContain(a.parent);
      const roles = chart.accounts.flatMap((a) => (a.role ? [a.role] : []));
      expect(new Set(roles).size, "roles").toBe(roles.length);
      for (const a of chart.accounts) if (a.group) expect(a.role, `${a.code} is a group`).toBeUndefined();
    });
  }

  it("manufacturing covers everything a VAT-registered factory posts to", () => {
    const roles = requiredRoles({ inventory: true, production: true, tax: { vat: true, sscl: true, wht: true } });
    for (const role of roles) expect(accountForRole("lk_manufacturing", role), role).toBeDefined();
    expect(accountForRole("lk_manufacturing", "scrap")?.code).toBe("5300");
  });

  it("the validator refuses a chart that can't carry the business's postings", () => {
    const bp = structuredClone(plasticsFactory);
    bp.settings = { ...bp.settings, accounting: { chartTemplate: "lk_trading" } };
    const r = validateBlueprint(bp);
    const issue = r.issues.find((i) => i.path.join(".") === "settings.accounting.chartTemplate");
    expect(issue?.message).toMatch(/inventory_wip.*Use "lk_manufacturing"/);
  });
});
