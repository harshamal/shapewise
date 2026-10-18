import {
  BUILTIN_METRICS,
  REPORTS,
  REPORT_BY_KEY,
  applyOps,
  businessTaxes,
  reportAvailable,
  taxFlags,
  taxList,
  type Blueprint,
  type OverlayOp,
  type ReportDef,
  type ReportPlace,
} from "@shapewise/blueprint";
import { derive, type BusinessProfile } from "./profile";

/**
 * Which reports a business is likely to want, and putting the chosen ones
 * where the owner asked for them. Suggestions come from what the interview
 * learned (makes things, tracks expiry, sells at a counter, has a sales team,
 * is VAT registered, its size), never from the model, so they're instant
 * and the same every time.
 */

const has = (xs: readonly string[] | undefined, re: RegExp) => (xs ?? []).some((x) => re.test(x));

/** What the business will probably use, from the interview alone (before the design exists). */
function likelyContext(p: BusinessProfile) {
  const d = derive(p);
  const counter = has(p.salesChannels, /counter|shop|walk|retail|pos/i) || has(p.customers, /walk|counter|retail/i);
  const modules = new Set(["sales", "purchases", "inventory", "accounting", "banking", "reports", "tax"]);
  if (p.makesThings) modules.add("production");
  if (counter) modules.add("pos");
  const extensions = new Set<string>();
  if (has(p.stockPractices, /expir|lot|batch|shelf/i) || has(p.thingsToTrack, /expir|lot/i)) extensions.add("lots");
  return { d, modules, extensions, counter, tax: taxFlags({ business: { country: p.country ?? "LK" }, settings: { tax: d.tax.settings } }), taxName: taxList(businessTaxes(p.country ?? "LK", d.tax.settings).registered.filter((t) => t.kind === "value_added" || t.kind === "sales")) };
}

export interface Suggestion {
  key: string;
  label: string;
  asks: string;
  why: string;
}

/** Reports to offer, most useful first, each with the reason it fits this business. */
export function suggestReports(p: BusinessProfile): Suggestion[] {
  const c = likelyContext(p);
  const picks: [string, string][] = [
    ["sales_summary", "The first number most owners check"],
    ["aged_receivables", (p.paymentTerms ?? []).some((t) => /credit|days/i.test(t)) ? "You sell on credit" : "Keeps unpaid invoices in view"],
    ["cash_position", "Cash is what keeps the doors open"],
    ...(p.makesThings ? ([["late_jobs", "You make to order, so late jobs matter"]] as [string, string][]) : []),
    ...(c.extensions.has("lots") ? ([["expiry", "You track expiry"]] as [string, string][]) : []),
    ...(c.counter ? ([["daily_takings", "You sell at a counter"]] as [string, string][]) : []),
    ["reorder", "So you never run out"],
    ["profit_and_loss", "Whether the month made money"],
    ...(p.makesThings && (p.machines?.length ?? 0) > 0 ? ([["scrap_by_machine", "You run machines"]] as [string, string][]) : []),
    ...(p.makesThings ? ([["yield", "Material in against good output"]] as [string, string][]) : []),
    ...(p.makesThings && (p.qualityChecks?.length ?? 0) > 0 ? ([["qc_failures", "You run quality checks"]] as [string, string][]) : []),
    ["aged_payables", "What you owe and when"],
    ...(has(p.team, /sales|rep/i) ? ([["sales_by_salesperson", "You have people selling"]] as [string, string][]) : []),
    ["sales_by_customer", "Who your best customers are"],
    ["sales_by_item", "What sells most"],
    ...(c.tax.vat ? ([["vat_summary", `You're ${c.taxName || "VAT"} registered`]] as [string, string][]) : []),
    ["gross_margin", "Which products make money"],
    ["stock_valuation", "What your stock is worth"],
    ...(c.d.size === "medium" || c.d.size === "large" ? ([["budget_vs_actual", "Larger businesses run to a budget"]] as [string, string][]) : []),
    ...(p.makesThings ? ([["batch_cost", "What each batch really cost"]] as [string, string][]) : []),
    ["cash_flow", "Where cash came from and went"],
    ...(c.tax.wht ? ([["wht_summary", "You deduct withholding tax"]] as [string, string][]) : []),
  ];
  const seen = new Set<string>();
  return picks.flatMap(([key, why]) => {
    const r = REPORT_BY_KEY.get(key);
    if (!r || seen.has(key) || !reportAvailable(r, c)) return [];
    seen.add(key);
    return [{ key, label: r.label, asks: r.asks, why }];
  });
}

/** Reports available in a designed setup that aren't in use yet, for "add more" lists. */
export function availableReports(bp: Blueprint): ReportDef[] {
  const ctx = {
    modules: new Set(bp.modules.filter((m) => m.enabled).map((m) => m.key)),
    extensions: new Set<string>(bp.extensions),
    tax: taxFlags(bp),
  };
  return REPORTS.filter((r) => reportAvailable(r, ctx));
}

export const PLACE_OPTIONS: { place: ReportPlace; label: string }[] = [
  { place: "dashboard", label: "Home dashboard" },
  { place: "module", label: "On each module's page" },
  { place: "email_daily", label: "A morning email" },
  { place: "email_weekly", label: "A weekly email" },
];

/**
 * The changes that put the chosen reports in place: each on the pages the
 * owner chose (always also in Reports), and the dashboard tiles replaced by
 * the chosen headline numbers. Reports the setup can't run are left out with
 * a note.
 */
export function analyticsOps(bp: Blueprint, keys: readonly string[], places: readonly ReportPlace[]): { ops: OverlayOp[]; notes: string[] } {
  const ok = new Set(availableReports(bp).map((r) => r.key));
  const notes: string[] = [];
  const ops: OverlayOp[] = [];
  const chosen = keys.filter((k) => {
    if (ok.has(k)) return true;
    const r = REPORT_BY_KEY.get(k);
    if (r) notes.push(`Left out "${r.label}": this setup doesn't have what it needs.`);
    return false;
  });
  const where = places.length ? places : (["dashboard", "module"] as ReportPlace[]);
  for (const k of chosen) {
    const r = REPORT_BY_KEY.get(k)!;
    const p = where.filter((x) => x !== "dashboard" || r.metric);
    ops.push({ op: "set_report", key: k, places: [...new Set<ReportPlace>([...p, "reports"])] });
  }
  if (where.includes("dashboard")) {
    const metrics = [...new Set(chosen.map((k) => REPORT_BY_KEY.get(k)!.metric).filter((m): m is string => Boolean(m && (BUILTIN_METRICS as readonly string[]).includes(m))))];
    if (metrics.length) {
      for (const w of bp.dashboard) ops.push({ op: "remove", id: w.id });
      metrics.slice(0, 12).forEach((metric, i) => ops.push({ op: "add", collection: "dashboard", value: { id: `wdg_${metric.replace(/[^a-z0-9]/g, "").slice(0, 20)}${i}`, size: "sm", source: { kind: "builtin", metric } } }));
    }
  }
  return { ops, notes };
}

/** Applies the chosen reports to a designed blueprint; on any problem keeps the blueprint as it was. */
export function withAnalytics(bp: Blueprint, p: BusinessProfile): { blueprint: Blueprint; notes: string[] } {
  const keys = p.reports?.length ? p.reports : suggestReports(p).slice(0, 5).map((s) => s.key);
  const places = (p.reportPlaces ?? []) as ReportPlace[];
  const { ops, notes } = analyticsOps(bp, keys, places);
  if (!ops.length) return { blueprint: bp, notes };
  const r = applyOps(bp, ops);
  if (!r.ok) return { blueprint: bp, notes: [...notes, "Reports were left as the template set them; choose them in Settings."] };
  return { blueprint: { ...r.blueprint, version: bp.version }, notes };
}
