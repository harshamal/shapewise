/**
 * Chart-of-accounts templates seeded into a new business (settings.accounting
 * .chartTemplate). Engines never post to an account by code: they post to a
 * system role ("receivables", "vat_output", "wip"), and each template maps
 * every role it supports to exactly one account. The business can rename or
 * renumber accounts freely; the role stays with the account.
 *
 * Codes: 1 assets · 2 liabilities · 3 equity · 4 income · 5 cost of sales ·
 * 6 expenses · 7 other income and expenses. Sri Lankan SME conventions.
 */

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export const SYSTEM_ROLES = [
  "cash",
  "bank",
  "receivables",
  "customer_advances",
  "payables",
  "vendor_advances",
  /** Goods received, not yet billed: the GRN credits it, the bill clears it. */
  "grni",
  "vat_output",
  "vat_input",
  "sscl_payable",
  "wht_receivable",
  "wht_payable",
  "sales",
  "service_income",
  "sales_discounts",
  "cogs",
  "inventory",
  "inventory_raw",
  "inventory_wip",
  "inventory_fg",
  "stock_adjustment",
  "scrap",
  "production_variance",
  "labour_absorbed",
  "overhead_absorbed",
  "purchases_expense",
  "bank_charges",
  "fx_gain_loss",
  "rounding",
  "fixed_assets",
  "accumulated_depreciation",
  "depreciation",
  "asset_disposal",
  "retained_earnings",
  "opening_balance_equity",
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export interface TemplateAccount {
  code: string;
  name: string;
  type: AccountType;
  subtype?: string;
  role?: SystemRole;
  /** Code of the parent group account. */
  parent?: string;
  /** A heading that can't be posted to. */
  group?: boolean;
}

export type ChartTemplateKey = "lk_services" | "lk_trading" | "lk_manufacturing";

const A = (code: string, name: string, type: AccountType, extra: Partial<TemplateAccount> = {}): TemplateAccount => ({ code, name, type, ...extra });
const G = (code: string, name: string, type: AccountType, parent?: string): TemplateAccount => ({ code, name, type, group: true, parent });

/** Accounts every business has. */
const BASE: readonly TemplateAccount[] = [
  G("1000", "Assets", "asset"),
  G("1100", "Cash and bank", "asset", "1000"),
  A("1110", "Cash in hand", "asset", { subtype: "cash", role: "cash", parent: "1100" }),
  A("1120", "Bank current account", "asset", { subtype: "bank", role: "bank", parent: "1100" }),
  G("1200", "Receivables", "asset", "1000"),
  A("1210", "Trade receivables", "asset", { subtype: "receivable", role: "receivables", parent: "1200" }),
  A("1220", "Advances to suppliers", "asset", { subtype: "prepayment", role: "vendor_advances", parent: "1200" }),
  A("1230", "WHT receivable", "asset", { subtype: "tax", role: "wht_receivable", parent: "1200" }),
  A("1240", "VAT input", "asset", { subtype: "vat_control", role: "vat_input", parent: "1200" }),
  G("1500", "Non-current assets", "asset", "1000"),
  A("1510", "Property, plant and equipment", "asset", { subtype: "fixed_asset", role: "fixed_assets", parent: "1500" }),
  A("1590", "Accumulated depreciation", "asset", { subtype: "contra_asset", role: "accumulated_depreciation", parent: "1500" }),

  G("2000", "Liabilities", "liability"),
  A("2110", "Trade payables", "liability", { subtype: "payable", role: "payables", parent: "2000" }),
  A("2120", "Customer advances", "liability", { subtype: "deferred_income", role: "customer_advances", parent: "2000" }),
  A("2130", "Goods received not billed", "liability", { subtype: "accrual", role: "grni", parent: "2000" }),
  A("2210", "VAT output", "liability", { subtype: "vat_control", role: "vat_output", parent: "2000" }),
  A("2220", "SSCL payable", "liability", { subtype: "tax", role: "sscl_payable", parent: "2000" }),
  A("2230", "WHT payable", "liability", { subtype: "tax", role: "wht_payable", parent: "2000" }),

  G("3000", "Equity", "equity"),
  A("3100", "Stated capital", "equity", { subtype: "capital", parent: "3000" }),
  A("3200", "Retained earnings", "equity", { subtype: "retained_earnings", role: "retained_earnings", parent: "3000" }),
  A("3900", "Opening balance equity", "equity", { subtype: "opening", role: "opening_balance_equity", parent: "3000" }),

  G("4000", "Income", "income"),
  A("4900", "Discounts allowed", "income", { subtype: "contra_income", role: "sales_discounts", parent: "4000" }),

  G("6000", "Expenses", "expense"),
  A("6100", "Salaries and wages", "expense", { parent: "6000" }),
  A("6200", "Rent", "expense", { parent: "6000" }),
  A("6300", "Electricity and water", "expense", { parent: "6000" }),
  A("6400", "Transport", "expense", { parent: "6000" }),
  A("6500", "Repairs and maintenance", "expense", { parent: "6000" }),
  A("6600", "Bank charges", "expense", { role: "bank_charges", parent: "6000" }),
  A("6700", "Depreciation", "expense", { role: "depreciation", parent: "6000" }),
  A("6900", "General expenses", "expense", { role: "purchases_expense", parent: "6000" }),

  G("7000", "Other income and expenses", "expense"),
  A("7100", "Exchange gain or loss", "expense", { role: "fx_gain_loss", parent: "7000" }),
  A("7200", "Gain or loss on asset disposal", "expense", { role: "asset_disposal", parent: "7000" }),
  A("7900", "Rounding", "expense", { role: "rounding", parent: "7000" }),
];

const TRADING: readonly TemplateAccount[] = [
  A("1300", "Inventory", "asset", { subtype: "inventory", role: "inventory", parent: "1000" }),
  A("4100", "Sales", "income", { subtype: "sales", role: "sales", parent: "4000" }),
  A("4200", "Service income", "income", { subtype: "sales", role: "service_income", parent: "4000" }),
  G("5000", "Cost of sales", "expense"),
  A("5100", "Cost of goods sold", "expense", { subtype: "cogs", role: "cogs", parent: "5000" }),
  A("5200", "Stock adjustments", "expense", { subtype: "cogs", role: "stock_adjustment", parent: "5000" }),
];

const MANUFACTURING: readonly TemplateAccount[] = [
  G("1300", "Inventory", "asset", "1000"),
  A("1310", "Raw materials and packaging", "asset", { subtype: "inventory", role: "inventory_raw", parent: "1300" }),
  A("1320", "Work in progress", "asset", { subtype: "inventory", role: "inventory_wip", parent: "1300" }),
  A("1330", "Finished goods", "asset", { subtype: "inventory", role: "inventory_fg", parent: "1300" }),
  A("1340", "Trading goods", "asset", { subtype: "inventory", role: "inventory", parent: "1300" }),
  A("4100", "Sales", "income", { subtype: "sales", role: "sales", parent: "4000" }),
  A("4200", "Service income", "income", { subtype: "sales", role: "service_income", parent: "4000" }),
  G("5000", "Cost of sales", "expense"),
  A("5100", "Cost of goods sold", "expense", { subtype: "cogs", role: "cogs", parent: "5000" }),
  A("5200", "Stock adjustments", "expense", { subtype: "cogs", role: "stock_adjustment", parent: "5000" }),
  // SyncBooks posts manufacturing scrap to 5300.
  A("5300", "Manufacturing scrap", "expense", { subtype: "cogs", role: "scrap", parent: "5000" }),
  A("5400", "Production variance", "expense", { subtype: "cogs", role: "production_variance", parent: "5000" }),
  A("5500", "Direct labour absorbed", "expense", { subtype: "cogs", role: "labour_absorbed", parent: "5000" }),
  A("5600", "Production overhead absorbed", "expense", { subtype: "cogs", role: "overhead_absorbed", parent: "5000" }),
];

const SERVICES: readonly TemplateAccount[] = [
  A("4100", "Sales", "income", { subtype: "sales", role: "sales", parent: "4000" }),
  A("4200", "Service income", "income", { subtype: "sales", role: "service_income", parent: "4000" }),
  G("5000", "Cost of sales", "expense"),
  A("5100", "Cost of goods sold", "expense", { subtype: "cogs", role: "cogs", parent: "5000" }),
];

export const CHART_TEMPLATES: Readonly<Record<ChartTemplateKey, { label: string; accounts: readonly TemplateAccount[] }>> = {
  lk_services: { label: "Services", accounts: sortByCode([...BASE, ...SERVICES]) },
  lk_trading: { label: "Trading and distribution", accounts: sortByCode([...BASE, ...TRADING]) },
  lk_manufacturing: { label: "Manufacturing", accounts: sortByCode([...BASE, ...MANUFACTURING]) },
};

/** Roles each kind of business needs before its engines can post. */
export function requiredRoles(opts: { inventory: boolean; production: boolean; tax: { vat: boolean; sscl: boolean; wht: boolean } }): SystemRole[] {
  const roles: SystemRole[] = [
    "cash", "bank", "receivables", "customer_advances", "payables", "vendor_advances", "sales", "service_income", "sales_discounts",
    "bank_charges", "fx_gain_loss", "rounding", "fixed_assets", "accumulated_depreciation", "depreciation", "asset_disposal",
    "retained_earnings", "opening_balance_equity", "purchases_expense", "cogs",
  ];
  if (opts.inventory) roles.push("grni", "stock_adjustment");
  if (opts.inventory && !opts.production) roles.push("inventory");
  if (opts.production) roles.push("inventory_raw", "inventory_wip", "inventory_fg", "scrap", "production_variance", "labour_absorbed", "overhead_absorbed");
  if (opts.tax.vat) roles.push("vat_output", "vat_input");
  if (opts.tax.sscl) roles.push("sscl_payable");
  if (opts.tax.wht) roles.push("wht_receivable", "wht_payable");
  return roles;
}

/** The account a role posts to in a template. */
export function accountForRole(template: ChartTemplateKey, role: SystemRole): TemplateAccount | undefined {
  return CHART_TEMPLATES[template].accounts.find((a) => a.role === role);
}

function sortByCode(accounts: TemplateAccount[]): TemplateAccount[] {
  return accounts.sort((a, b) => a.code.localeCompare(b.code));
}
