import { z } from "zod";
import { CORE_RECORD_KEYS } from "./catalogue/records";

/**
 * Business rules the engines read, grouped like SyncBooks' settings screens.
 * Every key has a default, so a blueprint only states what differs.
 */
const Mode = z.enum(["off", "warn", "block"]);

export const NumberingPattern = z
  .string()
  .min(1)
  .max(40)
  .regex(/\{seq(:\d)?\}/, "A numbering pattern needs a {seq} or {seq:N} counter");

export const GeneralSettings = z
  .object({
    /** Let people back-date documents. */
    allowDocDateEdit: z.boolean().default(false),
    /** Nothing dated on or before this can be created, changed or voided. ISO date. */
    lockDate: z.iso.date().optional(),
    /** Overrides of the catalogue's default numbering per record type. */
    numbering: z
      .array(z.object({ record: z.enum(CORE_RECORD_KEYS), pattern: NumberingPattern }))
      .max(40)
      .default([]),
  })
  .prefault({});

export const SalesSettings = z
  .object({
    defaultPaymentTermsDays: z.number().int().min(0).max(365).default(30),
    quoteValidityDays: z.number().int().min(1).max(365).default(30),
    /** Minimum order quantity check (moq extension). */
    moqMode: Mode.default("warn"),
    /** Customer credit limit check on orders and invoices. */
    creditLimitMode: Mode.default("warn"),
    /** Invoice created on dispatch (dispatch_invoicing extension) is a draft or posted. */
    dispatchInvoiceAs: z.enum(["draft", "posted"]).default("draft"),
    /** Selling below stock on hand. */
    allowBackorders: z.boolean().default(true),
  })
  .prefault({});

export const PurchasingSettings = z
  .object({
    /** Three-way match price and quantity tolerance, percent. */
    matchTolerancePct: z.number().min(0).max(50).default(2),
    /** Orders and receipts from suppliers that aren't approved (supplier_qualification). */
    unapprovedSupplierMode: Mode.default("warn"),
    /** Allow goods received without a purchase order. */
    receiveWithoutPo: z.boolean().default(true),
  })
  .prefault({});

export const InventorySettings = z
  .object({
    costingMethod: z.enum(["weighted_average", "fifo"]).default("weighted_average"),
    /** Stock going below zero. */
    negativeStock: Mode.default("block"),
    /** Expiry reminders, days before expiry (lots extension). */
    expiryAlertDays: z.array(z.number().int().min(0).max(730)).max(5).default([90, 30, 0]),
    /** Pick the oldest expiry first (lots extension). */
    fifoDispatch: z.boolean().default(true),
  })
  .prefault({});

/** SyncBooks' manufacturing settings. */
export const ProductionSettings = z
  .object({
    /** Show operations (routing, machines, labour, process parameters) on recipes and batches. */
    useOperations: z.boolean().default(false),
    /** Show co-products, by-products and regrind on recipes and batches. */
    useOutputs: z.boolean().default(false),
    /** New recipes start with inputs as % of mix. */
    mixModeDefault: z.boolean().default(false),
    /** New recipes put output on QC hold until released. */
    qcHoldByDefault: z.boolean().default(true),
    /** A failed QC or incoming inspection opens an NCR (ncr extension). */
    autoNcrOnFail: z.boolean().default(false),
    /** Output can only be dispatched once it has a certificate of analysis. */
    coaBeforeDispatch: z.boolean().default(false),
    /** Incoming inspection sample per 1,000 units received; 0 = not set. */
    samplePerThousand: z.number().int().min(0).max(1000).default(0),
    /** Public product verification page from the label QR. */
    publicTrace: z.boolean().default(false),
    /** Certifications shown on the verification page. */
    publicCertifications: z.string().max(300).optional(),
  })
  .prefault({});

export const AccountingSettings = z
  .object({
    /** Seeded chart of accounts. */
    chartTemplate: z.enum(["lk_services", "lk_trading", "lk_manufacturing"]).default("lk_trading"),
    budgetEnforcement: Mode.default("off"),
    /** Cost centres on journal lines. */
    costCentres: z.boolean().default(false),
  })
  .prefault({});

export const TaxSettings = z
  .object({
    vatRegistered: z.boolean().default(false),
    /** Sri Lanka social security contribution levy. */
    ssclRegistered: z.boolean().default(false),
    /** Withholding tax deducted on payments and receipts. */
    wht: z.boolean().default(false),
    /** IRD tax invoice format on invoices. */
    irdTaxInvoice: z.boolean().default(false),
  })
  .prefault({});

/** How external agents (MCP) and the assistant may act. Shapewise-specific. */
export const AgentSettings = z
  .object({
    mcpEnabled: z.boolean().default(true),
    /**
     * Which agent writes are parked for a person's approval, on top of the
     * approval rules: none, anything that posts to the ledger or stock, or every write.
     */
    holdAgentWrites: z.enum(["none", "posting", "all"]).default("posting"),
  })
  .prefault({});

export const Settings = z
  .object({
    general: GeneralSettings,
    sales: SalesSettings,
    purchasing: PurchasingSettings,
    inventory: InventorySettings,
    production: ProductionSettings,
    accounting: AccountingSettings,
    tax: TaxSettings,
    agents: AgentSettings,
  })
  .prefault({});
export type Settings = z.infer<typeof Settings>;
