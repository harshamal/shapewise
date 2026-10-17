import type { SettingsInput } from "./settings";

/**
 * What the country and the size of a business decide on their own, in code:
 * currency, locale, fiscal year, which taxes apply and the controls a
 * business of that size usually wants. The AI never decides these; it only
 * asks the questions whose answers feed them, and the person confirms.
 *
 * Tax figures change with budgets, so each rule carries the date it applies
 * from and where it comes from. Anything inferred is shown to the person as
 * a reason they can check, never applied silently.
 */

export interface Country {
  code: string;
  name: string;
  currency: string;
  locale: string;
  timezone: string;
  fiscalYearStartMonth: number;
  /** Tax rules are built in (registration thresholds, rates, invoice format). */
  taxRules: boolean;
}

export const COUNTRIES: readonly Country[] = [
  { code: "LK", name: "Sri Lanka", currency: "LKR", locale: "en-LK", timezone: "Asia/Colombo", fiscalYearStartMonth: 4, taxRules: true },
  { code: "MV", name: "Maldives", currency: "MVR", locale: "en-MV", timezone: "Indian/Maldives", fiscalYearStartMonth: 1, taxRules: false },
  { code: "IN", name: "India", currency: "INR", locale: "en-IN", timezone: "Asia/Kolkata", fiscalYearStartMonth: 4, taxRules: false },
  { code: "AE", name: "United Arab Emirates", currency: "AED", locale: "en-AE", timezone: "Asia/Dubai", fiscalYearStartMonth: 1, taxRules: false },
  { code: "SG", name: "Singapore", currency: "SGD", locale: "en-SG", timezone: "Asia/Singapore", fiscalYearStartMonth: 1, taxRules: false },
  { code: "AU", name: "Australia", currency: "AUD", locale: "en-AU", timezone: "Australia/Sydney", fiscalYearStartMonth: 7, taxRules: false },
  { code: "GB", name: "United Kingdom", currency: "GBP", locale: "en-GB", timezone: "Europe/London", fiscalYearStartMonth: 4, taxRules: false },
  { code: "US", name: "United States", currency: "USD", locale: "en-US", timezone: "America/New_York", fiscalYearStartMonth: 1, taxRules: false },
];
export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/** Find a country by code or name, forgivingly ("sri lanka", "LK", "UAE"). */
export function findCountry(text: string): Country | undefined {
  const t = text.trim().toLowerCase();
  const alias: Record<string, string> = { uae: "AE", dubai: "AE", uk: "GB", england: "GB", usa: "US", america: "US", "united states of america": "US", srilanka: "LK", ceylon: "LK" };
  const code = alias[t.replace(/\s+/g, t.length <= 4 ? "" : " ")] ?? alias[t];
  if (code) return COUNTRY_BY_CODE.get(code);
  return COUNTRIES.find((c) => c.code.toLowerCase() === t || c.name.toLowerCase() === t || t.includes(c.name.toLowerCase()));
}

/* ---------------------------------------------------------------- size */

export const TEAM_SIZES = [
  { key: "solo", label: "Just me", max: 1 },
  { key: "2_10", label: "2 to 10 people", max: 10 },
  { key: "11_50", label: "11 to 50 people", max: 50 },
  { key: "51_200", label: "51 to 200 people", max: 200 },
  { key: "200_plus", label: "More than 200", max: Infinity },
] as const;
export type TeamSize = (typeof TEAM_SIZES)[number]["key"];

/** Annual turnover bands in rupees, cut at the tax thresholds and the SME classes. */
export const TURNOVER_BANDS = [
  { key: "lt15m", label: "Under Rs 15 million", min: 0, max: 15e6 },
  { key: "15_36m", label: "Rs 15 to 36 million", min: 15e6, max: 36e6 },
  { key: "36_60m", label: "Rs 36 to 60 million", min: 36e6, max: 60e6 },
  { key: "60_250m", label: "Rs 60 to 250 million", min: 60e6, max: 250e6 },
  { key: "250_750m", label: "Rs 250 to 750 million", min: 250e6, max: 750e6 },
  { key: "gt750m", label: "Over Rs 750 million", min: 750e6, max: Infinity },
] as const;
export type TurnoverBand = (typeof TURNOVER_BANDS)[number]["key"];

export type SizeClass = "micro" | "small" | "medium" | "large";
export const SIZE_LABEL: Record<SizeClass, string> = { micro: "Micro", small: "Small", medium: "Medium", large: "Large" };

/**
 * Sri Lanka's MSME classes (National Policy Framework for SME Development):
 * micro up to 10 people or Rs 15M, small up to 50 or Rs 250M, medium up to
 * 300 or Rs 750M. The larger of the two measures wins.
 */
export function sizeClass(team?: TeamSize, turnover?: TurnoverBand): SizeClass | undefined {
  if (!team && !turnover) return undefined;
  const order: SizeClass[] = ["micro", "small", "medium", "large"];
  const byTeam: SizeClass | undefined = team && ({ solo: "micro", "2_10": "micro", "11_50": "small", "51_200": "medium", "200_plus": "large" } as const)[team];
  const byTurnover: SizeClass | undefined =
    turnover && ({ lt15m: "micro", "15_36m": "small", "36_60m": "small", "60_250m": "small", "250_750m": "medium", gt750m: "large" } as const)[turnover];
  return order[Math.max(order.indexOf(byTeam ?? "micro"), order.indexOf(byTurnover ?? "micro"))];
}

/* ---------------------------------------------------------------- tax */

export type TaxKind = "vat" | "sscl" | "wht";

export interface TaxRule {
  kind: TaxKind;
  label: string;
  rate: number;
  /** Registration is required above this annual taxable turnover, in rupees. */
  annualThreshold?: number;
  quarterlyThreshold?: number;
  effectiveFrom: string;
  source: string;
}

/** Sri Lanka, as of the 2026 amendments. Review each budget. */
export const LK_TAX: Record<TaxKind, TaxRule> = {
  vat: {
    kind: "vat",
    label: "VAT",
    rate: 18,
    annualThreshold: 60e6,
    quarterlyThreshold: 15e6,
    effectiveFrom: "2024-01-01",
    source: "VAT Act No. 14 of 2002 as amended; the proposed cut to Rs 36 million was withdrawn in 2026",
  },
  sscl: {
    kind: "sscl",
    label: "Social Security Contribution Levy",
    rate: 2.5,
    annualThreshold: 36e6,
    quarterlyThreshold: 9e6,
    effectiveFrom: "2026-07-01",
    source: "SSCL Act No. 25 of 2022, amended by Act No. 10 of 2026",
  },
  wht: {
    kind: "wht",
    label: "Withholding tax",
    rate: 5,
    effectiveFrom: "2025-04-01",
    source: "Inland Revenue Act No. 24 of 2017 as amended; 5% on service fees, 10% on rent",
  },
};

export interface TaxCodeSeed {
  name: string;
  rate: number;
  kind: "vat" | "sscl" | "wht" | "exempt" | "zero_rated";
}

export interface TaxDecision {
  settings: { vatRegistered: boolean; ssclRegistered: boolean; wht: boolean; irdTaxInvoice: boolean };
  /** Tax rates to create in the new workspace. */
  taxCodes: TaxCodeSeed[];
  /** Why each tax is on or off, in plain words, for the person to check. */
  reasons: string[];
  /** Something the person said that doesn't match the rules (e.g. over the VAT threshold but not registered). */
  warnings: string[];
}

const rs = (n: number) => `Rs ${n / 1e6} million`;

/**
 * Which taxes apply. What the person confirmed wins; otherwise turnover
 * decides. Only Sri Lanka has built in rules; elsewhere taxes start off and
 * the person sets their own rates.
 */
export function decideTax(input: { country?: string; turnover?: TurnoverBand; registrations?: readonly TaxKind[]; deductsWht?: boolean }): TaxDecision {
  const country = COUNTRY_BY_CODE.get(input.country ?? "LK");
  const off = { vatRegistered: false, ssclRegistered: false, wht: false, irdTaxInvoice: false };
  if (!country?.taxRules) {
    return {
      settings: off,
      taxCodes: [],
      reasons: [`Tax rules for ${country?.name ?? "this country"} aren't built in yet, so taxes start switched off. Add your rates in Accounting, Tax rates.`],
      warnings: [],
    };
  }
  const band = TURNOVER_BANDS.find((b) => b.key === input.turnover);
  const over = (rule: TaxRule) => (band && rule.annualThreshold !== undefined ? band.min >= rule.annualThreshold : undefined);
  const confirmed = input.registrations !== undefined;
  const has = (k: TaxKind) => input.registrations?.includes(k) ?? false;

  const reasons: string[] = [];
  const warnings: string[] = [];
  const decide = (rule: TaxRule): boolean => {
    const required = over(rule);
    const t = rs(rule.annualThreshold!);
    if (confirmed) {
      if (has(rule.kind)) reasons.push(`${rule.label} on, as you're registered (${rule.rate}%).`);
      else if (required) warnings.push(`Turnover of ${band!.label.replace(/^Rs /, "Rs ")} is above the ${rule.label} threshold of ${t} a year, so registration is normally required. Check with your accountant.`);
      return has(rule.kind);
    }
    if (required) reasons.push(`${rule.label} on: turnover above ${t} a year means registration is required (${rule.rate}%).`);
    else if (band) reasons.push(`${rule.label} off: turnover is under the ${t} registration threshold.`);
    return Boolean(required);
  };

  const vatRegistered = decide(LK_TAX.vat);
  const ssclRegistered = decide(LK_TAX.sscl);
  const wht = input.deductsWht ?? has("wht");
  if (wht) reasons.push("Withholding tax on: deducted on rent and service fees you pay, with certificates for your suppliers.");

  const taxCodes: TaxCodeSeed[] = [];
  if (vatRegistered) taxCodes.push({ name: `VAT ${LK_TAX.vat.rate}%`, rate: LK_TAX.vat.rate, kind: "vat" }, { name: "Zero rated", rate: 0, kind: "zero_rated" }, { name: "VAT exempt", rate: 0, kind: "exempt" });
  if (ssclRegistered) taxCodes.push({ name: `SSCL ${LK_TAX.sscl.rate}%`, rate: LK_TAX.sscl.rate, kind: "sscl" });
  if (wht) taxCodes.push({ name: "WHT on service fees 5%", rate: 5, kind: "wht" }, { name: "WHT on rent 10%", rate: 10, kind: "wht" });

  return {
    settings: { vatRegistered, ssclRegistered, wht, irdTaxInvoice: vatRegistered },
    taxCodes,
    reasons,
    warnings,
  };
}

/* ------------------------------------------------- controls by size */

export interface SizePolicy {
  settings: SettingsInput;
  /** Advice for the designer: the roles and controls that suit this size. */
  guidance: string;
}

/** The controls a business of this size usually wants. The plan may still override them. */
export function sizePolicy(size: SizeClass | undefined): SizePolicy {
  switch (size ?? "small") {
    case "micro":
      return {
        settings: { sales: { creditLimitMode: "off" }, inventory: { negativeStock: "warn" }, agents: { holdAgentWrites: "posting" } },
        guidance: "Micro business: one or two people do everything. Keep roles to owner and perhaps one helper. Fewer screens is better.",
      };
    case "small":
      return {
        settings: { sales: { creditLimitMode: "warn" }, inventory: { negativeStock: "block" } },
        guidance: "Small business: a handful of roles (owner, accountant, sales or stores as they apply), each seeing only their own screens.",
      };
    case "medium":
      return {
        settings: { sales: { creditLimitMode: "block" }, inventory: { negativeStock: "block" }, accounting: { costCentres: true }, general: { allowDocDateEdit: false } },
        guidance: "Medium business: separate duties (who sells is not who posts to accounts). Credit limits enforced. Cost centres on.",
      };
    case "large":
      return {
        settings: { sales: { creditLimitMode: "block" }, inventory: { negativeStock: "block" }, accounting: { costCentres: true, budgetEnforcement: "warn" }, agents: { holdAgentWrites: "all" } },
        guidance: "Large business: clear separation of duties and departments. Budgets warned. Every assistant change waits for a person.",
      };
  }
}
