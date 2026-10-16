import { z } from "zod";

/**
 * What the interview learns about a business, in the person's own terms.
 * Every list is optional so a profile can be built up a turn at a time.
 */
export const BusinessProfile = z.object({
  businessName: z.string().max(120).optional(),
  whatTheyDo: z.string().max(400).optional().describe("one or two sentences in plain words"),
  products: z.array(z.string().max(120)).max(30).optional(),
  customers: z.array(z.string().max(160)).max(10).optional().describe("who buys and how (shop counter, wholesale, online, contracts)"),
  suppliers: z.array(z.string().max(160)).max(10).optional(),
  makesThings: z.boolean().optional(),
  productionSteps: z.array(z.string().max(160)).max(20).optional(),
  machines: z.array(z.string().max(120)).max(30).optional(),
  qualityChecks: z.array(z.string().max(160)).max(20).optional(),
  stockPractices: z.array(z.string().max(160)).max(10).optional().describe("warehouses, lots, expiry, cartons, bins"),
  documents: z.array(z.string().max(120)).max(20).optional().describe("quotes, delivery notes, job cards, invoices they use today"),
  team: z.array(z.string().max(120)).max(20).optional().describe("roles of people who will use the system"),
  approvals: z.array(z.string().max(200)).max(10).optional().describe("who must approve what, with amounts"),
  thingsToTrack: z.array(z.string().max(200)).max(20).optional().describe("extra details they record (colour code, allergens, vehicle)"),
  painPoints: z.array(z.string().max(200)).max(10).optional(),
  taxes: z.array(z.string().max(80)).max(6).optional().describe("VAT, SSCL, WHT registration"),
});
export type BusinessProfile = z.infer<typeof BusinessProfile>;

/** Enough to design a sensible first setup. */
export function profileReady(p: BusinessProfile): boolean {
  return Boolean(p.businessName && p.whatTheyDo && (p.products?.length ?? 0) > 0 && (p.customers?.length ?? 0) > 0 && p.makesThings !== undefined);
}

/** Merge an update into a profile: non-empty values win, lists are replaced. */
export function mergeProfile(a: BusinessProfile, b: BusinessProfile): BusinessProfile {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return BusinessProfile.parse(out);
}
