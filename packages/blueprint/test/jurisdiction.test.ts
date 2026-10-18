import { describe, expect, it } from "vitest";
import { Blueprint, COUNTRIES, Settings, allCountries, businessTaxes, countryFor, currencyDecimals, decideTax, findCountry, parseOwnRates, sizeClass, taxFlags, validateBlueprint } from "../src";
import { plasticsFactory } from "../src/fixtures";

describe("countries", () => {
  it("each built in country has bands in its own currency, size limits and dated, sourced taxes", () => {
    for (const c of COUNTRIES) {
      expect(c.turnoverBands.length, c.code).toBeGreaterThan(2);
      expect(c.turnoverBands[0]!.min, c.code).toBe(0);
      expect(c.turnoverBands.at(-1)!.max, c.code).toBe(Infinity);
      c.turnoverBands.slice(1).forEach((b, i) => expect(b.min, `${c.code} ${b.key}`).toBe(c.turnoverBands[i]!.max));
      expect(c.sizeLimits, c.code).toBeDefined();
      expect(c.taxes.length, c.code).toBeGreaterThan(0);
      for (const t of c.taxes) {
        expect(t.effectiveFrom, `${c.code} ${t.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(t.source.length, `${c.code} ${t.id}`).toBeGreaterThan(10);
        if (t.parts) expect(t.parts.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1);
      }
    }
    const keys = COUNTRIES.flatMap((c) => c.turnoverBands.map((b) => b.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("knows any ISO country from Intl and the currency table", () => {
    const ke = countryFor("KE")!;
    expect(ke).toMatchObject({ name: "Kenya", currency: "KES", locale: "en-KE", taxRules: false, taxes: [] });
    expect(ke.timezone).toMatch(/Nairobi|UTC/);
    expect(countryFor("JP")!.currency).toBe("JPY");
    expect(countryFor("ZZ")).toBeUndefined();
    expect(allCountries().length).toBeGreaterThan(240);
    expect(findCountry("kenya")?.code).toBe("KE");
    expect(findCountry("UAE")?.code).toBe("AE");
    expect(findCountry("sri lanka")?.code).toBe("LK");
    expect(findCountry("UK")?.code).toBe("GB");
  });

  it("knows a currency's decimal places", () => {
    expect([currencyDecimals("LKR"), currencyDecimals("JPY"), currencyDecimals("KWD")]).toEqual([2, 0, 3]);
  });

  it("sizes a business against its own country's limits", () => {
    expect(sizeClass("2_10", "lt15m")).toBe("micro");
    expect(sizeClass("2_10", "in_10_100cr", "IN")).toBe("small");
    expect(sizeClass("2_10", "gb_15_54m", "GB")).toBe("medium");
    expect(sizeClass("11_50", undefined, "KE")).toBe("small");
  });
});

describe("deciding taxes", () => {
  it("keeps Sri Lanka as it was", () => {
    const d = decideTax({ country: "LK", turnover: "60_250m" });
    expect(d.settings).toEqual({ registered: ["vat", "sscl"], custom: [], invoiceFormat: "lk_ird" });
    expect(d.taxCodes.map((c) => c.name)).toEqual(["VAT 18%", "Zero rated", "VAT exempt", "SSCL 2.5%"]);
    expect(d.reasons[0]).toBe("VAT on: turnover above Rs 60 million a year means registration is required (18%).");
  });

  it("an Indian business over the GST threshold gets GST split into CGST and SGST, and IGST", () => {
    const d = decideTax({ country: "IN", turnover: "in_40l_10cr" });
    expect(d.settings.registered).toEqual(["gst"]);
    expect(d.settings.invoiceFormat).toBe("in_gst");
    expect(d.reasons[0]).toContain("₹40 lakh");
    expect(d.taxCodes.map((c) => c.name)).toEqual(expect.arrayContaining(["GST 18%", "IGST 18%", "GST exempt"]));
    const t = businessTaxes("IN", d.settings);
    expect(t.registered.map((x) => x.id)).toEqual(["gst", "igst"]);
    expect(t.forCode({ kind: "vat", tax: "igst" })?.parts?.[0]?.output).toBe("vat_output");
    expect(t.forCode({ kind: "vat" })?.id).toBe("gst");
    expect(decideTax({ country: "IN", turnover: "in_20_40l" }).settings.registered).toEqual([]);
  });

  it("a UK business below the VAT threshold that registered anyway", () => {
    const d = decideTax({ country: "GB", turnover: "gb_lt90k", registrations: ["vat"] });
    expect(d.settings.registered).toEqual(["vat"]);
    expect(d.reasons).toContain("VAT on, as you're registered (20%).");
    expect(d.taxCodes.map((c) => c.rate)).toEqual([20, 5, 0, 0]);
    const late = decideTax({ country: "GB", turnover: "gb_90k_1m", registrations: [] });
    expect(late.warnings[0]).toContain("£90,000");
  });

  it("a US business enters sales tax per state", () => {
    const d = decideTax({ country: "US", turnover: "us_1_10m", registrations: ["sales_tax"], ownRates: parseOwnRates("Texas 8.25%, New York 8.875%") });
    expect(d.settings.registered).toEqual(["sales_tax"]);
    expect(d.taxCodes).toEqual([
      { name: "Texas sales tax 8.25%", rate: 8.25, kind: "sales_tax", tax: "sales_tax" },
      { name: "New York sales tax 8.875%", rate: 8.875, kind: "sales_tax", tax: "sales_tax" },
    ]);
    expect(taxFlags({ business: { country: "US" }, settings: { tax: d.settings } })).toEqual({ vat: true, wht: false, sscl: false });
  });

  it("an unlisted country gets exactly the taxes the person names", () => {
    const d = decideTax({ country: "KE", ownRates: parseOwnRates("VAT 16% and withholding tax 5%") });
    expect(d.settings.custom).toEqual([
      { id: "own_vat", label: "VAT", kind: "value_added", rate: 16 },
      { id: "own_withholding_tax", label: "withholding tax", kind: "withholding", rate: 5 },
    ]);
    expect(d.settings.registered).toEqual(["own_vat", "own_withholding_tax"]);
    expect(decideTax({ country: "KE" }).taxCodes).toEqual([]);
  });
});

describe("tax settings", () => {
  it("reads the old Sri Lankan flags", () => {
    const s = Settings.parse({ tax: { vatRegistered: true, ssclRegistered: true, wht: false, irdTaxInvoice: true }, accounting: { chartTemplate: "lk_manufacturing" } });
    expect(s.tax).toEqual({ registered: ["vat", "sscl"], custom: [], invoiceFormat: "lk_ird" });
    expect(s.accounting.chartTemplate).toBe("manufacturing");
    expect(Settings.parse({ tax: { registered: ["vat", "sscl"], ssclRegistered: false } }).tax.registered).toEqual(["vat"]);
    expect(Blueprint.parse(plasticsFactory).settings.tax).toEqual({ registered: ["vat", "sscl"], custom: [], invoiceFormat: "lk_ird" });
  });

  it("refuses a tax the country doesn't have", () => {
    const bp = Blueprint.parse(plasticsFactory);
    bp.settings.tax.registered = ["vat", "gst"];
    const r = validateBlueprint(bp);
    expect(r.issues.find((i) => i.path.join(".") === "settings.tax.registered.1")?.message).toMatch(/isn't a tax of Sri Lanka/);
  });

  it("an Indian business on GST validates with the GST accounts", () => {
    const bp = Blueprint.parse(plasticsFactory);
    bp.business = { ...bp.business, country: "IN", currency: "INR", locale: "en-IN", timezone: "Asia/Kolkata" };
    bp.settings.tax = { registered: ["gst"], custom: [], invoiceFormat: "in_gst" };
    const r = validateBlueprint(bp);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
