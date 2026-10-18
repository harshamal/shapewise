import type { SystemRole } from "./catalogue/accounts";
import { ISO_CURRENCY, regionName, regionTimezone } from "./iso";
import type { SettingsInput } from "./settings";

/**
 * What the country and the size of a business decide on their own, in code:
 * currency, locale, fiscal year, which taxes apply and the controls a
 * business of that size usually wants. The AI never decides these; it only
 * asks the questions whose answers feed them, and the person confirms.
 *
 * Countries are data. Each built in country has its turnover bands in its
 * own currency, its size classes and its taxes. Any other ISO country works
 * too: currency from the ISO table, name, locale and timezone from Intl, and
 * the person names their own taxes. Nothing about tax is hardcoded for it.
 *
 * Tax figures change with budgets, so each tax carries the date it applies
 * from and where it comes from. Anything inferred is shown to the person as
 * a reason they can check, never applied silently.
 */

/* ---------------------------------------------------------------- tax */

/**
 * value_added: VAT or GST, charged on sales and claimed back on purchases.
 * sales: a sales tax, charged on sales only (purchases carry it as cost).
 * levy: a turnover levy charged on sales (Sri Lanka's SSCL).
 * withholding: deducted from payments to suppliers and suffered on receipts.
 */
export const TAX_KINDS = ["value_added", "sales", "levy", "withholding"] as const;
export type TaxKind = (typeof TAX_KINDS)[number];
export const TAX_KIND_LABEL: Record<TaxKind, string> = { value_added: "VAT or GST", sales: "Sales tax", levy: "Levy on turnover", withholding: "Withholding tax" };

export type TaxSide = "sales" | "purchases" | "both";

/** Where a tax posts. A split tax (India's CGST and SGST) has more than one part. */
export interface TaxPart {
  label: string;
  /** Share of the tax, 0 to 1. Shares add up to 1. */
  share: number;
  /** Role credited when charged on a sale. */
  output: SystemRole;
  /** Role debited when claimed on a purchase; none means it stays in the cost. */
  input?: SystemRole;
}

/** A rate seeded as a tax code. */
export interface TaxRateDef {
  name: string;
  rate: number;
  /** A zero rated or exempt code: no tax, but reported apart. */
  zero?: "zero_rated" | "exempt";
}

export interface TaxDef {
  /** Unique within the country: "vat", "gst", "igst", "sscl", "wht", "sales_tax". */
  id: string;
  kind: TaxKind;
  /** The name used in reasons, e.g. "VAT" or "Social Security Contribution Levy". */
  label: string;
  /** The short name on options, accounts and tax codes, e.g. "SSCL". */
  short: string;
  appliesTo: TaxSide;
  /** The headline rate, percent. */
  rate?: number;
  /** Tax codes to create when registered. Empty when the business enters its own (US sales tax). */
  rates: readonly TaxRateDef[];
  /** Registration is required above this annual taxable turnover, in the country's currency. */
  annualThreshold?: number;
  quarterlyThreshold?: number;
  /** Registered together with another tax of the country (IGST with GST). */
  with?: string;
  /** Posting parts. Default: one part on the kind's roles. */
  parts?: readonly TaxPart[];
  /** Said with the reason, e.g. a lower threshold for services. */
  note?: string;
  effectiveFrom: string;
  source: string;
}

export interface TurnoverBandDef {
  key: string;
  label: string;
  /** In the country's currency, major units. */
  min: number;
  max: number;
}

export interface Country {
  code: string;
  name: string;
  currency: string;
  /** How amounts are written in reasons ("Rs ", "£"). */
  symbol: string;
  locale: string;
  timezone: string;
  fiscalYearStartMonth: number;
  /** Tax rules are built in (registration thresholds, rates). False: the person names their taxes. */
  taxRules: boolean;
  taxes: readonly TaxDef[];
  /** Yearly sales bands, cut at the tax thresholds and the size classes. Empty: turnover isn't asked. */
  turnoverBands: readonly TurnoverBandDef[];
  /** Upper turnover of each size class, in the country's currency. */
  sizeLimits?: { micro: number; small: number; medium: number; source: string };
  /** Country specific invoice formats the business can switch on. */
  invoiceFormats?: readonly { id: string; label: string }[];
  /** For a tax with no built in rates, how the business gives its own (US: a rate per state). */
  ownRates?: { question: string; placeholder: string; name: (place: string, rate: number) => string };
  aliases?: readonly string[];
}

/** Default posting part for a kind of tax. */
export function taxParts(t: Pick<TaxDef, "kind" | "short" | "parts">): readonly TaxPart[] {
  if (t.parts) return t.parts;
  switch (t.kind) {
    case "value_added":
      return [{ label: t.short, share: 1, output: "vat_output", input: "vat_input" }];
    case "sales":
      return [{ label: t.short, share: 1, output: "vat_output" }];
    case "levy":
      return [{ label: t.short, share: 1, output: "sscl_payable" }];
    case "withholding":
      return [];
  }
}

/* ---------------------------------------------------------- countries */

const zero = (name = "Zero rated"): TaxRateDef => ({ name, rate: 0, zero: "zero_rated" });
const exempt = (name: string): TaxRateDef => ({ name, rate: 0, zero: "exempt" });
const vat = (short: string, rate: number, rest: Omit<TaxDef, "id" | "kind" | "label" | "short" | "appliesTo" | "rate" | "rates"> & { rates?: TaxRateDef[]; id?: string; label?: string }): TaxDef => ({
  id: rest.id ?? short.toLowerCase(),
  kind: "value_added",
  label: rest.label ?? short,
  short,
  appliesTo: "both",
  rate,
  rates: rest.rates ?? [{ name: `${short} ${rate}%`, rate }, zero(), exempt(`${short} exempt`)],
  ...rest,
});

const SRI_LANKA: Country = {
  code: "LK",
  name: "Sri Lanka",
  currency: "LKR",
  symbol: "Rs ",
  locale: "en-LK",
  timezone: "Asia/Colombo",
  fiscalYearStartMonth: 4,
  taxRules: true,
  aliases: ["srilanka", "ceylon"],
  taxes: [
    vat("VAT", 18, {
      annualThreshold: 60e6,
      quarterlyThreshold: 15e6,
      effectiveFrom: "2024-01-01",
      source: "VAT Act No. 14 of 2002 as amended; the proposed cut to Rs 36 million was withdrawn in 2026",
    }),
    {
      id: "sscl",
      kind: "levy",
      label: "Social Security Contribution Levy",
      short: "SSCL",
      appliesTo: "sales",
      rate: 2.5,
      rates: [{ name: "SSCL 2.5%", rate: 2.5 }],
      annualThreshold: 36e6,
      quarterlyThreshold: 9e6,
      effectiveFrom: "2026-07-01",
      source: "SSCL Act No. 25 of 2022, amended by Act No. 10 of 2026",
    },
    {
      id: "wht",
      kind: "withholding",
      label: "Withholding tax",
      short: "WHT",
      appliesTo: "both",
      rate: 5,
      rates: [
        { name: "WHT on service fees 5%", rate: 5 },
        { name: "WHT on rent 10%", rate: 10 },
      ],
      effectiveFrom: "2025-04-01",
      source: "Inland Revenue Act No. 24 of 2017 as amended; 5% on service fees, 10% on rent",
    },
  ],
  turnoverBands: [
    { key: "lt15m", label: "Under Rs 15 million", min: 0, max: 15e6 },
    { key: "15_36m", label: "Rs 15 to 36 million", min: 15e6, max: 36e6 },
    { key: "36_60m", label: "Rs 36 to 60 million", min: 36e6, max: 60e6 },
    { key: "60_250m", label: "Rs 60 to 250 million", min: 60e6, max: 250e6 },
    { key: "250_750m", label: "Rs 250 to 750 million", min: 250e6, max: 750e6 },
    { key: "gt750m", label: "Over Rs 750 million", min: 750e6, max: Infinity },
  ],
  // National Policy Framework for SME Development: micro up to 10 people or Rs 15M, small up to 50 or Rs 250M, medium up to 300 or Rs 750M.
  sizeLimits: { micro: 15e6, small: 250e6, medium: 750e6, source: "National Policy Framework for SME Development" },
  invoiceFormats: [{ id: "lk_ird", label: "IRD tax invoice format" }],
};

const MALDIVES: Country = {
  code: "MV",
  name: "Maldives",
  currency: "MVR",
  symbol: "MVR ",
  locale: "en-MV",
  timezone: "Indian/Maldives",
  fiscalYearStartMonth: 1,
  taxRules: true,
  taxes: [
    vat("GST", 8, {
      label: "GST",
      annualThreshold: 1e6,
      effectiveFrom: "2023-01-01",
      source: "Goods and Services Tax Act (Law No. 10/2011) as amended; general rate 8% from 1 January 2023",
    }),
    vat("TGST", 17, {
      label: "Tourism GST",
      rates: [{ name: "TGST 17%", rate: 17 }],
      note: "Tourism businesses register whatever their turnover.",
      effectiveFrom: "2025-07-01",
      source: "Goods and Services Tax Act (Law No. 10/2011) as amended; tourism rate 17% from 1 July 2025",
    }),
  ],
  turnoverBands: [
    { key: "mv_lt1m", label: "Under MVR 1 million", min: 0, max: 1e6 },
    { key: "mv_1_10m", label: "MVR 1 to 10 million", min: 1e6, max: 10e6 },
    { key: "mv_10_40m", label: "MVR 10 to 40 million", min: 10e6, max: 40e6 },
    { key: "mv_gt40m", label: "Over MVR 40 million", min: 40e6, max: Infinity },
  ],
  sizeLimits: { micro: 1e6, small: 10e6, medium: 40e6, source: "Small and Medium Enterprise Act (Law No. 6/2013), approximately" },
};

const INDIA: Country = {
  code: "IN",
  name: "India",
  currency: "INR",
  symbol: "₹",
  locale: "en-IN",
  timezone: "Asia/Kolkata",
  fiscalYearStartMonth: 4,
  taxRules: true,
  aliases: ["bharat"],
  taxes: [
    {
      id: "gst",
      kind: "value_added",
      label: "GST",
      short: "GST",
      appliesTo: "both",
      rate: 18,
      rates: [{ name: "GST 5%", rate: 5 }, { name: "GST 18%", rate: 18 }, { name: "GST 40%", rate: 40 }, zero("GST nil rated"), exempt("GST exempt")],
      // Within a state the tax is split equally between the centre and the state.
      parts: [
        { label: "CGST", share: 0.5, output: "cgst_output", input: "cgst_input" },
        { label: "SGST", share: 0.5, output: "sgst_output", input: "sgst_input" },
      ],
      annualThreshold: 40e5,
      note: "Service businesses register from ₹20 lakh, and anyone selling goods to other states registers whatever their turnover.",
      effectiveFrom: "2025-09-22",
      source: "CGST Act 2017 and the state GST Acts; slabs of 5%, 18% and 40% from 22 September 2025",
    },
    {
      id: "igst",
      kind: "value_added",
      label: "IGST",
      short: "IGST",
      appliesTo: "both",
      rate: 18,
      with: "gst",
      rates: [{ name: "IGST 5%", rate: 5 }, { name: "IGST 18%", rate: 18 }, { name: "IGST 40%", rate: 40 }],
      parts: [{ label: "IGST", share: 1, output: "vat_output", input: "vat_input" }],
      effectiveFrom: "2025-09-22",
      source: "IGST Act 2017, for supplies from one state to another",
    },
    {
      id: "tds",
      kind: "withholding",
      label: "TDS",
      short: "TDS",
      appliesTo: "both",
      rate: 10,
      rates: [
        { name: "TDS on contracts 2%", rate: 2 },
        { name: "TDS on professional fees 10%", rate: 10 },
        { name: "TDS on rent 10%", rate: 10 },
      ],
      effectiveFrom: "2026-04-01",
      source: "Income Tax Act, tax deducted at source on contractors, rent and professional fees",
    },
  ],
  turnoverBands: [
    { key: "in_lt20l", label: "Under ₹20 lakh", min: 0, max: 20e5 },
    { key: "in_20_40l", label: "₹20 to 40 lakh", min: 20e5, max: 40e5 },
    { key: "in_40l_10cr", label: "₹40 lakh to ₹10 crore", min: 40e5, max: 10e7 },
    { key: "in_10_100cr", label: "₹10 to 100 crore", min: 10e7, max: 100e7 },
    { key: "in_100_500cr", label: "₹100 to 500 crore", min: 100e7, max: 500e7 },
    { key: "in_gt500cr", label: "Over ₹500 crore", min: 500e7, max: Infinity },
  ],
  sizeLimits: { micro: 10e7, small: 100e7, medium: 500e7, source: "MSMED Act classification as revised from 1 April 2025" },
  invoiceFormats: [{ id: "in_gst", label: "GST tax invoice (GSTIN, HSN or SAC and place of supply)" }],
};

const UAE: Country = {
  code: "AE",
  name: "United Arab Emirates",
  currency: "AED",
  symbol: "AED ",
  locale: "en-AE",
  timezone: "Asia/Dubai",
  fiscalYearStartMonth: 1,
  taxRules: true,
  aliases: ["uae", "dubai", "abu dhabi", "emirates"],
  taxes: [
    vat("VAT", 5, {
      annualThreshold: 375_000,
      note: "Registering by choice is allowed from AED 187,500.",
      effectiveFrom: "2018-01-01",
      source: "Federal Decree Law No. 8 of 2017 on Value Added Tax",
    }),
  ],
  turnoverBands: [
    { key: "ae_lt187k", label: "Under AED 187,500", min: 0, max: 187_500 },
    { key: "ae_187k_375k", label: "AED 187,500 to 375,000", min: 187_500, max: 375_000 },
    { key: "ae_375k_9m", label: "AED 375,000 to 9 million", min: 375_000, max: 9e6 },
    { key: "ae_9_50m", label: "AED 9 to 50 million", min: 9e6, max: 50e6 },
    { key: "ae_50_250m", label: "AED 50 to 250 million", min: 50e6, max: 250e6 },
    { key: "ae_gt250m", label: "Over AED 250 million", min: 250e6, max: Infinity },
  ],
  sizeLimits: { micro: 9e6, small: 50e6, medium: 250e6, source: "Cabinet Resolution No. 22 of 2016 on SMEs (trading sector)" },
  invoiceFormats: [{ id: "ae_tax_invoice", label: "UAE tax invoice (TRN on every invoice)" }],
};

const SINGAPORE: Country = {
  code: "SG",
  name: "Singapore",
  currency: "SGD",
  symbol: "S$",
  locale: "en-SG",
  timezone: "Asia/Singapore",
  fiscalYearStartMonth: 1,
  taxRules: true,
  taxes: [
    vat("GST", 9, {
      label: "GST",
      annualThreshold: 1e6,
      effectiveFrom: "2024-01-01",
      source: "Goods and Services Tax Act 1993; rate 9% from 1 January 2024",
    }),
  ],
  turnoverBands: [
    { key: "sg_lt1m", label: "Under S$1 million", min: 0, max: 1e6 },
    { key: "sg_1_10m", label: "S$1 to 10 million", min: 1e6, max: 10e6 },
    { key: "sg_10_100m", label: "S$10 to 100 million", min: 10e6, max: 100e6 },
    { key: "sg_gt100m", label: "Over S$100 million", min: 100e6, max: Infinity },
  ],
  sizeLimits: { micro: 1e6, small: 10e6, medium: 100e6, source: "Enterprise Singapore: SMEs have up to S$100 million in sales" },
};

const AUSTRALIA: Country = {
  code: "AU",
  name: "Australia",
  currency: "AUD",
  symbol: "A$",
  locale: "en-AU",
  timezone: "Australia/Sydney",
  fiscalYearStartMonth: 7,
  taxRules: true,
  taxes: [
    vat("GST", 10, {
      label: "GST",
      rates: [{ name: "GST 10%", rate: 10 }, zero("GST free"), exempt("Input taxed")],
      annualThreshold: 75_000,
      note: "Taxi and ride share drivers register whatever their turnover.",
      effectiveFrom: "2000-07-01",
      source: "A New Tax System (Goods and Services Tax) Act 1999",
    }),
  ],
  turnoverBands: [
    { key: "au_lt75k", label: "Under A$75,000", min: 0, max: 75_000 },
    { key: "au_75k_2m", label: "A$75,000 to 2 million", min: 75_000, max: 2e6 },
    { key: "au_2_10m", label: "A$2 to 10 million", min: 2e6, max: 10e6 },
    { key: "au_10_50m", label: "A$10 to 50 million", min: 10e6, max: 50e6 },
    { key: "au_50_250m", label: "A$50 to 250 million", min: 50e6, max: 250e6 },
    { key: "au_gt250m", label: "Over A$250 million", min: 250e6, max: Infinity },
  ],
  sizeLimits: { micro: 2e6, small: 10e6, medium: 250e6, source: "ATO: small business under A$10 million aggregated turnover, medium up to A$250 million" },
  invoiceFormats: [{ id: "au_tax_invoice", label: "Tax invoice with ABN" }],
};

const UNITED_KINGDOM: Country = {
  code: "GB",
  name: "United Kingdom",
  currency: "GBP",
  symbol: "£",
  locale: "en-GB",
  timezone: "Europe/London",
  fiscalYearStartMonth: 4,
  taxRules: true,
  aliases: ["uk", "england", "scotland", "wales", "northern ireland", "great britain", "britain"],
  taxes: [
    vat("VAT", 20, {
      rates: [{ name: "VAT 20%", rate: 20 }, { name: "VAT 5%", rate: 5 }, zero(), exempt("VAT exempt")],
      annualThreshold: 90_000,
      effectiveFrom: "2024-04-01",
      source: "Value Added Tax Act 1994; registration threshold £90,000 from 1 April 2024",
    }),
    {
      id: "cis",
      kind: "withholding",
      label: "Construction Industry Scheme",
      short: "CIS",
      appliesTo: "both",
      rate: 20,
      rates: [
        { name: "CIS 20%", rate: 20 },
        { name: "CIS 30% unregistered", rate: 30 },
      ],
      note: "Only for construction work.",
      effectiveFrom: "2007-04-06",
      source: "Finance Act 2004 and the Income Tax (Construction Industry Scheme) Regulations 2005",
    },
  ],
  turnoverBands: [
    { key: "gb_lt90k", label: "Under £90,000", min: 0, max: 90_000 },
    { key: "gb_90k_1m", label: "£90,000 to £1 million", min: 90_000, max: 1e6 },
    { key: "gb_1_15m", label: "£1 to 15 million", min: 1e6, max: 15e6 },
    { key: "gb_15_54m", label: "£15 to 54 million", min: 15e6, max: 54e6 },
    { key: "gb_gt54m", label: "Over £54 million", min: 54e6, max: Infinity },
  ],
  sizeLimits: { micro: 1e6, small: 15e6, medium: 54e6, source: "Companies Act 2006 size thresholds from 6 April 2025" },
  invoiceFormats: [{ id: "gb_vat_invoice", label: "VAT invoice (VAT number and rate on every invoice)" }],
};

const UNITED_STATES: Country = {
  code: "US",
  name: "United States",
  currency: "USD",
  symbol: "$",
  locale: "en-US",
  timezone: "America/New_York",
  fiscalYearStartMonth: 1,
  taxRules: true,
  aliases: ["usa", "us", "america", "united states of america"],
  taxes: [
    {
      id: "sales_tax",
      kind: "sales",
      label: "Sales tax",
      short: "Sales tax",
      appliesTo: "sales",
      rates: [],
      note: "Each state sets its own rate and when you must collect, often from $100,000 of sales into the state.",
      effectiveFrom: "2018-06-21",
      source: "State sales tax laws; economic nexus after South Dakota v. Wayfair (2018)",
    },
  ],
  turnoverBands: [
    { key: "us_lt100k", label: "Under $100,000", min: 0, max: 100_000 },
    { key: "us_100k_1m", label: "$100,000 to $1 million", min: 100_000, max: 1e6 },
    { key: "us_1_10m", label: "$1 to 10 million", min: 1e6, max: 10e6 },
    { key: "us_10_50m", label: "$10 to 50 million", min: 10e6, max: 50e6 },
    { key: "us_gt50m", label: "Over $50 million", min: 50e6, max: Infinity },
  ],
  sizeLimits: { micro: 1e6, small: 10e6, medium: 50e6, source: "A rough guide; SBA size standards differ by industry" },
  ownRates: {
    question: "Which states do you collect sales tax in, and at what rate?",
    placeholder: "e.g. Texas 8.25%, New York 8.875%",
    name: (place, rate) => `${place} sales tax ${rate}%`,
  },
};

/** Countries with built in rules, in the order they're offered. */
export const COUNTRIES: readonly Country[] = [SRI_LANKA, MALDIVES, INDIA, UAE, SINGAPORE, AUSTRALIA, UNITED_KINGDOM, UNITED_STATES];
export const COUNTRY_BY_CODE: ReadonlyMap<string, Country> = new Map(COUNTRIES.map((c) => [c.code, c]));

/** Sri Lanka's taxes by kind, as before countries were data. */
export const LK_TAX = { vat: SRI_LANKA.taxes[0]!, sscl: SRI_LANKA.taxes[1]!, wht: SRI_LANKA.taxes[2]! };

const generic = new Map<string, Country>();

/**
 * Any ISO country. Built in ones come with their rules; the rest get their
 * currency from the ISO table and their name, locale and timezone from Intl,
 * with no taxes until the business names its own.
 */
export function countryFor(code: string | undefined): Country | undefined {
  if (!code) return undefined;
  const c = code.toUpperCase();
  const known = COUNTRY_BY_CODE.get(c);
  if (known) return known;
  const currency = ISO_CURRENCY.get(c);
  if (!currency) return undefined;
  let g = generic.get(c);
  if (!g) {
    g = { code: c, name: regionName(c), currency, symbol: `${currency} `, locale: `en-${c}`, timezone: regionTimezone(c), fiscalYearStartMonth: 1, taxRules: false, taxes: [], turnoverBands: [] };
    generic.set(c, g);
  }
  return g;
}

/** Every ISO country, built in ones first, then the rest by name. */
export function allCountries(): Country[] {
  const rest = [...ISO_CURRENCY.keys()].filter((c) => !COUNTRY_BY_CODE.has(c)).map((c) => countryFor(c)!);
  return [...COUNTRIES, ...rest.sort((a, b) => a.name.localeCompare(b.name))];
}

/** Find a country by code or name, forgivingly ("sri lanka", "LK", "UAE", "Kenya"). */
export function findCountry(text: string): Country | undefined {
  const t = text.trim().toLowerCase().replace(/\.$/, "");
  if (!t) return undefined;
  const squash = (s: string) => s.replace(/[\s.]+/g, "");
  for (const c of COUNTRIES) if (c.aliases?.some((a) => a === t || squash(a) === squash(t))) return c;
  if (/^[a-z]{2}$/.test(t)) return countryFor(t);
  const all = allCountries();
  return all.find((c) => c.name.toLowerCase() === t) ?? all.find((c) => t.includes(c.name.toLowerCase())) ?? (t.length >= 4 ? all.find((c) => c.name.toLowerCase().startsWith(t)) : undefined);
}

/** An amount in a country's own words: "Rs 60 million", "₹40 lakh", "£90,000". */
export function moneyWords(country: Country, n: number): string {
  if (country.code === "IN") {
    if (n >= 1e7) return `₹${+(n / 1e7).toFixed(2)} crore`;
    if (n >= 1e5) return `₹${+(n / 1e5).toFixed(2)} lakh`;
  }
  if (n >= 1e6) return `${country.symbol}${+(n / 1e6).toFixed(2)} million`;
  return `${country.symbol}${n.toLocaleString("en")}`;
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

/** Sri Lanka's turnover bands, in rupees. Other countries have their own (Country.turnoverBands). */
export const TURNOVER_BANDS = SRI_LANKA.turnoverBands;
/** Every band key of every built in country. Keys are unique across countries. */
export const TURNOVER_KEYS: readonly string[] = COUNTRIES.flatMap((c) => c.turnoverBands.map((b) => b.key));
export type TurnoverBand = string;

/** A turnover band by key, in the given country's bands (or any country's, if none given). */
export function turnoverBand(key: string | undefined, country?: string): TurnoverBandDef | undefined {
  if (!key) return undefined;
  const pool = country ? (countryFor(country)?.turnoverBands ?? []) : COUNTRIES.flatMap((c) => c.turnoverBands);
  return pool.find((b) => b.key === key);
}

export type SizeClass = "micro" | "small" | "medium" | "large";
export const SIZE_LABEL: Record<SizeClass, string> = { micro: "Micro", small: "Small", medium: "Medium", large: "Large" };

/**
 * Size class from team and turnover, the larger of the two winning. Team
 * cuts are the same everywhere (10, 50, 200); turnover is measured against
 * the country's own size limits (Sri Lanka's SME policy by default).
 */
export function sizeClass(team?: TeamSize, turnover?: TurnoverBand, countryCode?: string): SizeClass | undefined {
  if (!team && !turnover) return undefined;
  const order: SizeClass[] = ["micro", "small", "medium", "large"];
  const byTeam: SizeClass | undefined = team && ({ solo: "micro", "2_10": "micro", "11_50": "small", "51_200": "medium", "200_plus": "large" } as const)[team];
  const band = turnoverBand(turnover, countryCode);
  const owner = band && COUNTRIES.find((c) => c.turnoverBands.includes(band));
  const limits = owner?.sizeLimits;
  const byTurnover: SizeClass | undefined = band && limits ? (band.max <= limits.micro ? "micro" : band.max <= limits.small ? "small" : band.max <= limits.medium ? "medium" : "large") : undefined;
  return order[Math.max(order.indexOf(byTeam ?? "micro"), order.indexOf(byTurnover ?? "micro"))];
}

/* ------------------------------------------------- business taxes */

/** A tax the business named itself (any country), in settings.tax.custom. */
export interface CustomTax {
  id: string;
  label: string;
  kind: TaxKind;
  rate: number;
  appliesTo?: TaxSide;
}

/** The parts of the tax settings the tax model reads. */
export interface TaxSettingsLike {
  registered: readonly string[];
  custom: readonly CustomTax[];
  invoiceFormat?: string;
}

export function customTaxDef(c: CustomTax): TaxDef {
  return {
    id: c.id,
    kind: c.kind,
    label: c.label,
    short: c.label,
    appliesTo: c.appliesTo ?? (c.kind === "value_added" || c.kind === "withholding" ? "both" : "sales"),
    rate: c.rate,
    rates: [{ name: `${c.label} ${c.rate}%`, rate: c.rate }],
    effectiveFrom: "",
    source: "Entered by the business",
  };
}

/** Legacy names for a kind of tax, used by tax codes and settings written before countries were data. */
const ALIAS_KINDS: Record<string, TaxKind[]> = { vat: ["value_added", "sales"], sales_tax: ["sales"], sscl: ["levy"], levy: ["levy"], wht: ["withholding"] };

export interface BusinessTaxes {
  /** Every tax the business could use: the country's, then its own. */
  all: readonly TaxDef[];
  /** The taxes it is registered for (with the ones registered together, like IGST with GST). */
  registered: readonly TaxDef[];
  isRegistered(id: string): boolean;
  /** The tax a tax code belongs to: by its tax id, else by its kind (vat, sscl, wht). */
  forCode(code: { kind?: unknown; tax?: unknown }): TaxDef | undefined;
  /** Any registered tax of these kinds. */
  has(...kinds: TaxKind[]): boolean;
}

function byAlias(all: readonly TaxDef[], id: string): TaxDef | undefined {
  const exact = all.find((t) => t.id === id);
  if (exact) return exact;
  const kinds = ALIAS_KINDS[id];
  return kinds ? all.find((t) => kinds.includes(t.kind) && !t.with) : undefined;
}

/** The taxes of a business, from its country and tax settings. */
export function businessTaxes(countryCode: string | undefined, tax: TaxSettingsLike): BusinessTaxes {
  const all = [...(countryFor(countryCode)?.taxes ?? []), ...tax.custom.map(customTaxDef)];
  const ids = new Set(tax.registered.map((r) => byAlias(all, r)?.id).filter((x): x is string => Boolean(x)));
  for (const t of all) if (t.with && ids.has(t.with)) ids.add(t.id);
  const registered = all.filter((t) => ids.has(t.id));
  return {
    all,
    registered,
    isRegistered: (id) => ids.has(id),
    forCode(code) {
      if (typeof code.tax === "string" && code.tax) {
        const t = all.find((x) => x.id === code.tax);
        if (t) return t;
      }
      const kind = typeof code.kind === "string" ? code.kind : "vat";
      return byAlias(all, kind);
    },
    has: (...kinds) => registered.some((t) => kinds.includes(t.kind)),
  };
}

/** Taxes of a blueprint. */
export function taxesOf(bp: { business: { country: string }; settings: { tax: TaxSettingsLike } }): BusinessTaxes {
  return businessTaxes(bp.business.country, bp.settings.tax);
}

/** Which tax reports apply: value added or sales tax, withholding, levies. */
export function taxFlags(bp: { business: { country: string }; settings: { tax: TaxSettingsLike } }): { vat: boolean; wht: boolean; sscl: boolean } {
  const t = taxesOf(bp);
  return { vat: t.has("value_added", "sales"), wht: t.has("withholding"), sscl: t.has("levy") };
}

/** Account roles the registered taxes post to. */
export function taxRoles(taxes: readonly TaxDef[]): SystemRole[] {
  const roles = new Set<SystemRole>();
  for (const t of taxes) {
    if (t.kind === "withholding") (roles.add("wht_receivable"), roles.add("wht_payable"));
    for (const p of taxParts(t)) {
      roles.add(p.output);
      if (p.input && t.appliesTo !== "sales") roles.add(p.input);
    }
  }
  return [...roles];
}

/** Short names of taxes as a list in words: "VAT, SSCL and WHT". */
export function taxList(taxes: readonly TaxDef[]): string {
  const names = taxes.filter((t) => !t.with).map((t) => t.short);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

/* ------------------------------------------------- deciding taxes */

export interface TaxCodeSeed {
  name: string;
  rate: number;
  kind: "vat" | "sscl" | "wht" | "exempt" | "zero_rated" | "sales_tax" | "levy";
  /** The tax it belongs to (TaxDef id); old codes have only a kind. */
  tax?: string;
}

/** The tax code kind for a tax, as stored on tax codes. */
export function codeKind(t: TaxDef, rate?: TaxRateDef): TaxCodeSeed["kind"] {
  if (rate?.zero) return rate.zero;
  if (t.id === "sscl") return "sscl";
  return ({ value_added: "vat", sales: "sales_tax", levy: "levy", withholding: "wht" } as const)[t.kind];
}

/** A rate the business gave in its own words, e.g. "VAT 16%" or "Texas 8.25%". */
export interface OwnRate {
  name: string;
  rate: number;
}

export interface TaxDecision {
  settings: TaxSettingsLike;
  /** Tax rates to create in the new workspace. */
  taxCodes: TaxCodeSeed[];
  /** Why each tax is on or off, in plain words, for the person to check. */
  reasons: string[];
  /** Something the person said that doesn't match the rules (e.g. over the VAT threshold but not registered). */
  warnings: string[];
}

/** Read "VAT 16%, levy 2%" or "Texas 8.25% and Ohio 5.75%" into named rates. */
export function parseOwnRates(text: string): OwnRate[] {
  const out: OwnRate[] = [];
  const re = /([A-Za-z][A-Za-z .'()&/]*?)(?:\s+(?:at|is|of)\s+|\s*[:=]\s*|\s+)(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/gi;
  for (const m of text.matchAll(re)) {
    const name = m[1]!.replace(/^(and|,|we charge|charge|we collect|collect|in)\s+/gi, "").trim();
    const rate = Number(m[2]);
    if (name && rate >= 0 && rate <= 100) out.push({ name: name.slice(0, 40), rate });
  }
  return out.slice(0, 10);
}

/** The kind of tax a name suggests: "withholding", "sales tax", "levy", else VAT or GST. */
export function kindFromName(name: string): TaxKind {
  if (/withhold|\bwht\b|\btds\b|deduct/i.test(name)) return "withholding";
  if (/sales tax|\bsst\b|\bpst\b/i.test(name)) return "sales";
  if (/levy|cess|turnover tax|stamp/i.test(name)) return "levy";
  return "value_added";
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 18) || "tax";

/**
 * Which taxes apply. What the person confirmed wins; otherwise turnover
 * decides, against the country's thresholds. A country without built in
 * rules gets exactly the taxes the person named, at their rates.
 */
export function decideTax(input: { country?: string; turnover?: TurnoverBand; registrations?: readonly string[]; deductsWht?: boolean; ownRates?: readonly OwnRate[] }): TaxDecision {
  const country = countryFor(input.country ?? "LK");
  const reasons: string[] = [];
  const warnings: string[] = [];
  const own = input.ownRates ?? [];

  if (!country?.taxRules) {
    // Nothing built in: each tax they named becomes a tax of their own.
    const custom: CustomTax[] = [];
    const taxCodes: TaxCodeSeed[] = [];
    for (const r of own) {
      const label = r.name.replace(/\s+/g, " ").trim();
      let id = `own_${slug(label)}`;
      if (custom.some((c) => c.id === id)) id = `${id}_${custom.length + 1}`;
      const c: CustomTax = { id, label, kind: kindFromName(label), rate: r.rate };
      custom.push(c);
      const def = customTaxDef(c);
      taxCodes.push({ name: def.rates[0]!.name, rate: c.rate, kind: codeKind(def), tax: id });
      reasons.push(`${label} on at ${r.rate}%, as you told me. Check the rate with your accountant.`);
    }
    if (!custom.length) reasons.push(`No tax rules are built in for ${country?.name ?? "this country"}, so no taxes are set up. Add yours in Settings, Tax, whenever you need them.`);
    return { settings: { registered: custom.map((c) => c.id), custom, invoiceFormat: undefined }, taxCodes, reasons, warnings };
  }

  const band = turnoverBand(input.turnover, country.code);
  const confirmed = input.registrations !== undefined;
  const regs = new Set((input.registrations ?? []).map((r) => byAlias(country.taxes, r)?.id).filter(Boolean));
  const money = (n: number) => moneyWords(country, n);
  const registered: string[] = [];

  for (const t of country.taxes) {
    if (t.with) continue;
    if (t.kind === "withholding") {
      const on = input.deductsWht ?? regs.has(t.id);
      if (on) {
        registered.push(t.id);
        reasons.push(t.id === "wht" && country.code === "LK" ? "Withholding tax on: deducted on rent and service fees you pay, with certificates for your suppliers." : `${t.label} on: deducted from what you pay suppliers, with certificates for them.${t.note ? ` ${t.note}` : ""}`);
      }
      continue;
    }
    const required = band && t.annualThreshold !== undefined ? band.min >= t.annualThreshold : undefined;
    const threshold = t.annualThreshold !== undefined ? money(t.annualThreshold) : undefined;
    const rate = t.rate !== undefined ? ` (${t.rate}%)` : "";
    let on: boolean;
    if (confirmed) {
      on = regs.has(t.id);
      if (on) reasons.push(`${t.label} on, as you're registered${rate}.`);
      else if (required) warnings.push(`Turnover of ${band!.label} is above the ${t.label} threshold of ${threshold} a year, so registration is normally required. Check with your accountant.`);
    } else {
      on = Boolean(required);
      if (required) reasons.push(`${t.label} on: turnover above ${threshold} a year means registration is required${rate}.`);
      else if (band && threshold) reasons.push(`${t.label} off: turnover is under the ${threshold} registration threshold.`);
    }
    if (on && t.note && country.code !== "LK") reasons.push(t.note);
    if (on) registered.push(t.id);
  }

  const taxes = businessTaxes(country.code, { registered, custom: [] });
  const taxCodes: TaxCodeSeed[] = [];
  for (const t of taxes.registered) {
    for (const r of t.rates) taxCodes.push({ name: r.name, rate: r.rate, kind: codeKind(t, r), tax: t.id });
    if (!t.rates.length && country.ownRates) {
      for (const r of own) taxCodes.push({ name: country.ownRates.name(r.name, r.rate), rate: r.rate, kind: codeKind(t), tax: t.id });
      if (!own.length) reasons.push(`Add a ${t.short.toLowerCase()} rate for each place you collect in, in Settings, Tax rates.`);
    }
  }
  const valueAdded = taxes.registered.some((t) => t.kind === "value_added" && !t.with);
  return {
    settings: { registered, custom: [], invoiceFormat: valueAdded ? country.invoiceFormats?.[0]?.id : undefined },
    taxCodes,
    reasons,
    warnings,
  };
}

/** The options to offer for "which taxes are you registered for": the country's own, not the ones that come with another. */
export function registrableTaxes(countryCode: string | undefined): TaxDef[] {
  return (countryFor(countryCode)?.taxes ?? []).filter((t) => !t.with);
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
