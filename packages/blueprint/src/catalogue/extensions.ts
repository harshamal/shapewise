import { z } from "zod";

/**
 * Extensions: optional capabilities a business switches on, all off by
 * default, as in SyncBooks Settings › Extensions. One entry is the whole
 * definition: what it needs, which submodules it unlocks, and what it changes.
 * The engines check the switch wherever a feature starts writing data.
 */

export const EXTENSION_KEYS = [
  "custom_fields",
  "moq",
  "price_breaks",
  "price_lists",
  "pod",
  "dispatch_invoicing",
  "customer_portal",
  "recurring",
  "multi_currency",
  "supplier_qualification",
  "three_way_match",
  "production_purchasing",
  "pack_units",
  "reorder_suggestions",
  "lots",
  "bins",
  "incoming_qc",
  "ncr",
  "ops_reports",
  "artwork",
  "capacity",
] as const;
export const ExtensionKey = z.enum(EXTENSION_KEYS);
export type ExtensionKey = z.infer<typeof ExtensionKey>;

export type ExtensionCategory = "Records" | "Sales" | "Purchasing" | "Inventory" | "Warehouse" | "Manufacturing" | "Quality" | "Finance";

export interface Extension {
  key: ExtensionKey;
  name: string;
  summary: string;
  /** What changes when it is on, in plain words. */
  details: readonly string[];
  category: ExtensionCategory;
  /** Modules that must be on. */
  needsModules: readonly string[];
  /** Other extensions switched on first. */
  requires: readonly ExtensionKey[];
}

export const EXTENSIONS: readonly Extension[] = [
  {
    key: "custom_fields", name: "Custom fields", category: "Records", needsModules: [], requires: [],
    summary: "Your own fields on items, contacts, document headers and lines.",
    details: [
      "Item fields such as length, width, volume, weight or shape.",
      "Order line fields such as colour code or label version, carried from quote to order, production, delivery note and invoice.",
      "Choose which fields print on documents and which show on production batches.",
    ],
  },
  {
    key: "moq", name: "Minimum order quantity", category: "Sales", needsModules: ["sales"], requires: [],
    summary: "A minimum and an order multiple per item; warn or block orders below it.",
    details: ["Quotes and sales orders warn below the minimum, or refuse it when set to block."],
  },
  {
    key: "price_breaks", name: "Quantity price breaks", category: "Sales", needsModules: ["sales"], requires: [],
    summary: "Lower unit prices from a quantity upwards, applied as the quantity is typed.",
    details: ["A price typed by hand is kept."],
  },
  {
    key: "price_lists", name: "Price lists", category: "Sales", needsModules: ["sales"], requires: [],
    summary: "Customer rate cards, as a percentage or fixed prices per item.",
    details: ["Assign a price list to a customer; documents pick its prices."],
  },
  {
    key: "pod", name: "Proof of delivery", category: "Sales", needsModules: ["sales"], requires: [],
    summary: "Record who received each delivery, when, with the signed copy or a photo.",
    details: ["A proof of delivery panel on each delivery note."],
  },
  {
    key: "dispatch_invoicing", name: "Invoice on dispatch", category: "Sales", needsModules: ["sales"], requires: [],
    summary: "Create the invoice automatically when a delivery note is dispatched.",
    details: ["Invoices exactly what was delivered, as a draft or posted, per settings."],
  },
  {
    key: "customer_portal", name: "Customer portal", category: "Sales", needsModules: ["sales"], requires: [],
    summary: "A private link for each customer to see orders, deliveries and invoices.",
    details: ["With the artwork library on, customers can approve artwork on the same page."],
  },
  {
    key: "recurring", name: "Recurring documents", category: "Finance", needsModules: [], requires: [],
    summary: "Invoices, bills and journals that repeat on a schedule.",
    details: ["Adds Recurring invoices, Recurring bills and Recurring journals."],
  },
  {
    key: "multi_currency", name: "Multiple currencies", category: "Finance", needsModules: [], requires: [],
    summary: "Documents in foreign currencies with exchange rates and FX gain or loss.",
    details: ["The ledger stays in the business currency."],
  },
  {
    key: "supplier_qualification", name: "Supplier qualification", category: "Purchasing", needsModules: ["purchases"], requires: [],
    summary: "Approved supplier list and supplier certificates with expiry reminders.",
    details: ["Warn or refuse purchase orders and goods received from suppliers that aren't approved."],
  },
  {
    key: "three_way_match", name: "Three-way match", category: "Purchasing", needsModules: ["purchases"], requires: [],
    summary: "Check every bill against its purchase order and what was received.",
    details: ["Flags quantities over what was received and prices outside the tolerance."],
  },
  {
    key: "production_purchasing", name: "Buy for production", category: "Manufacturing", needsModules: ["production", "purchases"], requires: [],
    summary: "Turn a production order's material shortages into a purchase order in one click.",
    details: ["The purchase order is referenced to the production order."],
  },
  {
    key: "pack_units", name: "Cartons and pallets", category: "Inventory", needsModules: ["inventory"], requires: [],
    summary: "Type quantities in cartons or pallets on any document. Stock stays in base units.",
    details: ["Delivery notes and PDFs show the carton and pallet breakdown."],
  },
  {
    key: "reorder_suggestions", name: "Reorder suggestions", category: "Inventory", needsModules: ["inventory"], requires: [],
    summary: "Reorder points worked out from real usage, lead time and safety stock.",
    details: ["Apply the suggestions to items in one go."],
  },
  {
    key: "lots", name: "Lot tracking and expiry", category: "Inventory", needsModules: ["inventory"], requires: [],
    summary: "Know which lot every unit came from and went to. Oldest expiry is picked first.",
    details: ["Goods received get a supplier lot and expiry; production output gets the batch number."],
  },
  {
    key: "bins", name: "Bin locations", category: "Warehouse", needsModules: ["inventory"], requires: ["lots"],
    summary: "Shelf and rack positions inside a warehouse, shown on pick lists.",
    details: ["Put each lot in a bin; delivery notes show where to pick from."],
  },
  {
    key: "incoming_qc", name: "Incoming inspection", category: "Quality", needsModules: ["inventory", "production"], requires: ["lots"],
    summary: "Hold received goods until they pass inspection.",
    details: ["Receipts of items marked 'inspect on arrival' are held until released."],
  },
  {
    key: "ncr", name: "Non-conformance reports", category: "Quality", needsModules: ["production"], requires: [],
    summary: "Record what went wrong, what happens to the goods, the root cause and the fix.",
    details: ["Closing an NCR needs the approve right."],
  },
  {
    key: "ops_reports", name: "Operations reports", category: "Manufacturing", needsModules: ["production"], requires: [],
    summary: "Cost per unit, yield, material variance, schedule adherence and fulfilment.",
    details: ["Material variance compares what was issued with what the recipe planned."],
  },
  {
    key: "artwork", name: "Artwork library", category: "Manufacturing", needsModules: ["production"], requires: [],
    summary: "Label and print designs per product and customer, with versions and approval.",
    details: ["Production batches show the approved artwork."],
  },
  {
    key: "capacity", name: "Machine capacity", category: "Manufacturing", needsModules: ["production"], requires: [],
    summary: "Weekly load on each machine against the hours it runs.",
    details: ["Shows planned hours per week, late work and overloaded weeks."],
  },
];

export const EXTENSION_BY_KEY = Object.fromEntries(EXTENSIONS.map((e) => [e.key, e])) as Record<ExtensionKey, Extension>;

/** Keys in switch-on order, requirements first. */
export function withRequirements(keys: readonly ExtensionKey[]): ExtensionKey[] {
  const out: ExtensionKey[] = [];
  const visit = (k: ExtensionKey) => {
    if (out.includes(k)) return;
    EXTENSION_BY_KEY[k].requires.forEach(visit);
    out.push(k);
  };
  keys.forEach(visit);
  return out;
}
