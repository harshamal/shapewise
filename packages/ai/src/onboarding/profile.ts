import { z } from "zod";
import { REPORT_BY_KEY, REPORT_PLACE_LABEL, TEAM_SIZES, TURNOVER_BANDS, COUNTRY_BY_CODE, decideTax, sizeClass, type SizeClass, type TaxDecision } from "@shapewise/blueprint";

/**
 * What the interview learns about a business, in the person's own terms.
 * Everything is optional so a profile builds up a turn at a time.
 *
 * Country, team size, turnover and tax registrations are facts with fixed
 * answers: the app asks them itself (no model call) and code derives the
 * size class and taxes from them.
 */

const nonEmpty = <T extends string>(xs: readonly T[]) => xs as unknown as [T, ...T[]];
export const TeamSizeKey = z.enum(nonEmpty(TEAM_SIZES.map((t) => t.key)));
export const TurnoverKey = z.enum(nonEmpty(TURNOVER_BANDS.map((t) => t.key)));
export const TaxKey = z.enum(["vat", "sscl", "wht"]);

const list = (max: number, item = 160) => z.array(z.string().max(item)).max(max).optional();

export const BusinessProfile = z.object({
  businessName: z.string().max(120).optional(),
  whatTheyDo: z.string().max(400).optional().describe("one or two sentences in plain words"),
  country: z.string().regex(/^[A-Z]{2}$/).optional().describe("ISO country code, only if they said where they operate"),
  city: z.string().max(80).optional(),
  teamSize: TeamSizeKey.optional().describe("only if they said how many people work there"),
  turnover: TurnoverKey.optional().describe("only if they said their yearly sales"),
  taxRegistrations: z.array(TaxKey).max(3).optional().describe("only taxes they said they're registered for"),
  /** The person answered the tax question (so an empty list means none). */
  taxConfirmed: z.boolean().optional(),
  products: list(40, 120),
  customers: list(10).describe("who buys (cafés, contractors, walk in customers)"),
  salesChannels: list(8, 80).describe("how they sell: shop counter, wholesale, online, delivery, export, contracts"),
  paymentTerms: list(6, 80).describe("cash, credit (with days), cheques, card, bank transfer"),
  suppliers: list(10),
  makesThings: z.boolean().optional(),
  productionSteps: list(20),
  machines: list(30, 120),
  qualityChecks: list(20),
  stockPractices: list(10).describe("stores, lots, expiry, cartons, bins"),
  locations: list(10, 80).describe("shops, branches, factories and stores"),
  documents: list(20, 120).describe("quotes, delivery notes, job cards, invoices they use today"),
  team: list(20, 120).describe("roles of people who will use the system"),
  approvals: list(10, 200).describe("who must approve what, with amounts"),
  thingsToTrack: list(20, 200).describe("extra details they record (colour code, allergens, vehicle)"),
  painPoints: list(10, 200).describe("what goes wrong today"),
  /** Report keys they chose (asked by the app). */
  reports: list(30, 40),
  /** Where they want them: dashboard, module, email_daily, email_weekly. */
  reportPlaces: list(5, 20),
  /** Anything they asked to see that isn't a standard report, in their words. */
  reportWishes: list(10, 200).describe("numbers or reports they said they want to see, in their words"),
  reportsConfirmed: z.boolean().optional(),
});
export type BusinessProfile = z.infer<typeof BusinessProfile>;
type ListKey = { [K in keyof BusinessProfile]-?: NonNullable<BusinessProfile[K]> extends string[] ? K : never }[keyof BusinessProfile];

/** What one model turn may add: the same fields, plus list items to take out. */
export const ProfileUpdate = BusinessProfile.omit({ taxConfirmed: true, reports: true, reportPlaces: true, reportsConfirmed: true }).extend({
  remove: z.array(z.string().max(160)).max(20).optional().describe("list items the person said are wrong, exactly as they appear in the profile"),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

/** Enough to design a sensible first setup. */
export function profileReady(p: BusinessProfile): boolean {
  return Boolean(p.businessName && p.whatTheyDo && (p.products?.length ?? 0) > 0 && (p.customers?.length ?? 0) > 0 && p.makesThings !== undefined && p.country && p.teamSize);
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Merge an update into a profile. Text and facts: the update wins when it
 * says something. Lists: new items are added (so a partial answer never
 * loses earlier ones) and `remove` takes items out.
 */
export function mergeProfile(a: BusinessProfile, b: Partial<BusinessProfile> & { remove?: string[] }): BusinessProfile {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k === "remove" || v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      // Answers to the app's own questions replace what was there; other lists grow.
      if (k === "taxRegistrations" || k === "reports" || k === "reportPlaces") {
        out[k] = v;
        continue;
      }
      if (!v.length) continue;
      const cur = (out[k] as string[] | undefined) ?? [];
      out[k] = [...cur, ...v.filter((x: string) => x.trim() && !cur.some((c) => same(c, x)))];
      continue;
    }
    out[k] = v;
  }
  for (const r of b.remove ?? []) {
    for (const [k, v] of Object.entries(out)) if (Array.isArray(v) && k !== "taxRegistrations") out[k] = v.filter((x: string) => !same(x, r));
  }
  return clamp(out);
}

/** Trim lists and text that run over their limits rather than failing on a long answer. */
function clamp(out: Record<string, unknown>): BusinessProfile {
  const r = BusinessProfile.safeParse(out);
  if (r.success) return r.data;
  for (const i of r.error.issues) {
    if (i.code !== "too_big") {
      delete out[String(i.path[0])];
      continue;
    }
    const [k, idx] = i.path as [string, number | undefined];
    const max = Number(i.maximum);
    const v = out[k];
    if (Array.isArray(v) && idx === undefined) out[k] = v.slice(0, max);
    else if (Array.isArray(v) && typeof idx === "number") v[idx] = String(v[idx]).slice(0, max);
    else if (typeof v === "string") out[k] = v.slice(0, max);
  }
  return BusinessProfile.parse(out);
}

/* ------------------------------------------------------- derived facts */

export interface Derived {
  size?: SizeClass;
  tax: TaxDecision;
  countryName?: string;
}

/** What code concludes from the facts: size class and taxes. */
export function derive(p: BusinessProfile): Derived {
  return {
    size: sizeClass(p.teamSize, p.turnover),
    countryName: p.country ? COUNTRY_BY_CODE.get(p.country)?.name : undefined,
    tax: decideTax({ country: p.country, turnover: p.turnover, registrations: p.taxConfirmed || p.taxRegistrations?.length ? (p.taxRegistrations ?? []) : undefined, deductsWht: p.taxRegistrations?.includes("wht") }),
  };
}

/* ----------------------------------------------- sections and progress */

export interface Section {
  key: "basics" | "size" | "selling" | "buying" | "making" | "people" | "paperwork" | "reports";
  label: string;
  fields: (keyof BusinessProfile)[];
  /** Fields that count towards "done" for this section. */
  needs: (keyof BusinessProfile)[];
}

export const SECTIONS: readonly Section[] = [
  { key: "basics", label: "Basics", fields: ["businessName", "whatTheyDo", "city"], needs: ["businessName", "whatTheyDo"] },
  { key: "size", label: "Size and tax", fields: ["country", "teamSize", "turnover", "taxRegistrations"], needs: ["country", "teamSize", "turnover", "taxConfirmed"] },
  { key: "selling", label: "Selling", fields: ["products", "customers", "salesChannels", "paymentTerms"], needs: ["products", "customers", "salesChannels"] },
  { key: "buying", label: "Buying and stock", fields: ["suppliers", "stockPractices", "locations"], needs: ["stockPractices"] },
  { key: "making", label: "Making", fields: ["makesThings", "productionSteps", "machines", "qualityChecks"], needs: ["makesThings", "productionSteps", "qualityChecks"] },
  { key: "people", label: "People", fields: ["team", "approvals"], needs: ["team"] },
  { key: "paperwork", label: "Paperwork", fields: ["documents", "thingsToTrack", "painPoints"], needs: ["documents"] },
  { key: "reports", label: "Reports", fields: ["reports", "reportPlaces", "reportWishes"], needs: ["reports", "reportPlaces"] },
];

export const FIELD_LABEL: Record<keyof BusinessProfile, string> = {
  businessName: "Name",
  whatTheyDo: "What you do",
  country: "Country",
  city: "City",
  teamSize: "Team",
  turnover: "Yearly sales",
  taxRegistrations: "Registered for",
  taxConfirmed: "Taxes confirmed",
  products: "Products",
  customers: "Customers",
  salesChannels: "How you sell",
  paymentTerms: "Payment",
  suppliers: "Suppliers",
  makesThings: "Makes products",
  productionSteps: "Steps",
  machines: "Machines",
  qualityChecks: "Quality checks",
  stockPractices: "Stock",
  locations: "Locations",
  documents: "Documents",
  team: "People",
  approvals: "Approvals",
  thingsToTrack: "Also tracked",
  painPoints: "Fixing",
  reports: "Keeping an eye on",
  reportPlaces: "Shown on",
  reportWishes: "Also wants to see",
  reportsConfirmed: "Reports chosen",
};

const filled = (p: BusinessProfile, k: keyof BusinessProfile) => {
  const v = p[k];
  if (k === "taxConfirmed") return Boolean(p.taxConfirmed || p.taxRegistrations?.length || (p.country && !COUNTRY_BY_CODE.get(p.country)?.taxRules));
  if (k === "turnover" && p.country && !COUNTRY_BY_CODE.get(p.country)?.taxRules) return true;
  return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "";
};

/** Sections that apply to this business, with how complete each is. */
export function progress(p: BusinessProfile): { key: Section["key"]; label: string; done: number; total: number }[] {
  return SECTIONS.filter((s) => s.key !== "making" || p.makesThings !== false).map((s) => {
    const needs = s.key === "making" && p.makesThings === undefined ? (["makesThings"] as const) : s.needs;
    return { key: s.key, label: s.label, done: needs.filter((k) => filled(p, k)).length, total: needs.length };
  });
}

/** A profile value in plain words. */
export function displayValue(p: BusinessProfile, k: keyof BusinessProfile): string {
  const v = p[k];
  if (v === undefined) return "";
  if (k === "country") return COUNTRY_BY_CODE.get(String(v))?.name ?? String(v);
  if (k === "teamSize") return TEAM_SIZES.find((t) => t.key === v)?.label ?? String(v);
  if (k === "turnover") return TURNOVER_BANDS.find((t) => t.key === v)?.label ?? String(v);
  if (k === "reports") return (v as string[]).map((r) => REPORT_BY_KEY.get(r)?.label ?? r).join(", ");
  if (k === "reportPlaces") return (v as string[]).map((r) => REPORT_PLACE_LABEL[r as keyof typeof REPORT_PLACE_LABEL] ?? r).join(", ");
  if (k === "taxRegistrations") return (v as string[]).length ? (v as string[]).map((t) => ({ vat: "VAT", sscl: "SSCL", wht: "Withholding tax" })[t] ?? t).join(", ") : "None";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return Array.isArray(v) ? v.join(", ") : String(v);
}

export const LIST_FIELDS = (Object.keys(BusinessProfile.shape) as (keyof BusinessProfile)[]).filter((k) => {
  const f = BusinessProfile.shape[k];
  return f.unwrap?.() instanceof z.ZodArray && !["taxRegistrations", "reports", "reportPlaces"].includes(k);
}) as ListKey[];
