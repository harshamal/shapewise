import type { ExtensionKey } from "./extensions";

/**
 * Every report Shapewise offers, described by the question it answers so an
 * owner can pick what they need without knowing report names. Each says what
 * it needs (modules, features, a tax registration) and, when it has a single
 * headline number, which dashboard tile shows it.
 *
 * The blueprint records which reports a business uses and where each one
 * appears (`Blueprint.reports`); the reports themselves are fixed engines.
 */

export const REPORT_CATEGORIES = ["sales", "purchases", "stock", "production", "accounts", "tax"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  sales: "Sales and customers",
  purchases: "Buying and suppliers",
  stock: "Stock",
  production: "Production and quality",
  accounts: "Money and accounts",
  tax: "Tax",
};

/** Where a report appears: the home dashboard (its headline number), its module's page, the Reports list, or a summary by email. */
export const REPORT_PLACES = ["dashboard", "module", "reports", "email_daily", "email_weekly"] as const;
export type ReportPlace = (typeof REPORT_PLACES)[number];

export const REPORT_PLACE_LABEL: Record<ReportPlace, string> = {
  dashboard: "Home dashboard",
  module: "Its module's page",
  reports: "Reports",
  email_daily: "Morning email",
  email_weekly: "Weekly email",
};

export interface ReportDef {
  key: string;
  label: string;
  /** The question it answers, as the owner would ask it. */
  asks: string;
  category: ReportCategory;
  /** The module whose page it can sit on. */
  module: string;
  needs?: { modules?: string[]; extensions?: ExtensionKey[]; tax?: "vat" | "wht" | "sscl" };
  /** Where its numbers come from: documents now, or the stock and ledger engines. */
  source: "records" | "stock" | "ledger";
  /** Builtin dashboard metric for its headline number. */
  metric?: string;
}

export const REPORTS = [
  /* sales */
  { key: "sales_summary", label: "Sales summary", asks: "How much did we sell this month?", category: "sales", module: "sales", source: "records", metric: "sales_this_month" },
  { key: "sales_by_customer", label: "Sales by customer", asks: "Who are my best customers?", category: "sales", module: "sales", source: "records", metric: "top_customers" },
  { key: "sales_by_item", label: "Sales by product", asks: "What sells most?", category: "sales", module: "sales", source: "records", metric: "top_products" },
  { key: "sales_by_salesperson", label: "Sales by salesperson", asks: "How is each salesperson doing?", category: "sales", module: "sales", source: "records" },
  { key: "sales_trend", label: "Sales trend", asks: "Are sales going up or down?", category: "sales", module: "sales", source: "records" },
  { key: "gross_margin", label: "Gross margin by product", asks: "Which products make me money?", category: "sales", module: "sales", source: "ledger" },
  { key: "open_orders", label: "Orders to deliver", asks: "What do I still have to deliver?", category: "sales", module: "sales", source: "records", metric: "orders_due_this_week" },
  { key: "aged_receivables", label: "Aged receivables", asks: "Who owes me money and how late?", category: "sales", module: "sales", source: "records", metric: "receivables_overdue" },
  { key: "daily_takings", label: "Daily takings", asks: "How much came in at the counter today?", category: "sales", module: "pos", needs: { modules: ["pos"] }, source: "records" },
  /* purchases */
  { key: "purchases_by_vendor", label: "Purchases by supplier", asks: "Who do I buy the most from?", category: "purchases", module: "purchases", source: "records" },
  { key: "aged_payables", label: "Aged payables", asks: "What do I owe, and when is it due?", category: "purchases", module: "purchases", source: "records", metric: "payables_due" },
  { key: "open_purchase_orders", label: "Orders not yet received", asks: "What am I still waiting for from suppliers?", category: "purchases", module: "purchases", source: "records" },
  { key: "expense_summary", label: "Expenses by type", asks: "Where is my money going?", category: "purchases", module: "purchases", source: "records" },
  /* stock */
  { key: "stock_on_hand", label: "Stock on hand", asks: "What do I have in stock?", category: "stock", module: "inventory", source: "stock" },
  { key: "stock_valuation", label: "Stock value", asks: "What is my stock worth?", category: "stock", module: "inventory", source: "stock", metric: "stock_value" },
  { key: "reorder", label: "Running low", asks: "What should I reorder?", category: "stock", module: "inventory", source: "stock", metric: "stock_below_reorder" },
  { key: "slow_moving", label: "Slow moving stock", asks: "What is sitting on the shelf?", category: "stock", module: "inventory", source: "stock" },
  { key: "expiry", label: "Expiring soon", asks: "What is about to expire?", category: "stock", module: "inventory", needs: { extensions: ["lots"] }, source: "stock", metric: "lots_expiring" },
  { key: "stock_movement", label: "Stock movement", asks: "What came in and went out?", category: "stock", module: "inventory", source: "stock" },
  /* production */
  { key: "production_status", label: "Jobs in progress", asks: "What is on the floor right now?", category: "production", module: "production", needs: { modules: ["production"] }, source: "records", metric: "jobs_in_progress" },
  { key: "late_jobs", label: "Late jobs", asks: "Which jobs are running late?", category: "production", module: "production", needs: { modules: ["production"] }, source: "records", metric: "jobs_late" },
  { key: "yield", label: "Yield", asks: "How much good output do I get from materials?", category: "production", module: "production", needs: { modules: ["production"] }, source: "records", metric: "yield_pct" },
  { key: "scrap_by_machine", label: "Scrap by machine", asks: "Which machines waste the most?", category: "production", module: "production", needs: { modules: ["production"] }, source: "records", metric: "scrap_pct_by_machine" },
  { key: "batch_cost", label: "Batch cost", asks: "What did each batch really cost?", category: "production", module: "production", needs: { modules: ["production"] }, source: "ledger" },
  { key: "qc_failures", label: "Quality failures", asks: "What is failing quality checks?", category: "production", module: "production", needs: { modules: ["production"] }, source: "records", metric: "qc_failures" },
  { key: "capacity", label: "Machine load", asks: "Are my machines over or under booked?", category: "production", module: "production", needs: { extensions: ["capacity"] }, source: "records", metric: "capacity_load" },
  /* accounts */
  { key: "profit_and_loss", label: "Profit and loss", asks: "Am I making a profit?", category: "accounts", module: "accounting", source: "ledger" },
  { key: "cash_position", label: "Cash position", asks: "How much cash do I have?", category: "accounts", module: "banking", source: "ledger", metric: "cash_position" },
  { key: "cash_flow", label: "Cash flow", asks: "Where did cash come from and go?", category: "accounts", module: "accounting", source: "ledger" },
  { key: "balance_sheet", label: "Balance sheet", asks: "What do I own and owe?", category: "accounts", module: "accounting", source: "ledger" },
  { key: "budget_vs_actual", label: "Budget against actual", asks: "Am I within budget?", category: "accounts", module: "accounting", source: "ledger" },
  { key: "trial_balance", label: "Trial balance", asks: "Do the books balance?", category: "accounts", module: "accounting", source: "ledger" },
  /* tax */
  { key: "vat_summary", label: "VAT summary", asks: "How much VAT do I owe this period?", category: "tax", module: "tax", needs: { tax: "vat" }, source: "ledger" },
  { key: "wht_summary", label: "Withholding tax", asks: "What withholding tax have I deducted or suffered?", category: "tax", module: "tax", needs: { tax: "wht" }, source: "ledger" },
  { key: "sscl_summary", label: "SSCL", asks: "How much SSCL is due?", category: "tax", module: "tax", needs: { tax: "sscl" }, source: "ledger" },
] as const satisfies readonly ReportDef[];

export type ReportKey = (typeof REPORTS)[number]["key"];
export const REPORT_KEYS = REPORTS.map((r) => r.key) as unknown as readonly [ReportKey, ...ReportKey[]];
export const REPORT_BY_KEY = new Map<string, ReportDef>(REPORTS.map((r) => [r.key, r]));

/** Whether a report can be used with these modules, features and taxes. */
export function reportAvailable(r: ReportDef, ctx: { modules: ReadonlySet<string>; extensions: ReadonlySet<string>; tax: { vat: boolean; wht: boolean; sscl: boolean } }): boolean {
  if (r.needs?.modules?.some((m) => !ctx.modules.has(m))) return false;
  if (r.needs?.extensions?.some((e) => !ctx.extensions.has(e))) return false;
  if (r.needs?.tax && !ctx.tax[r.needs.tax]) return false;
  return ctx.modules.has(r.module) || r.module === "accounting";
}
