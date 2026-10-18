import { describe, expect, it } from "vitest";
import { CHART_TEMPLATES, COUNTRIES, accountForRole, chartAccounts, requiredRoles, taxRoles, validateBlueprint } from "../src";
import { plasticsFactory } from "../src/fixtures";

describe("chart of accounts templates", () => {
  const charts = [
    ...Object.entries(CHART_TEMPLATES).map(([key, c]) => [key, c.accounts] as const),
    ...COUNTRIES.flatMap((c) => Object.keys(CHART_TEMPLATES).map((k) => [`${k} in ${c.code}`, chartAccounts(k, c.code)] as const)),
    ["trading in Kenya", chartAccounts("trading", "KE")] as const,
  ];
  for (const [key, accounts] of charts) {
    const chart = { accounts };
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
    const roles = requiredRoles({ inventory: true, production: true, taxRoles: taxRoles(COUNTRIES[0]!.taxes) });
    for (const role of roles) expect(accountForRole("manufacturing", role), role).toBeDefined();
    expect(accountForRole("lk_manufacturing", "scrap")?.code).toBe("5300");
  });

  it("the validator refuses a chart that can't carry the business's postings", () => {
    const bp = structuredClone(plasticsFactory);
    bp.settings = { ...bp.settings, accounting: { chartTemplate: "lk_trading" } };
    const r = validateBlueprint(bp);
    const issue = r.issues.find((i) => i.path.join(".") === "settings.accounting.chartTemplate");
    expect(issue?.message).toMatch(/inventory_wip.*Use "manufacturing"/);
  });
});

describe("country tax accounts", () => {
  const names = (country: string) => new Map(chartAccounts("trading", country).flatMap((a) => (a.role ? [[a.role, a.name] as const] : [])));

  it("keeps Sri Lanka's chart exactly the base template", () => {
    expect(chartAccounts("lk_trading", "LK")).toBe(CHART_TEMPLATES.trading.accounts);
    const lk = names("LK");
    expect([lk.get("vat_output"), lk.get("vat_input"), lk.get("sscl_payable"), lk.get("wht_payable")]).toEqual(["VAT output", "VAT input", "SSCL payable", "WHT payable"]);
  });

  it("names tax accounts after the country's taxes", () => {
    expect(names("SG").get("vat_output")).toBe("GST output");
    expect(names("GB").get("vat_input")).toBe("VAT input");
    expect(names("GB").get("wht_payable")).toBe("CIS payable");
    expect(names("US").get("vat_output")).toBe("Sales tax payable");
    expect(names("KE").get("vat_output")).toBe("Output tax");
  });

  it("gives India an account for each part of GST", () => {
    const inn = names("IN");
    expect([inn.get("cgst_output"), inn.get("sgst_output"), inn.get("vat_output"), inn.get("cgst_input"), inn.get("sgst_input"), inn.get("vat_input")]).toEqual(["CGST output", "SGST output", "IGST output", "CGST input", "SGST input", "IGST input"]);
    expect(names("LK").has("cgst_output")).toBe(false);
  });
});

describe("postings", () => {
  it("only describe real actions that move stock or money, with both sides of every entry", async () => {
    const { POSTINGS, CORE_RECORDS } = await import("../src");
    for (const p of POSTINGS) {
      const a = CORE_RECORDS[p.record].lifecycle?.actions.find((x) => x.key === p.action);
      expect(a, `${p.record}.${p.action}`).toBeDefined();
      if (p.ledger) expect(a!.effects, `${p.record}.${p.action} ledger`).toContain("ledger");
      if (p.stock) expect(a!.effects, `${p.record}.${p.action} stock`).toContain("stock");
      const lines = (p.ledger ?? []).filter((l) => !l.when);
      if (lines.length) expect(new Set(lines.map((l) => l.side)).size, `${p.record}.${p.action} balances`).toBe(2);
    }
  });
});
