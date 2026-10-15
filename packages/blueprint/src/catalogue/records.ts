import { z } from "zod";
import type { FieldType, Tone } from "../fields";
import type { PermAction } from "./actions";

/**
 * Core record types: the fixed-core documents and masters the engines own.
 * A blueprint can relabel them, add custom fields, put rules, approvals and
 * views on them, but it can never change their lifecycle, postings or the
 * fields the engines depend on. Shapes follow SyncBooks.
 *
 * Field keys here are stable API: expressions (`record.total`), views, tools
 * and imports refer to them.
 */

export const CORE_RECORD_KEYS = [
  // parties and masters
  "customer",
  "vendor",
  "salesperson",
  "item",
  "warehouse",
  "price_list",
  // sales
  "quote",
  "sales_order",
  "delivery_note",
  "invoice",
  "receipt",
  "credit_note",
  "recurring_invoice",
  // point of sale
  "pos_sale",
  "pos_shift",
  // purchases
  "purchase_order",
  "goods_receipt",
  "bill",
  "payment",
  "vendor_credit",
  "vendor_advance",
  "expense",
  "recurring_bill",
  "supplier_certificate",
  // inventory
  "stock_adjustment",
  "stock_transfer",
  "lot",
  // production
  "resource",
  "recipe",
  "production_order",
  "batch",
  "inspection",
  "ncr",
  "artwork",
  // banking and accounting
  "bank_account",
  "cheque",
  "account",
  "journal",
  "recurring_journal",
  "budget",
  "fixed_asset",
  // tax
  "tax_code",
  "vat_return",
  "wht_certificate",
] as const;
export const CoreRecordKey = z.enum(CORE_RECORD_KEYS);
export type CoreRecordKey = z.infer<typeof CoreRecordKey>;

export interface CoreField {
  key: string;
  label: string;
  type: FieldType;
  /** For ref fields. */
  to?: CoreRecordKey | "user";
  options?: readonly string[];
  /** Indexed for filters and sorting in every tenant. */
  indexed?: boolean;
  /** Set by the engine; never typed by a person. */
  system?: boolean;
}

export interface LifecycleState {
  key: string;
  label: string;
  tone: Tone;
}

export interface LifecycleAction {
  /** Command and tool name, e.g. "post" → post_invoice. */
  key: string;
  label: string;
  from: readonly string[];
  to: string;
  /** Permission needed on the submodule. */
  permission: PermAction;
  /** May be held for approval by an approval policy. */
  approvable?: boolean;
  /** What the engine writes when it runs. */
  effects?: readonly ("ledger" | "stock" | "numbering")[];
}

export interface Lifecycle {
  initial: string;
  states: readonly LifecycleState[];
  actions: readonly LifecycleAction[];
}

export interface CoreRecord {
  key: CoreRecordKey;
  label: string;
  labelPlural: string;
  /** Default numbering pattern; the business can change it in settings. */
  numbering?: string;
  fields: readonly CoreField[];
  lines?: { label: string; fields: readonly CoreField[] };
  lifecycle?: Lifecycle;
  /** Payment progress tracked separately from the lifecycle (unpaid → partly paid → paid, overdue). */
  paymentStatus?: boolean;
  /** Where custom fields may be added. Line fields are carried along conversions. */
  customFields: readonly ("header" | "line")[];
  /** Field holding the amount approval stages compare against. */
  amountField?: string;
  /** Can be turned into another record (quote → sales order). */
  convertsTo?: readonly { to: CoreRecordKey; label: string }[];
  /** Has a PDF document template. */
  printable?: boolean;
}

/* ----------------------------------------------------------- shared shapes */

const f = (key: string, label: string, type: FieldType, extra: Partial<CoreField> = {}): CoreField => ({ key, label, type, ...extra });
const ref = (key: string, label: string, to: CoreField["to"], extra: Partial<CoreField> = {}) => f(key, label, "ref", { to, indexed: true, ...extra });

const number = f("number", "Number", "text", { system: true, indexed: true });
const date = f("date", "Date", "date", { indexed: true });
const reference = f("reference", "Reference", "text");
const notes = f("notes", "Notes", "longtext");
const total = f("total", "Total", "money", { system: true, indexed: true });
const subTotal = f("sub_total", "Sub total", "money", { system: true });
const taxTotal = f("tax_total", "Tax", "money", { system: true });
const amountDue = f("amount_due", "Amount due", "money", { system: true, indexed: true });
const dueDate = f("due_date", "Due date", "date", { indexed: true });
const currency = f("currency", "Currency", "text");
const docHeader = (party: "customer" | "vendor") => [number, date, ref(party, party === "customer" ? "Customer" : "Vendor", party), reference, currency];
const moneyFooter = [subTotal, taxTotal, total];

const salesLines = {
  label: "Lines",
  fields: [
    ref("item", "Item", "item"),
    f("description", "Description", "text"),
    f("quantity", "Quantity", "quantity"),
    f("unit_price", "Unit price", "money"),
    f("discount_pct", "Discount", "percent"),
    ref("tax_code", "Tax", "tax_code"),
    f("amount", "Amount", "money", { system: true }),
  ],
} as const;
const purchaseLines = salesLines;
const stockLines = {
  label: "Lines",
  fields: [ref("item", "Item", "item"), f("quantity", "Quantity", "quantity"), ref("lot", "Lot", "lot"), f("unit_cost", "Unit cost", "money")],
} as const;

/* ------------------------------------------------------------- lifecycles */

const S = (key: string, label: string, tone: Tone = "neutral"): LifecycleState => ({ key, label, tone });
const draft = S("draft", "Draft");
const posted = S("posted", "Posted", "success");
const voided = S("void", "Void", "danger");
const cancelled = S("cancelled", "Cancelled", "danger");

/** draft → posted → void, the shape of every ledger document. */
const posting = (effects: LifecycleAction["effects"] = ["ledger", "numbering"]): Lifecycle => ({
  initial: "draft",
  states: [draft, posted, voided],
  actions: [
    { key: "post", label: "Post", from: ["draft"], to: "posted", permission: "post", approvable: true, effects },
    { key: "void", label: "Void", from: ["posted"], to: "void", permission: "void", approvable: true, effects: effects.filter((e) => e !== "numbering") },
  ],
});

const activeArchived: Lifecycle = {
  initial: "active",
  states: [S("active", "Active", "success"), S("archived", "Archived")],
  actions: [
    { key: "archive", label: "Archive", from: ["active"], to: "archived", permission: "manage" },
    { key: "restore", label: "Restore", from: ["archived"], to: "active", permission: "manage" },
  ],
};

/* --------------------------------------------------------------- catalogue */

export const CORE_RECORDS: Record<CoreRecordKey, CoreRecord> = {
  /* parties and masters */
  customer: {
    key: "customer", label: "Customer", labelPlural: "Customers",
    fields: [
      f("name", "Name", "text", { indexed: true }), f("legal_name", "Legal name", "text"), f("tin", "TIN", "text"), f("vat_no", "VAT number", "text"),
      f("email", "Email", "email"), f("phone", "Phone", "phone", { indexed: true }), f("payment_terms_days", "Payment terms (days)", "integer"),
      f("credit_limit", "Credit limit", "money"), ref("price_list", "Price list", "price_list"), ref("salesperson", "Salesperson", "salesperson"),
      f("balance", "Balance", "money", { system: true, indexed: true }),
    ],
    lifecycle: activeArchived, customFields: ["header"],
  },
  vendor: {
    key: "vendor", label: "Vendor", labelPlural: "Vendors",
    fields: [
      f("name", "Name", "text", { indexed: true }), f("legal_name", "Legal name", "text"), f("tin", "TIN", "text"), f("vat_no", "VAT number", "text"),
      f("email", "Email", "email"), f("phone", "Phone", "phone"), f("payment_terms_days", "Payment terms (days)", "integer"),
      f("approval_status", "Supplier status", "select", { options: ["approved", "conditional", "blocked"], indexed: true }),
      f("balance", "Balance", "money", { system: true, indexed: true }),
    ],
    lifecycle: activeArchived, customFields: ["header"],
  },
  salesperson: {
    key: "salesperson", label: "Salesperson", labelPlural: "Salespersons",
    fields: [f("name", "Name", "text", { indexed: true }), f("email", "Email", "email"), f("commission_pct", "Commission", "percent")],
    lifecycle: activeArchived, customFields: [],
  },
  item: {
    key: "item", label: "Item", labelPlural: "Items",
    fields: [
      f("sku", "SKU", "text", { indexed: true }), f("name", "Name", "text", { indexed: true }),
      f("type", "Type", "select", { options: ["goods", "service"], indexed: true }),
      f("item_class", "Item class", "text", { indexed: true }), f("unit", "Unit", "text"),
      f("sales_price", "Sales price", "money"), f("purchase_price", "Purchase price", "money"),
      ref("tax_code", "Tax", "tax_code"), f("track_inventory", "Track stock", "boolean"), f("track_lots", "Track lots", "boolean"),
      f("inspect_on_arrival", "Inspect on arrival", "boolean"), f("shelf_life_days", "Shelf life (days)", "integer"),
      f("reorder_level", "Reorder level", "quantity"), f("min_order_qty", "Minimum order", "quantity"), f("order_multiple", "Order multiple", "quantity"),
      f("on_hand", "On hand", "quantity", { system: true, indexed: true }), f("avg_cost", "Average cost", "money", { system: true }),
    ],
    lifecycle: activeArchived, customFields: ["header"],
  },
  warehouse: {
    key: "warehouse", label: "Warehouse", labelPlural: "Warehouses",
    fields: [f("code", "Code", "text", { indexed: true }), f("name", "Name", "text"), f("kind", "Kind", "select", { options: ["raw_material", "packaging", "wip", "finished_goods", "general"] })],
    lifecycle: activeArchived, customFields: [],
  },
  price_list: {
    key: "price_list", label: "Price list", labelPlural: "Price lists",
    fields: [f("name", "Name", "text"), f("kind", "Kind", "select", { options: ["percentage", "fixed"] }), f("adjust_pct", "Adjustment", "percent")],
    lifecycle: activeArchived, customFields: [],
  },

  /* sales */
  quote: {
    key: "quote", label: "Quote", labelPlural: "Quotes", numbering: "QT-{seq:5}",
    fields: [...docHeader("customer"), f("expiry_date", "Valid until", "date", { indexed: true }), ref("salesperson", "Salesperson", "salesperson"), ...moneyFooter, notes],
    lines: salesLines,
    lifecycle: {
      initial: "draft",
      states: [draft, S("sent", "Sent", "info"), S("accepted", "Accepted", "success"), S("declined", "Declined", "danger"), S("expired", "Expired", "warning"), S("converted", "Converted", "success")],
      actions: [
        { key: "send", label: "Mark sent", from: ["draft"], to: "sent", permission: "edit", approvable: true, effects: ["numbering"] },
        { key: "accept", label: "Accept", from: ["sent"], to: "accepted", permission: "edit" },
        { key: "decline", label: "Decline", from: ["sent"], to: "declined", permission: "edit" },
        { key: "expire", label: "Expire", from: ["sent"], to: "expired", permission: "edit" },
      ],
    },
    customFields: ["header", "line"], amountField: "total", printable: true,
    convertsTo: [{ to: "sales_order", label: "Convert to sales order" }, { to: "invoice", label: "Convert to invoice" }],
  },
  sales_order: {
    key: "sales_order", label: "Sales order", labelPlural: "Sales orders", numbering: "SO-{yyyy}-{seq:5}",
    fields: [...docHeader("customer"), f("delivery_date", "Delivery date", "date", { indexed: true }), ref("salesperson", "Salesperson", "salesperson"), ref("warehouse", "Ship from", "warehouse"), ...moneyFooter, notes],
    lines: { label: "Lines", fields: [...salesLines.fields, f("delivered_qty", "Delivered", "quantity", { system: true }), f("invoiced_qty", "Invoiced", "quantity", { system: true })] },
    lifecycle: {
      initial: "draft",
      states: [draft, S("confirmed", "Confirmed", "info"), S("in_production", "In production", "info"), S("partly_delivered", "Partly delivered", "warning"), S("delivered", "Delivered", "success"), S("closed", "Closed", "success"), cancelled],
      actions: [
        { key: "confirm", label: "Confirm", from: ["draft"], to: "confirmed", permission: "approve", approvable: true, effects: ["numbering"] },
        { key: "close", label: "Close", from: ["delivered", "partly_delivered"], to: "closed", permission: "edit" },
        { key: "cancel", label: "Cancel", from: ["draft", "confirmed"], to: "cancelled", permission: "void", approvable: true },
      ],
    },
    customFields: ["header", "line"], amountField: "total", printable: true,
    convertsTo: [
      { to: "delivery_note", label: "Create delivery note" },
      { to: "invoice", label: "Create invoice" },
      { to: "production_order", label: "Make to order" },
    ],
  },
  delivery_note: {
    key: "delivery_note", label: "Delivery note", labelPlural: "Delivery notes", numbering: "DN-{seq:5}",
    fields: [
      ...docHeader("customer"), ref("sales_order", "Sales order", "sales_order"), ref("warehouse", "From warehouse", "warehouse"),
      f("vehicle", "Vehicle", "text"), f("driver", "Driver", "text"),
      f("delivered_at", "Delivered at", "datetime"), f("received_by", "Received by", "text"), f("pod_file", "Proof of delivery", "file"), notes,
    ],
    lines: stockLines,
    lifecycle: {
      initial: "draft",
      states: [draft, S("dispatched", "Dispatched", "info"), S("delivered", "Delivered", "success"), voided],
      actions: [
        { key: "dispatch", label: "Dispatch", from: ["draft"], to: "dispatched", permission: "post", approvable: true, effects: ["stock", "ledger", "numbering"] },
        { key: "confirm_delivery", label: "Confirm delivery", from: ["dispatched"], to: "delivered", permission: "edit" },
        { key: "void", label: "Void", from: ["dispatched"], to: "void", permission: "void", approvable: true, effects: ["stock", "ledger"] },
      ],
    },
    customFields: ["header", "line"], printable: true,
    convertsTo: [{ to: "invoice", label: "Invoice what was delivered" }],
  },
  invoice: {
    key: "invoice", label: "Invoice", labelPlural: "Invoices", numbering: "INV-{yyyy}-{seq:5}",
    fields: [...docHeader("customer"), dueDate, ref("sales_order", "Sales order", "sales_order"), ref("salesperson", "Salesperson", "salesperson"), ...moneyFooter, amountDue, notes],
    lines: salesLines,
    lifecycle: posting(["ledger", "numbering"]),
    paymentStatus: true, customFields: ["header", "line"], amountField: "total", printable: true,
    convertsTo: [{ to: "receipt", label: "Record payment" }, { to: "credit_note", label: "Raise credit note" }],
  },
  receipt: {
    key: "receipt", label: "Receipt", labelPlural: "Payments received", numbering: "RCT-{seq:5}",
    fields: [
      number, date, ref("customer", "Customer", "customer"), f("amount", "Amount", "money", { indexed: true }),
      f("method", "Method", "select", { options: ["cash", "bank_transfer", "cheque", "card", "online"] }),
      ref("deposit_to", "Deposit to", "bank_account"), f("wht_deducted", "WHT deducted", "money"), reference,
    ],
    lifecycle: posting(), customFields: ["header"], amountField: "amount", printable: true,
  },
  credit_note: {
    key: "credit_note", label: "Credit note", labelPlural: "Credit notes", numbering: "CN-{seq:5}",
    fields: [...docHeader("customer"), ref("invoice", "Against invoice", "invoice"), f("reason", "Reason", "text"), ...moneyFooter],
    lines: salesLines, lifecycle: posting(["ledger", "stock", "numbering"]), customFields: ["header"], amountField: "total", printable: true,
  },
  recurring_invoice: {
    key: "recurring_invoice", label: "Recurring invoice", labelPlural: "Recurring invoices",
    fields: [
      ref("customer", "Customer", "customer"), f("frequency", "Every", "select", { options: ["weekly", "monthly", "quarterly", "yearly"] }),
      f("next_run", "Next invoice", "date", { indexed: true }), f("end_date", "Ends", "date"), f("auto_post", "Post automatically", "boolean"), total,
    ],
    lines: salesLines,
    lifecycle: {
      initial: "active",
      states: [S("active", "Active", "success"), S("paused", "Paused", "warning"), S("ended", "Ended")],
      actions: [
        { key: "pause", label: "Pause", from: ["active"], to: "paused", permission: "edit" },
        { key: "resume", label: "Resume", from: ["paused"], to: "active", permission: "edit" },
        { key: "end", label: "End", from: ["active", "paused"], to: "ended", permission: "edit" },
      ],
    },
    customFields: [],
  },

  /* point of sale */
  pos_sale: {
    key: "pos_sale", label: "POS sale", labelPlural: "POS sales", numbering: "POS-{seq:6}",
    fields: [number, f("at", "Time", "datetime", { indexed: true }), ref("shift", "Shift", "pos_shift"), ref("customer", "Customer", "customer"), total, f("tender", "Tender", "select", { options: ["cash", "card", "qr", "mixed"] })],
    lines: salesLines,
    lifecycle: {
      initial: "completed",
      states: [S("completed", "Completed", "success"), S("refunded", "Refunded", "danger")],
      actions: [{ key: "refund", label: "Refund", from: ["completed"], to: "refunded", permission: "void", approvable: true, effects: ["ledger", "stock"] }],
    },
    customFields: [], amountField: "total", printable: true,
  },
  pos_shift: {
    key: "pos_shift", label: "Shift", labelPlural: "Shifts",
    fields: [f("terminal", "Terminal", "text"), ref("cashier", "Cashier", "user"), f("opened_at", "Opened", "datetime", { indexed: true }), f("opening_float", "Opening float", "money"), f("counted_cash", "Counted cash", "money"), f("variance", "Variance", "money", { system: true })],
    lifecycle: {
      initial: "open",
      states: [S("open", "Open", "info"), S("closed", "Closed", "success")],
      actions: [{ key: "close", label: "Close shift (Z report)", from: ["open"], to: "closed", permission: "create", effects: ["ledger"] }],
    },
    customFields: [],
  },

  /* purchases */
  purchase_order: {
    key: "purchase_order", label: "Purchase order", labelPlural: "Purchase orders", numbering: "PO-{yyyy}-{seq:5}",
    fields: [...docHeader("vendor"), f("expected_date", "Expected", "date", { indexed: true }), ref("warehouse", "Deliver to", "warehouse"), ref("production_order", "For production order", "production_order"), ...moneyFooter, notes],
    lines: { label: "Lines", fields: [...purchaseLines.fields, f("received_qty", "Received", "quantity", { system: true }), f("billed_qty", "Billed", "quantity", { system: true })] },
    lifecycle: {
      initial: "draft",
      states: [draft, S("issued", "Issued", "info"), S("partly_received", "Partly received", "warning"), S("received", "Received", "success"), S("closed", "Closed", "success"), cancelled],
      actions: [
        { key: "issue", label: "Issue to vendor", from: ["draft"], to: "issued", permission: "approve", approvable: true, effects: ["numbering"] },
        { key: "close", label: "Close", from: ["partly_received", "received"], to: "closed", permission: "edit" },
        { key: "cancel", label: "Cancel", from: ["draft", "issued"], to: "cancelled", permission: "void", approvable: true },
      ],
    },
    customFields: ["header", "line"], amountField: "total", printable: true,
    convertsTo: [{ to: "goods_receipt", label: "Receive goods" }, { to: "bill", label: "Create bill" }],
  },
  goods_receipt: {
    key: "goods_receipt", label: "Goods received note", labelPlural: "Goods received", numbering: "GRN-{seq:5}",
    fields: [...docHeader("vendor"), ref("purchase_order", "Purchase order", "purchase_order"), ref("warehouse", "Warehouse", "warehouse"), f("vendor_dn_no", "Vendor delivery note", "text"), total, notes],
    lines: { label: "Lines", fields: [...stockLines.fields, f("supplier_lot_no", "Supplier lot", "text"), f("expiry_date", "Expiry", "date")] },
    lifecycle: posting(["stock", "ledger", "numbering"]),
    customFields: ["header", "line"], amountField: "total", printable: true,
    convertsTo: [{ to: "bill", label: "Bill what was received" }],
  },
  bill: {
    key: "bill", label: "Bill", labelPlural: "Bills", numbering: "BILL-{seq:5}",
    fields: [...docHeader("vendor"), f("vendor_invoice_no", "Vendor invoice no", "text", { indexed: true }), dueDate, ref("purchase_order", "Purchase order", "purchase_order"), ...moneyFooter, f("wht_amount", "WHT", "money", { system: true }), amountDue, notes],
    lines: purchaseLines, lifecycle: posting(), paymentStatus: true, customFields: ["header", "line"], amountField: "total",
    convertsTo: [{ to: "payment", label: "Pay bill" }, { to: "vendor_credit", label: "Raise vendor credit" }],
  },
  payment: {
    key: "payment", label: "Payment", labelPlural: "Payments made", numbering: "PAY-{seq:5}",
    fields: [
      number, date, ref("vendor", "Vendor", "vendor"), f("amount", "Amount", "money", { indexed: true }),
      f("method", "Method", "select", { options: ["cash", "bank_transfer", "cheque", "card", "online"] }),
      ref("paid_from", "Paid from", "bank_account"), f("wht_deducted", "WHT deducted", "money"), reference,
    ],
    lifecycle: posting(), customFields: ["header"], amountField: "amount", printable: true,
  },
  vendor_credit: {
    key: "vendor_credit", label: "Vendor credit", labelPlural: "Vendor credits", numbering: "VC-{seq:5}",
    fields: [...docHeader("vendor"), ref("bill", "Against bill", "bill"), f("reason", "Reason", "text"), ...moneyFooter],
    lines: purchaseLines, lifecycle: posting(["ledger", "stock", "numbering"]), customFields: ["header"], amountField: "total",
  },
  vendor_advance: {
    key: "vendor_advance", label: "Vendor advance", labelPlural: "Vendor advances", numbering: "ADV-{seq:5}",
    fields: [number, date, ref("vendor", "Vendor", "vendor"), f("amount", "Amount", "money"), ref("paid_from", "Paid from", "bank_account"), f("unapplied", "Unapplied", "money", { system: true })],
    lifecycle: posting(), customFields: [], amountField: "amount",
  },
  expense: {
    key: "expense", label: "Expense", labelPlural: "Expenses", numbering: "EXP-{seq:5}",
    fields: [number, date, ref("vendor", "Vendor", "vendor"), ref("account", "Expense account", "account"), f("amount", "Amount", "money", { indexed: true }), ref("tax_code", "Tax", "tax_code"), ref("paid_from", "Paid from", "bank_account"), f("receipt_file", "Receipt", "file"), f("reimbursable", "Reimbursable", "boolean")],
    lifecycle: posting(), customFields: ["header"], amountField: "amount",
  },
  recurring_bill: {
    key: "recurring_bill", label: "Recurring bill", labelPlural: "Recurring bills",
    fields: [ref("vendor", "Vendor", "vendor"), f("frequency", "Every", "select", { options: ["weekly", "monthly", "quarterly", "yearly"] }), f("next_run", "Next bill", "date", { indexed: true }), total],
    lines: purchaseLines,
    lifecycle: { initial: "active", states: [S("active", "Active", "success"), S("paused", "Paused", "warning"), S("ended", "Ended")], actions: [
      { key: "pause", label: "Pause", from: ["active"], to: "paused", permission: "edit" },
      { key: "resume", label: "Resume", from: ["paused"], to: "active", permission: "edit" },
      { key: "end", label: "End", from: ["active", "paused"], to: "ended", permission: "edit" },
    ] },
    customFields: [],
  },
  supplier_certificate: {
    key: "supplier_certificate", label: "Supplier certificate", labelPlural: "Supplier certificates",
    fields: [ref("vendor", "Vendor", "vendor"), f("name", "Certificate", "text"), f("cert_no", "Number", "text"), f("issued", "Issued", "date"), f("expires", "Expires", "date", { indexed: true }), f("file", "Copy", "file")],
    customFields: [],
  },

  /* inventory */
  stock_adjustment: {
    key: "stock_adjustment", label: "Stock adjustment", labelPlural: "Stock adjustments", numbering: "ADJ-{seq:5}",
    fields: [number, date, ref("warehouse", "Warehouse", "warehouse"), f("reason", "Reason", "select", { options: ["count", "damage", "expiry", "scrap", "opening", "other"] }), notes],
    lines: { label: "Lines", fields: [ref("item", "Item", "item"), f("quantity_delta", "Change", "quantity"), ref("lot", "Lot", "lot"), f("unit_cost", "Unit cost", "money")] },
    lifecycle: posting(["stock", "ledger", "numbering"]), customFields: ["header"],
  },
  stock_transfer: {
    key: "stock_transfer", label: "Stock transfer", labelPlural: "Stock transfers", numbering: "TRF-{seq:5}",
    fields: [number, date, ref("from_warehouse", "From", "warehouse"), ref("to_warehouse", "To", "warehouse"), notes],
    lines: stockLines,
    lifecycle: {
      initial: "draft",
      states: [draft, S("in_transit", "In transit", "info"), S("received", "Received", "success"), voided],
      actions: [
        { key: "send", label: "Send", from: ["draft"], to: "in_transit", permission: "post", approvable: true, effects: ["stock", "numbering"] },
        { key: "receive", label: "Receive", from: ["in_transit"], to: "received", permission: "post", effects: ["stock"] },
        { key: "void", label: "Void", from: ["in_transit"], to: "void", permission: "void", approvable: true, effects: ["stock"] },
      ],
    },
    customFields: [], printable: true,
  },
  lot: {
    key: "lot", label: "Lot", labelPlural: "Lots",
    fields: [f("lot_no", "Lot", "text", { indexed: true }), ref("item", "Item", "item"), f("mfg_date", "Made", "date"), f("expiry_date", "Expiry", "date", { indexed: true }), f("supplier_lot_no", "Supplier lot", "text"), f("bin", "Bin", "text"), f("on_hand", "On hand", "quantity", { system: true })],
    lifecycle: {
      initial: "available",
      states: [S("available", "Available", "success"), S("quarantine", "Quarantine", "warning"), S("rejected", "Rejected", "danger"), S("consumed", "Consumed")],
      actions: [
        { key: "hold", label: "Hold", from: ["available"], to: "quarantine", permission: "approve" },
        { key: "release", label: "Release", from: ["quarantine"], to: "available", permission: "approve", approvable: true },
        { key: "reject", label: "Reject", from: ["quarantine"], to: "rejected", permission: "approve", approvable: true },
      ],
    },
    customFields: [],
  },

  /* production */
  resource: {
    key: "resource", label: "Resource", labelPlural: "Machines and resources",
    fields: [
      f("code", "Code", "text", { indexed: true }), f("name", "Name", "text"),
      f("type", "Type", "select", { options: ["work_centre", "machine", "mould", "tool", "labour", "equipment"], indexed: true }),
      ref("parent", "Belongs to", "resource"), f("hourly_rate", "Cost per hour", "money"), f("hours_per_day", "Hours per day", "decimal"),
    ],
    lifecycle: activeArchived, customFields: ["header"],
  },
  recipe: {
    key: "recipe", label: "Recipe", labelPlural: "Recipes",
    fields: [
      f("code", "Code", "text", { indexed: true }), f("name", "Name", "text"), ref("item", "Makes", "item"), f("version", "Version", "integer", { system: true }),
      f("output_quantity", "Output per run", "quantity"), f("expected_yield_pct", "Expected yield", "percent"), f("mix_mode", "Inputs as % of mix", "boolean"),
    ],
    lines: { label: "Inputs", fields: [ref("item", "Material", "item"), f("quantity", "Quantity", "quantity"), f("mix_pct", "% of mix", "percent"), f("scrap_pct", "Scrap allowance", "percent")] },
    lifecycle: {
      initial: "draft",
      states: [draft, S("active", "Active", "success"), S("archived", "Archived")],
      actions: [
        { key: "activate", label: "Activate version", from: ["draft"], to: "active", permission: "approve", approvable: true },
        { key: "archive", label: "Archive", from: ["active"], to: "archived", permission: "manage" },
      ],
    },
    customFields: ["header"],
  },
  production_order: {
    key: "production_order", label: "Production order", labelPlural: "Production orders", numbering: "PRD-{seq:5}",
    fields: [
      number, ref("recipe", "Recipe", "recipe"), ref("item", "Product", "item"), ref("sales_order", "Sales order", "sales_order"),
      f("planned_quantity", "Planned", "quantity"), f("completed_quantity", "Completed", "quantity", { system: true }), f("scrap_quantity", "Scrap", "quantity", { system: true }),
      f("start_date", "Start", "date", { indexed: true }), f("due_date", "Due", "date", { indexed: true }),
      ref("source_warehouse", "Materials from", "warehouse", { indexed: false }), ref("destination_warehouse", "Output to", "warehouse", { indexed: false }), notes,
    ],
    lifecycle: {
      initial: "draft",
      states: [draft, S("scheduled", "Scheduled", "info"), S("in_progress", "In progress", "info"), S("completed", "Completed", "success"), cancelled],
      actions: [
        { key: "schedule", label: "Schedule", from: ["draft"], to: "scheduled", permission: "approve", approvable: true, effects: ["numbering"] },
        { key: "start", label: "Start", from: ["scheduled"], to: "in_progress", permission: "edit" },
        { key: "complete", label: "Complete", from: ["in_progress"], to: "completed", permission: "edit" },
        { key: "cancel", label: "Cancel", from: ["draft", "scheduled"], to: "cancelled", permission: "void", approvable: true },
      ],
    },
    customFields: ["header"], printable: true,
    convertsTo: [{ to: "batch", label: "Add batch" }, { to: "purchase_order", label: "Buy shortages" }],
  },
  batch: {
    key: "batch", label: "Batch", labelPlural: "Batches", numbering: "B{yy}{mm}-{seq:4}",
    fields: [
      number, ref("production_order", "Production order", "production_order"), ref("machine", "Machine", "resource"), ref("operator", "Operator", "user"),
      f("planned_quantity", "Planned", "quantity"), f("output_quantity", "Good output", "quantity"), f("scrap_quantity", "Scrap", "quantity"),
      f("mfg_date", "Made", "date", { indexed: true }), f("expiry_date", "Expiry", "date"), f("material_cost", "Material cost", "money", { system: true }), f("unit_cost", "Cost per unit", "money", { system: true }),
    ],
    lifecycle: {
      initial: "draft",
      states: [draft, S("materials_issued", "Materials issued", "info"), S("in_process", "In process", "info"), S("qc_hold", "QC hold", "warning"), S("released", "Released", "success"), S("rejected", "Rejected", "danger")],
      actions: [
        { key: "issue_materials", label: "Issue materials", from: ["draft"], to: "materials_issued", permission: "edit", effects: ["stock", "ledger"] },
        { key: "start", label: "Start", from: ["materials_issued"], to: "in_process", permission: "edit" },
        { key: "finish", label: "Record output", from: ["in_process"], to: "qc_hold", permission: "edit", effects: ["stock", "ledger"] },
        { key: "release", label: "Release", from: ["qc_hold"], to: "released", permission: "approve", approvable: true, effects: ["stock"] },
        { key: "reject", label: "Reject", from: ["qc_hold"], to: "rejected", permission: "approve", approvable: true, effects: ["stock", "ledger"] },
      ],
    },
    customFields: ["header"], printable: true,
  },
  inspection: {
    key: "inspection", label: "Incoming inspection", labelPlural: "Incoming inspections",
    fields: [ref("goods_receipt", "Goods received", "goods_receipt"), ref("lot", "Lot", "lot"), ref("item", "Item", "item"), f("sample_size", "Sample size", "integer"), ref("inspector", "Inspector", "user")],
    lifecycle: {
      initial: "pending",
      states: [S("pending", "Pending", "warning"), S("passed", "Passed", "success"), S("failed", "Failed", "danger")],
      actions: [
        { key: "pass", label: "Pass", from: ["pending"], to: "passed", permission: "approve", effects: ["stock"] },
        { key: "fail", label: "Fail", from: ["pending"], to: "failed", permission: "approve", effects: ["stock"] },
      ],
    },
    customFields: [],
  },
  ncr: {
    key: "ncr", label: "Non-conformance", labelPlural: "Non-conformance reports", numbering: "NCR-{seq:4}",
    fields: [
      number, f("source", "Raised from", "select", { options: ["batch", "goods_receipt", "delivery", "customer_complaint"], indexed: true }),
      ref("lot", "Lot", "lot"), ref("item", "Item", "item"), f("quantity", "Quantity", "quantity"), f("description", "What went wrong", "longtext"),
      f("disposition", "Disposition", "select", { options: ["rework", "scrap", "use_as_is", "concession", "return_to_vendor"] }),
      f("root_cause", "Root cause", "longtext"), f("corrective_action", "Corrective action", "longtext"),
    ],
    lifecycle: {
      initial: "open",
      states: [S("open", "Open", "warning"), S("closed", "Closed", "success"), cancelled],
      actions: [
        { key: "close", label: "Close", from: ["open"], to: "closed", permission: "approve", approvable: true, effects: ["stock", "ledger"] },
        { key: "cancel", label: "Cancel", from: ["open"], to: "cancelled", permission: "void" },
      ],
    },
    customFields: ["header"], printable: true,
  },
  artwork: {
    key: "artwork", label: "Artwork", labelPlural: "Artwork",
    fields: [f("name", "Name", "text", { indexed: true }), ref("item", "Item", "item"), ref("customer", "Customer", "customer"), f("version", "Version", "integer", { system: true }), f("file", "Proof", "file"), f("change_reason", "Reason for change", "text"), f("customer_approved_at", "Customer approved", "datetime")],
    lifecycle: {
      initial: "draft",
      states: [draft, S("approved", "Approved", "success"), S("retired", "Retired")],
      actions: [
        { key: "approve", label: "Approve version", from: ["draft"], to: "approved", permission: "approve", approvable: true },
        { key: "retire", label: "Retire", from: ["approved"], to: "retired", permission: "edit" },
      ],
    },
    customFields: [],
  },

  /* banking and accounting */
  bank_account: {
    key: "bank_account", label: "Bank account", labelPlural: "Bank and cash accounts",
    fields: [f("name", "Name", "text"), f("kind", "Kind", "select", { options: ["bank", "cash", "card", "wallet"] }), f("bank", "Bank", "text"), f("account_no", "Account number", "text"), f("balance", "Balance", "money", { system: true })],
    lifecycle: activeArchived, customFields: [],
  },
  cheque: {
    key: "cheque", label: "Cheque", labelPlural: "Cheques",
    fields: [f("direction", "Direction", "select", { options: ["received", "issued"], indexed: true }), f("cheque_no", "Cheque no", "text"), f("cheque_date", "Cheque date", "date", { indexed: true }), f("amount", "Amount", "money"), ref("bank_account", "Bank account", "bank_account")],
    lifecycle: {
      initial: "pending",
      states: [S("pending", "Pending", "warning"), S("deposited", "Deposited", "info"), S("realised", "Realised", "success"), S("bounced", "Bounced", "danger"), cancelled],
      actions: [
        { key: "deposit", label: "Deposit", from: ["pending"], to: "deposited", permission: "edit" },
        { key: "realise", label: "Realise", from: ["deposited"], to: "realised", permission: "post", effects: ["ledger"] },
        { key: "bounce", label: "Bounced", from: ["deposited"], to: "bounced", permission: "post", effects: ["ledger"] },
        { key: "cancel", label: "Cancel", from: ["pending"], to: "cancelled", permission: "void" },
      ],
    },
    customFields: [],
  },
  account: {
    key: "account", label: "Account", labelPlural: "Chart of accounts",
    fields: [f("code", "Code", "text", { indexed: true }), f("name", "Name", "text"), f("type", "Type", "select", { options: ["asset", "liability", "equity", "income", "expense"], indexed: true }), f("subtype", "Subtype", "text"), ref("parent", "Parent", "account"), f("balance", "Balance", "money", { system: true })],
    lifecycle: activeArchived, customFields: [],
  },
  journal: {
    key: "journal", label: "Journal", labelPlural: "Manual journals", numbering: "JV-{seq:5}",
    fields: [number, date, f("narration", "Narration", "text"), reference, f("total_debit", "Total", "money", { system: true })],
    lines: { label: "Lines", fields: [ref("account", "Account", "account"), f("description", "Description", "text"), f("debit", "Debit", "money"), f("credit", "Credit", "money"), f("cost_centre", "Cost centre", "text")] },
    lifecycle: {
      initial: "draft",
      states: [draft, posted, S("reversed", "Reversed", "danger")],
      actions: [
        { key: "post", label: "Post", from: ["draft"], to: "posted", permission: "post", approvable: true, effects: ["ledger", "numbering"] },
        { key: "reverse", label: "Reverse", from: ["posted"], to: "reversed", permission: "void", approvable: true, effects: ["ledger"] },
      ],
    },
    customFields: [], amountField: "total_debit", printable: true,
  },
  recurring_journal: {
    key: "recurring_journal", label: "Recurring journal", labelPlural: "Recurring journals",
    fields: [f("narration", "Narration", "text"), f("frequency", "Every", "select", { options: ["monthly", "quarterly", "yearly"] }), f("next_run", "Next run", "date")],
    lines: { label: "Lines", fields: [ref("account", "Account", "account"), f("debit", "Debit", "money"), f("credit", "Credit", "money")] },
    lifecycle: activeArchived, customFields: [],
  },
  budget: {
    key: "budget", label: "Budget", labelPlural: "Budgets",
    fields: [f("name", "Name", "text"), f("fiscal_year", "Fiscal year", "text")],
    lines: { label: "Lines", fields: [ref("account", "Account", "account"), f("period", "Period", "text"), f("amount", "Amount", "money")] },
    lifecycle: activeArchived, customFields: [],
  },
  fixed_asset: {
    key: "fixed_asset", label: "Fixed asset", labelPlural: "Fixed assets", numbering: "FA-{seq:4}",
    fields: [number, f("name", "Name", "text"), f("category", "Category", "text"), f("acquired_on", "Acquired", "date"), f("cost", "Cost", "money"), f("salvage_value", "Salvage value", "money"), f("method", "Depreciation", "select", { options: ["straight_line", "reducing_balance"] }), f("useful_life_months", "Useful life (months)", "integer"), f("written_down_value", "Written down value", "money", { system: true })],
    lifecycle: {
      initial: "active",
      states: [S("active", "Active", "success"), S("disposed", "Disposed"), S("written_off", "Written off", "danger")],
      actions: [
        { key: "dispose", label: "Dispose", from: ["active"], to: "disposed", permission: "post", approvable: true, effects: ["ledger"] },
        { key: "write_off", label: "Write off", from: ["active"], to: "written_off", permission: "void", approvable: true, effects: ["ledger"] },
      ],
    },
    customFields: ["header"],
  },

  /* tax */
  tax_code: {
    key: "tax_code", label: "Tax code", labelPlural: "Tax rates",
    fields: [f("name", "Name", "text"), f("rate", "Rate", "percent"), f("kind", "Kind", "select", { options: ["vat", "sscl", "wht", "exempt", "zero_rated"] })],
    lifecycle: activeArchived, customFields: [],
  },
  vat_return: {
    key: "vat_return", label: "VAT return", labelPlural: "VAT returns",
    fields: [f("period", "Period", "text", { indexed: true }), f("output_vat", "Output VAT", "money", { system: true }), f("input_vat", "Input VAT", "money", { system: true }), f("net_payable", "Net payable", "money", { system: true }), f("filed_ref", "Filing reference", "text")],
    lifecycle: {
      initial: "draft",
      states: [draft, S("finalised", "Finalised", "info"), S("filed", "Filed", "success"), S("paid", "Paid", "success")],
      actions: [
        { key: "finalise", label: "Finalise", from: ["draft"], to: "finalised", permission: "file", approvable: true, effects: ["ledger"] },
        { key: "file", label: "Mark filed", from: ["finalised"], to: "filed", permission: "file" },
        { key: "pay", label: "Mark paid", from: ["filed"], to: "paid", permission: "file", effects: ["ledger"] },
      ],
    },
    customFields: [],
  },
  wht_certificate: {
    key: "wht_certificate", label: "WHT certificate", labelPlural: "WHT certificates",
    fields: [f("certificate_no", "Certificate", "text"), ref("vendor", "Vendor", "vendor"), f("period", "Period", "text"), f("amount", "Amount", "money")],
    customFields: [], printable: true,
  },
};

export function coreRecord(key: CoreRecordKey): CoreRecord {
  return CORE_RECORDS[key];
}

/** All actions on a record, including the generic ones every record has. */
export function recordActionKeys(key: CoreRecordKey): string[] {
  return ["create", "update", "delete", ...(CORE_RECORDS[key].lifecycle?.actions.map((a) => a.key) ?? [])];
}
