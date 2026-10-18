import { z } from "zod";
import { PermAction } from "./catalogue/actions";
import { ExtensionKey } from "./catalogue/extensions";
import { CoreRecordKey } from "./catalogue/records";
import { REPORT_KEYS, REPORT_PLACES } from "./catalogue/reports";
import { SECTIONS } from "./catalogue/modules";
import { Field, ScalarField, Target, Tone } from "./fields";
import {
  ApprovalId,
  ApprovalStageId,
  DocumentId,
  EntityId,
  Expr,
  FieldId,
  Key,
  Label,
  ModuleId,
  RoleId,
  RuleId,
  StateId,
  TransitionId,
  ViewId,
  WidgetId,
} from "./ids";
import { Seed } from "./seed";
import { NumberingPattern, Settings } from "./settings";

/**
 * Blueprint v2: a business's configuration of the fixed Shapewise catalogue
 * (modules, submodules, core records and extensions, modelled on SyncBooks),
 * plus the things the catalogue leaves open: custom fields, custom record
 * types, rules, approvals, roles, views, documents and the dashboard.
 *
 * The blueprint never redefines a core record's lifecycle, postings or engine
 * fields. That is what keeps money and stock correct whatever the AI generates.
 */
export const SCHEMA_VERSION = 2 as const;

const SectionKey = z.enum(SECTIONS.map((s) => s.key) as [string, ...string[]]);

/** A core field key ("total") or a custom field id ("fld_x7k2"). */
export const FieldRef = Key;

/* ------------------------------------------------------------------ business */

export const Business = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(160).optional(),
  /** ISO 4217, e.g. "LKR". */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** ISO 3166-1 alpha-2. Drives tax and the chart of accounts. */
  country: z.string().regex(/^[A-Z]{2}$/).default("LK"),
  /** BCP 47, e.g. "en-LK". */
  locale: z.string().min(2).max(35),
  /** IANA, e.g. "Asia/Colombo". */
  timezone: z.string().min(3).max(64),
  /** Free text, e.g. "plastic injection moulding". */
  industry: z.string().max(80).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(4),
  tin: z.string().max(20).optional(),
  vatNo: z.string().max(20).optional(),
  brNo: z.string().max(20).optional(),
  /** Printed on documents. */
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(120).optional(),
  website: z.string().trim().max(120).optional(),
});
export type Business = z.infer<typeof Business>;

/* ------------------------------------------------------------------- modules */

export const SubmoduleConfig = z.object({
  /** Catalogue submodule key, e.g. "delivery_notes". */
  key: Key,
  enabled: z.boolean().optional(),
  label: Label.optional(),
  order: z.number().int().min(0).max(999).optional(),
});

export const ModuleConfig = z.object({
  /** Catalogue module key, e.g. "production". */
  key: Key,
  enabled: z.boolean().default(true),
  label: Label.optional(),
  order: z.number().int().min(0).max(999).optional(),
  /** Only submodules that differ from the catalogue defaults. */
  submodules: z.array(SubmoduleConfig).max(40).default([]),
});
export type ModuleConfig = z.infer<typeof ModuleConfig>;

/** A module the business adds for its own record types, e.g. "Fleet". */
export const CustomModule = z.object({
  id: ModuleId,
  key: Key,
  label: Label,
  section: SectionKey.default("operations"),
  icon: z.string().max(40).optional(),
  order: z.number().int().min(0).max(999).optional(),
});
export type CustomModule = z.infer<typeof CustomModule>;

/* ------------------------------------------------------------- custom fields */

/** An extra field on a core record (needs the custom_fields extension). */
export const CustomField = z.object({
  target: CoreRecordKey,
  /** On the document header, or on each line (carried along conversions). */
  part: z.enum(["header", "line"]).default("header"),
  field: ScalarField,
  showOnDocuments: z.boolean().default(true),
  /** Shown on production orders and batches made from this line. */
  showInProduction: z.boolean().default(false),
  order: z.number().int().min(0).max(999).optional(),
});
export type CustomField = z.infer<typeof CustomField>;

/* ----------------------------------------------------- custom record types */

export const WorkflowState = z.object({
  id: StateId,
  key: Key,
  label: Label,
  tone: Tone.default("neutral"),
  terminal: z.boolean().optional(),
});

export const Transition = z.object({
  id: TransitionId,
  /** Becomes the action and tool name, e.g. "mark_ready". */
  key: Key,
  label: Label,
  from: z.array(StateId).min(1),
  to: StateId,
  /** Permission needed on the record type. */
  permission: PermAction.default("edit"),
  /** Fields that must be filled first. */
  requires: z.array(FieldId).optional(),
  when: Expr.optional(),
});

export const Workflow = z.object({
  states: z.array(WorkflowState).min(2).max(20),
  initial: StateId,
  transitions: z.array(Transition).max(40),
});
export type Workflow = z.infer<typeof Workflow>;

/**
 * A custom record type, shown as a submodule of a catalogue or custom module.
 * Custom records never post to the ledger or stock; they link to core records
 * through ref fields (a mould register referencing items and machines).
 */
export const Entity = z.object({
  id: EntityId,
  key: Key,
  label: Label,
  labelPlural: Label,
  /** Catalogue module key or custom module id. */
  module: z.union([ModuleId, Key]),
  icon: z.string().max(40).optional(),
  titleField: FieldId,
  fields: z.array(Field).min(1).max(120),
  workflow: Workflow.optional(),
  numbering: z.object({ pattern: NumberingPattern }).optional(),
  order: z.number().int().min(0).max(999).optional(),
});
export type Entity = z.infer<typeof Entity>;

/* -------------------------------------------------------------------- rules */

export const RuleEffect = z.discriminatedUnion("kind", [
  /** Set a field to an expression's value. */
  z.object({ kind: z.literal("set"), field: FieldRef, expr: Expr }),
  /** Refuse the save. */
  z.object({ kind: z.literal("reject"), message: z.string().min(1).max(200) }),
  /** Allow with a warning. */
  z.object({ kind: z.literal("warn"), message: z.string().min(1).max(200) }),
  /** Percentage discount on every line. */
  z.object({ kind: z.literal("discount_percent"), expr: Expr }),
  /** Tell people in these roles. */
  z.object({ kind: z.literal("notify"), roles: z.array(RoleId).min(1), message: z.string().min(1).max(200) }),
]);

export const Rule = z.object({
  id: RuleId,
  key: Key,
  label: Label,
  target: Target,
  /** create, update, or a lifecycle/workflow action key such as "post" or "dispatch". */
  on: z.array(Key).min(1).max(10),
  when: Expr.optional(),
  then: RuleEffect,
  enabled: z.boolean().default(true),
  /** Where it came from, e.g. "change:chg_19". */
  source: z.string().max(80).optional(),
});
export type Rule = z.infer<typeof Rule>;

/* ---------------------------------------------------------------- approvals */

export const Channel = z.enum(["web", "assistant", "mcp", "import"]);

/** One approval stage. Stages run in order; a stage is skipped below its minimum amount. */
export const ApprovalStage = z.object({
  id: ApprovalStageId,
  name: Label,
  /** In the business currency, major units. Stage applies at or above this. */
  minAmount: z.number().min(0).default(0),
  roles: z.array(RoleId).min(1).max(10),
  /** One approver from each role, instead of any one. */
  requireAll: z.boolean().default(false),
});

/** SyncBooks-style multi-stage approval on one action of one record type. */
export const ApprovalPolicy = z.object({
  id: ApprovalId,
  label: Label,
  target: Target,
  /** Lifecycle or workflow action, e.g. "post", "issue", "confirm"; or create/update/delete. */
  action: Key,
  /** Extra condition; omit for always. */
  when: Expr.optional(),
  /** Only for these channels, e.g. hold MCP writes but not staff. Omit for all. */
  channels: z.array(Channel).min(1).optional(),
  stages: z.array(ApprovalStage).min(1).max(5),
  enabled: z.boolean().default(true),
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicy>;

/* -------------------------------------------------------------------- roles */

export const RowScope = z.union([
  z.literal("all"),
  /** Records the person created or is named on through a user field. */
  z.object({ kind: z.literal("own"), field: FieldRef.optional() }),
  /** Any condition; `$user` is the person. */
  z.object({ kind: z.literal("expr"), expr: Expr }),
]);

export const Grant = z.object({
  /** Submodule key ("invoices"), custom record type id, or "*" for everything. */
  target: z.union([z.literal("*"), Key]),
  actions: z.array(PermAction).min(1).max(8),
  scope: RowScope.default("all"),
});

export const Role = z.object({
  id: RoleId,
  key: Key,
  label: Label,
  description: z.string().max(200).optional(),
  /** Full access, including system changes and approvals. */
  owner: z.boolean().optional(),
  /** May ask for blueprint changes in the change studio. */
  canChangeSystem: z.boolean().optional(),
  grants: z.array(Grant).max(200),
});
export type Role = z.infer<typeof Role>;

/* -------------------------------------------------------------------- views */

export const View = z.object({
  id: ViewId,
  target: Target,
  label: Label,
  type: z.enum(["table", "kanban", "calendar"]),
  columns: z.array(FieldRef).max(20).optional(),
  /** Kanban lanes: "status" or a select/ref field. */
  groupBy: FieldRef.optional(),
  /** Calendar: a date field. */
  dateField: FieldRef.optional(),
  filter: Expr.optional(),
  sort: z.object({ field: FieldRef, dir: z.enum(["asc", "desc"]) }).optional(),
  /** Visible only to these roles; omit for everyone. */
  roles: z.array(RoleId).optional(),
  default: z.boolean().optional(),
});
export type View = z.infer<typeof View>;

/* ---------------------------------------------------------------- documents */

export const DocumentTemplate = z.object({
  id: DocumentId,
  record: CoreRecordKey,
  label: Label,
  layout: z.enum(["standard", "compact", "ird_tax_invoice"]).default("standard"),
  /** Extra fields printed under each line or in the header. */
  extraFields: z.array(FieldRef).max(12).default([]),
  showLots: z.boolean().default(false),
  footer: z.string().max(400).optional(),
  default: z.boolean().default(true),
});

/* ---------------------------------------------------------------- dashboard */

export const BUILTIN_METRICS = [
  "sales_this_month",
  "receivables_overdue",
  "payables_due",
  "cash_position",
  "orders_due_this_week",
  "top_products",
  "top_customers",
  "stock_value",
  "stock_below_reorder",
  "lots_expiring",
  "jobs_in_progress",
  "jobs_late",
  "yield_pct",
  "scrap_pct",
  "scrap_pct_by_machine",
  "qc_failures",
  "open_ncrs",
  "capacity_load",
  "pending_approvals",
] as const;

export const Widget = z.object({
  id: WidgetId,
  label: Label.optional(),
  size: z.enum(["sm", "md", "lg"]).default("sm"),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("builtin"), metric: z.enum(BUILTIN_METRICS) }),
    z.object({
      kind: z.literal("aggregate"),
      target: Target,
      agg: z.enum(["count", "sum", "avg"]),
      field: FieldRef.optional(),
      filter: Expr.optional(),
      period: z.enum(["today", "week", "month", "quarter", "year", "all"]).default("month"),
    }),
  ]),
  roles: z.array(RoleId).optional(),
});
export type Widget = z.infer<typeof Widget>;

/* ------------------------------------------------------------------ reports */

/** A report this business uses, and where it shows up. Reports not listed are still in Reports, just not pinned anywhere. */
export const ReportSetting = z.object({
  key: z.enum(REPORT_KEYS),
  places: z.array(z.enum(REPORT_PLACES)).min(1).max(REPORT_PLACES.length),
  /** Only these roles see it; omit to follow each role's access to its module. */
  roles: z.array(RoleId).optional(),
});
export type ReportSetting = z.infer<typeof ReportSetting>;

/* ---------------------------------------------------------------- blueprint */

export const LayerRef = z.object({ id: z.string().min(1).max(60), version: z.number().int().min(1) });

export const Blueprint = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** Increments on every applied change. */
  version: z.number().int().min(1),
  /** Industry preset this started from, e.g. { id: "plastics", version: 1 }. */
  preset: LayerRef.optional(),
  business: Business,
  /** Catalogue modules. Modules left out are off. */
  modules: z.array(ModuleConfig).min(1).max(30),
  customModules: z.array(CustomModule).max(10).default([]),
  extensions: z.array(ExtensionKey).max(40).default([]),
  settings: Settings,
  customFields: z.array(CustomField).max(200).default([]),
  /** Custom record types. */
  entities: z.array(Entity).max(60).default([]),
  rules: z.array(Rule).max(300).default([]),
  approvals: z.array(ApprovalPolicy).max(100).default([]),
  roles: z.array(Role).min(1).max(40),
  views: z.array(View).max(300).default([]),
  documents: z.array(DocumentTemplate).max(60).default([]),
  dashboard: z.array(Widget).max(24).default([]),
  reports: z.array(ReportSetting).max(60).default([]),
  seed: Seed,
});
export type Blueprint = z.infer<typeof Blueprint>;
export type BlueprintInput = z.input<typeof Blueprint>;
