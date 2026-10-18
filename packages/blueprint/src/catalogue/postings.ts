import type { SystemRole } from "./accounts";
import type { CoreRecordKey } from "./records";

/**
 * What each document does to stock and to the accounts when an action
 * completes it: the specification the inventory and accounting engines
 * implement, and what the setup screens draw. Accounts are system roles, so
 * it holds for any chart of accounts.
 *
 * Lines marked `when` only apply if the business is registered for that tax.
 */

/** Which store a movement touches. "goods" is the general store for traders; makers split raw, work in progress and finished. */
export type StockPlace = "raw" | "wip" | "finished" | "goods" | "quarantine";

export interface StockMove {
  /** Stock coming in, going out, or moving between places. */
  dir: "in" | "out" | "move" | "adjust";
  place: StockPlace;
  /** For moves: where it goes. */
  to?: StockPlace;
}

export interface LedgerLine {
  role: SystemRole;
  side: "debit" | "credit";
  when?: "vat" | "wht";
}

export interface Posting {
  record: CoreRecordKey;
  action: string;
  /** In plain words, e.g. "Goods leave the store". */
  says: string;
  stock?: StockMove[];
  ledger?: LedgerLine[];
}

const D = (role: SystemRole, when?: LedgerLine["when"]): LedgerLine => ({ role, side: "debit", when });
const C = (role: SystemRole, when?: LedgerLine["when"]): LedgerLine => ({ role, side: "credit", when });

export const POSTINGS: readonly Posting[] = [
  /* selling */
  { record: "delivery_note", action: "dispatch", says: "Goods leave the store and their cost moves to cost of sales", stock: [{ dir: "out", place: "finished" }], ledger: [D("cogs"), C("inventory_fg")] },
  { record: "invoice", action: "post", says: "The customer owes you the total", ledger: [D("receivables"), C("sales"), C("vat_output", "vat")] },
  { record: "receipt", action: "post", says: "Money comes into the bank and the customer owes less", ledger: [D("bank"), D("wht_receivable", "wht"), C("receivables")] },
  { record: "credit_note", action: "post", says: "Returned goods come back and the customer owes less", stock: [{ dir: "in", place: "finished" }], ledger: [D("sales"), D("vat_output", "vat"), C("receivables"), D("inventory_fg"), C("cogs")] },
  { record: "pos_sale", action: "refund", says: "A counter sale is refunded and the goods come back", stock: [{ dir: "in", place: "finished" }], ledger: [D("sales"), D("vat_output", "vat"), C("cash")] },
  { record: "pos_shift", action: "close", says: "The shift's takings go to the books", ledger: [D("cash"), C("sales"), C("vat_output", "vat")] },
  { record: "cheque", action: "realise", says: "A cheque clears into the bank", ledger: [D("bank"), C("receivables")] },

  /* buying */
  { record: "goods_receipt", action: "post", says: "Goods come into the store, owed to the supplier until billed", stock: [{ dir: "in", place: "raw" }], ledger: [D("inventory_raw"), C("grni")] },
  { record: "bill", action: "post", says: "You owe the supplier the total", ledger: [D("grni"), D("vat_input", "vat"), C("payables")] },
  { record: "payment", action: "post", says: "Money leaves the bank and you owe the supplier less", ledger: [D("payables"), C("bank"), C("wht_payable", "wht")] },
  { record: "vendor_credit", action: "post", says: "Goods go back to the supplier and you owe less", stock: [{ dir: "out", place: "raw" }], ledger: [D("payables"), C("inventory_raw"), C("vat_input", "vat")] },
  { record: "vendor_advance", action: "post", says: "An advance is paid before the goods arrive", ledger: [D("vendor_advances"), C("bank")] },
  { record: "expense", action: "post", says: "A cost is paid straight from the bank", ledger: [D("purchases_expense"), D("vat_input", "vat"), C("bank")] },

  /* stock */
  { record: "stock_adjustment", action: "post", says: "Counted stock is corrected and the difference is costed", stock: [{ dir: "adjust", place: "goods" }], ledger: [D("stock_adjustment"), C("inventory")] },
  { record: "stock_transfer", action: "send", says: "Stock moves between stores", stock: [{ dir: "move", place: "goods", to: "goods" }] },
  { record: "inspection", action: "pass", says: "Received goods pass inspection and become usable", stock: [{ dir: "move", place: "quarantine", to: "raw" }] },

  /* making */
  { record: "batch", action: "issue_materials", says: "Materials leave the store for production", stock: [{ dir: "move", place: "raw", to: "wip" }], ledger: [D("inventory_wip"), C("inventory_raw")] },
  { record: "batch", action: "finish", says: "Finished goods come off the line, with labour and overheads added", stock: [{ dir: "move", place: "wip", to: "quarantine" }], ledger: [D("inventory_fg"), C("inventory_wip"), C("labour_absorbed"), C("overhead_absorbed")] },
  { record: "batch", action: "release", says: "Quality approves the batch and it can be sold", stock: [{ dir: "move", place: "quarantine", to: "finished" }] },
  { record: "batch", action: "reject", says: "A rejected batch is written off as scrap", stock: [{ dir: "out", place: "quarantine" }], ledger: [D("scrap"), C("inventory_fg")] },
  { record: "ncr", action: "close", says: "Nonconforming stock is written off", stock: [{ dir: "out", place: "quarantine" }], ledger: [D("scrap"), C("inventory")] },

  /* accounts */
  { record: "journal", action: "post", says: "Any accounts you choose, debits equal to credits" },
  { record: "fixed_asset", action: "dispose", says: "An asset leaves the books with its depreciation", ledger: [D("accumulated_depreciation"), D("asset_disposal"), C("fixed_assets")] },
  { record: "vat_return", action: "finalise", says: "VAT collected and paid are settled for the period", ledger: [D("vat_output"), C("vat_input")] },
  { record: "vat_return", action: "pay", says: "The VAT due is paid to the Inland Revenue", ledger: [D("vat_output"), C("bank")] },
];

/** Account roles grouped the way an owner thinks about them. */
export const ACCOUNT_GROUPS: readonly { key: string; label: string; roles: readonly SystemRole[] }[] = [
  { key: "receivables", label: "Customers owe you", roles: ["receivables", "customer_advances"] },
  { key: "payables", label: "You owe suppliers", roles: ["payables", "vendor_advances", "grni"] },
  { key: "bank", label: "Bank and cash", roles: ["bank", "cash", "bank_charges"] },
  { key: "trading", label: "Sales and costs", roles: ["sales", "service_income", "sales_discounts", "cogs"] },
  { key: "stock", label: "Stock value", roles: ["inventory", "inventory_raw", "inventory_wip", "inventory_fg", "stock_adjustment", "scrap", "production_variance", "labour_absorbed", "overhead_absorbed"] },
  { key: "tax", label: "Taxes", roles: ["vat_output", "vat_input", "cgst_output", "cgst_input", "sgst_output", "sgst_input", "sscl_payable", "wht_receivable", "wht_payable"] },
  { key: "other", label: "Expenses, assets", roles: ["purchases_expense", "fixed_assets", "accumulated_depreciation", "depreciation", "asset_disposal", "fx_gain_loss", "rounding", "retained_earnings", "opening_balance_equity"] },
];

export const ROLE_LABEL: Partial<Record<SystemRole, string>> = {
  receivables: "Receivables",
  customer_advances: "Customer advances",
  payables: "Payables",
  vendor_advances: "Supplier advances",
  grni: "Goods not yet billed",
  bank: "Bank",
  cash: "Cash",
  sales: "Sales",
  service_income: "Service income",
  cogs: "Cost of sales",
  inventory: "Stock",
  inventory_raw: "Raw materials",
  inventory_wip: "Work in progress",
  inventory_fg: "Finished goods",
  stock_adjustment: "Stock adjustments",
  scrap: "Scrap",
  labour_absorbed: "Labour absorbed",
  overhead_absorbed: "Overheads absorbed",
  vat_output: "VAT collected",
  vat_input: "VAT paid",
  wht_receivable: "WHT deducted by customers",
  wht_payable: "WHT to pay over",
  purchases_expense: "Expenses",
  fixed_assets: "Fixed assets",
  accumulated_depreciation: "Accumulated depreciation",
  asset_disposal: "Disposals",
};
