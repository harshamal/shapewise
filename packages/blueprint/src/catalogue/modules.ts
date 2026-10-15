import { A, type PermAction } from "./actions";
import type { CoreRecordKey } from "./records";
import type { ExtensionKey } from "./extensions";

/**
 * Sections → modules → submodules, as in SyncBooks. A submodule is the unit
 * of navigation, permissions and plan or extension gating. Some submodules
 * list a core record (Invoices); others are pages (Trial balance, Capacity).
 *
 * A blueprint turns modules and submodules on or off, renames and reorders
 * them, and adds custom submodules (custom record types) to any module. It
 * cannot remove `core` submodules from an enabled module.
 */

export const SECTIONS = [
  { key: "workspace", label: "Workspace" },
  { key: "operations", label: "Operations" },
  { key: "finance", label: "Finance" },
  { key: "governance", label: "Governance" },
  { key: "admin", label: "Settings" },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];

export type SubmoduleKind =
  /** A list of a core record type, with detail and form screens. */
  | "records"
  /** A purpose-built page (stock on hand, trial balance, capacity board). */
  | "page"
  /** Read-only reports and analytics. */
  | "report"
  /** A settings screen. */
  | "settings";

export interface Submodule {
  key: string;
  label: string;
  kind: SubmoduleKind;
  /** For kind "records". */
  record?: CoreRecordKey;
  actions: readonly PermAction[];
  /** Always on while its module is on. */
  core?: boolean;
  /** On by default when its module is switched on. */
  default?: boolean;
  /** Only available while this extension is on. */
  extension?: ExtensionKey;
}

export interface Module {
  key: string;
  label: string;
  section: SectionKey;
  icon: string;
  /** Cannot be switched off. */
  core?: boolean;
  submodules: readonly Submodule[];
}

const rec = (key: string, label: string, record: CoreRecordKey, actions: readonly PermAction[], extra: Partial<Submodule> = {}): Submodule => ({
  key, label, kind: "records", record, actions, default: true, ...extra,
});
const page = (key: string, label: string, actions: readonly PermAction[] = A.readOnly, extra: Partial<Submodule> = {}): Submodule => ({
  key, label, kind: "page", actions, default: true, ...extra,
});
const report = (key: string, label: string, extra: Partial<Submodule> = {}): Submodule => ({
  key, label, kind: "report", actions: A.readOnly, default: true, ...extra,
});
const settings = (key: string, label: string, actions: readonly PermAction[] = ["view", "manage"], extra: Partial<Submodule> = {}): Submodule => ({
  key, label, kind: "settings", actions, default: true, ...extra,
});

export const MODULES: readonly Module[] = [
  {
    key: "overview", label: "Overview", section: "workspace", icon: "layout-dashboard", core: true,
    submodules: [page("dashboard", "Dashboard", A.readOnly, { core: true })],
  },
  {
    key: "sales", label: "Sales", section: "operations", icon: "receipt",
    submodules: [
      rec("customers", "Customers", "customer", A.master, { core: true }),
      rec("quotes", "Quotes", "quote", A.draftOnly),
      rec("sales_orders", "Sales orders", "sales_order", A.draftOnly),
      rec("delivery_notes", "Delivery notes", "delivery_note", A.posting),
      rec("invoices", "Invoices", "invoice", A.posting, { core: true }),
      rec("receipts", "Payments received", "receipt", A.posting, { core: true }),
      rec("credit_notes", "Credit notes", "credit_note", A.posting),
      rec("recurring_invoices", "Recurring invoices", "recurring_invoice", A.master, { extension: "recurring", default: false }),
      report("statements", "Customer statements"),
      rec("salespersons", "Salespersons", "salesperson", A.master, { default: false }),
      report("sales_analytics", "Sales analytics"),
    ],
  },
  {
    key: "pos", label: "Point of sale", section: "operations", icon: "shopping-cart",
    submodules: [
      page("pos_terminal", "Terminal", ["view", "create", "void", "manage"], { core: true }),
      rec("pos_sales", "POS sales", "pos_sale", ["view", "void", "manage"]),
      rec("pos_shifts", "Shifts", "pos_shift", ["view", "create", "manage"]),
      report("pos_analytics", "POS analytics"),
    ],
  },
  {
    key: "purchases", label: "Purchases", section: "operations", icon: "shopping-bag",
    submodules: [
      rec("vendors", "Vendors", "vendor", A.master, { core: true }),
      rec("supplier_qualification", "Supplier qualification", "supplier_certificate", A.master, { extension: "supplier_qualification", default: false }),
      rec("purchase_orders", "Purchase orders", "purchase_order", A.draftOnly),
      rec("goods_receipts", "Goods received", "goods_receipt", A.posting),
      rec("bills", "Bills", "bill", A.posting, { core: true }),
      page("three_way_match", "Three-way match", A.readOnly, { extension: "three_way_match", default: false }),
      rec("payments_made", "Payments made", "payment", A.posting, { core: true }),
      rec("vendor_credits", "Vendor credits", "vendor_credit", A.posting),
      rec("vendor_advances", "Vendor advances", "vendor_advance", ["view", "create", "edit", "post", "void", "manage"], { default: false }),
      rec("expenses", "Expenses", "expense", A.posting),
      rec("recurring_bills", "Recurring bills", "recurring_bill", A.master, { extension: "recurring", default: false }),
      report("purchase_analytics", "Purchase analytics"),
    ],
  },
  {
    key: "inventory", label: "Inventory", section: "operations", icon: "boxes",
    submodules: [
      rec("items", "Items", "item", A.master, { core: true }),
      page("stock", "Stock on hand", A.readOnly, { core: true }),
      rec("lots", "Lots and expiry", "lot", ["view", "approve", "manage"], { extension: "lots", default: false }),
      page("reorder", "Reorder suggestions", ["view", "manage"], { extension: "reorder_suggestions", default: false }),
      rec("warehouses", "Warehouses", "warehouse", A.master),
      rec("stock_adjustments", "Stock adjustments", "stock_adjustment", ["view", "create", "approve", "post", "void", "manage"]),
      rec("stock_transfers", "Stock transfers", "stock_transfer", A.posting),
      rec("price_lists", "Price lists", "price_list", A.master, { extension: "price_lists", default: false }),
      report("inventory_analytics", "Inventory analytics"),
    ],
  },
  {
    key: "production", label: "Production", section: "operations", icon: "factory",
    submodules: [
      page("production_overview", "Floor", A.readOnly, { core: true }),
      rec("recipes", "Recipes", "recipe", ["view", "create", "edit", "approve", "manage"], { core: true }),
      rec("production_orders", "Production orders", "production_order", A.draftOnly, { core: true }),
      rec("batches", "Batches", "batch", ["view", "create", "edit", "approve", "void", "manage"], { core: true }),
      page("production_qc", "Quality control", ["view", "approve"]),
      rec("incoming_inspection", "Incoming inspection", "inspection", ["view", "approve"], { extension: "incoming_qc", default: false }),
      rec("ncr", "Non-conformance", "ncr", ["view", "create", "edit", "approve", "void"], { extension: "ncr", default: false }),
      rec("artwork", "Artwork", "artwork", ["view", "create", "edit", "approve"], { extension: "artwork", default: false }),
      rec("resources", "Machines and resources", "resource", A.master),
      page("capacity", "Capacity", A.readOnly, { extension: "capacity", default: false }),
      page("traceability", "Traceability"),
      report("production_reports", "Operations reports", { extension: "ops_reports", default: false }),
    ],
  },
  {
    key: "banking", label: "Banking", section: "finance", icon: "landmark",
    submodules: [
      rec("bank_accounts", "Bank and cash", "bank_account", A.master, { core: true }),
      page("bank_rules", "Bank rules", A.master),
      rec("cheques", "Cheques", "cheque", ["view", "create", "edit", "post", "void", "manage"]),
    ],
  },
  {
    key: "accounting", label: "Accounting", section: "finance", icon: "book-open", core: true,
    submodules: [
      rec("chart_of_accounts", "Chart of accounts", "account", A.master, { core: true }),
      rec("manual_journals", "Manual journals", "journal", ["view", "create", "approve", "post", "void", "manage"], { core: true }),
      rec("recurring_journals", "Recurring journals", "recurring_journal", A.master, { extension: "recurring", default: false }),
      report("general_ledger", "General ledger", { core: true }),
      report("trial_balance", "Trial balance", { core: true }),
      report("financial_statements", "Financial statements", { core: true }),
      rec("budgets", "Budgets", "budget", A.master, { default: false }),
      rec("fixed_assets", "Fixed assets", "fixed_asset", ["view", "create", "edit", "post", "void", "manage"], { default: false }),
      page("book_close", "Book close", ["view", "manage"]),
    ],
  },
  {
    key: "tax", label: "Tax", section: "finance", icon: "percent",
    submodules: [
      rec("vat_returns", "VAT returns", "vat_return", ["view", "file", "manage"]),
      rec("wht_certificates", "WHT certificates", "wht_certificate", A.readOnly),
      rec("tax_rates", "Tax rates", "tax_code", A.master, { core: true }),
    ],
  },
  {
    key: "reports", label: "Reports", section: "finance", icon: "chart-column",
    submodules: [report("reports", "All reports", { core: true })],
  },
  {
    key: "governance", label: "Governance", section: "governance", icon: "shield-check", core: true,
    submodules: [
      page("approvals", "Approvals", A.readOnly, { core: true }),
      page("change_studio", "System changes", ["view", "create", "approve"], { core: true }),
      page("audit_log", "Audit log", A.readOnly, { core: true }),
    ],
  },
  {
    key: "settings", label: "Settings", section: "admin", icon: "settings", core: true,
    submodules: [
      settings("organisation", "Organisation and branding", ["view", "manage"], { core: true }),
      settings("users", "Team and users", ["view", "manage"], { core: true }),
      settings("roles", "Roles and permissions", ["view", "manage"], { core: true }),
      settings("extensions", "Extensions", ["view", "manage"], { core: true }),
      settings("custom_fields", "Custom fields", ["view", "manage"], { extension: "custom_fields", default: false }),
      settings("approval_rules", "Approval rules", ["view", "manage"], { core: true }),
      settings("numbering", "Numbering", ["view", "manage"], { core: true }),
      settings("document_rules", "Sales and purchasing", ["view", "manage"], { core: true }),
      settings("tax_settings", "Tax", ["view", "manage"], { core: true }),
      settings("inventory_rules", "Inventory rules", ["view", "manage"]),
      settings("units", "Units of measure", A.master),
      settings("item_classes", "Item classes", A.master),
      settings("production_setup", "Production setup", A.master),
      settings("agents", "Agents and MCP", ["view", "manage"], { core: true }),
    ],
  },
];

export const MODULE_BY_KEY: ReadonlyMap<string, Module> = new Map(MODULES.map((m) => [m.key, m]));

export const SUBMODULE_BY_KEY: ReadonlyMap<string, Submodule & { module: string }> = new Map(
  MODULES.flatMap((m) => m.submodules.map((s) => [s.key, { ...s, module: m.key }] as const)),
);

/** The submodule that lists a core record (records → invoices). */
export const SUBMODULE_FOR_RECORD: ReadonlyMap<CoreRecordKey, string> = new Map(
  MODULES.flatMap((m) => m.submodules.filter((s) => s.record).map((s) => [s.record!, s.key] as const)),
);

/** Settings screens that only make sense when another module is on. */
export const SUBMODULE_NEEDS_MODULE: Readonly<Record<string, string>> = {
  production_setup: "production",
  inventory_rules: "inventory",
  units: "inventory",
  item_classes: "inventory",
};
