import { z } from "zod";
import { BindingKey } from "./bindings";
import { Field, Tone } from "./fields";
import {
  ApprovalId,
  ApprovalStepId,
  DocumentId,
  EntityId,
  Expr,
  FieldId,
  Key,
  Label,
  ModuleId,
  QcId,
  RoleId,
  RuleId,
  StageId,
  StateId,
  TransitionId,
  ViewId,
  WidgetId,
} from "./ids";

export const SCHEMA_VERSION = 1 as const;

/* ------------------------------------------------------------------ business */

export const Business = z.object({
  name: z.string().trim().min(1).max(120),
  /** ISO 4217, e.g. "LKR". */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** BCP 47, e.g. "en-LK". */
  locale: z.string().min(2).max(35),
  /** IANA, e.g. "Asia/Colombo". */
  timezone: z.string().min(3).max(64),
  /** Free-text industry, e.g. "plastic injection moulding". */
  industry: z.string().max(80).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(4),
});
export type Business = z.infer<typeof Business>;

/* ------------------------------------------------------------------- modules */

export const Module = z.object({
  id: ModuleId,
  key: Key,
  label: Label,
  /** Lucide icon name for the sidebar. */
  icon: z.string().max(40).optional(),
  /** Engine module this groups, if any; custom modules have none. */
  engine: z.enum(["parties", "inventory", "production", "sales", "purchasing", "accounting"]).optional(),
  enabled: z.boolean().default(true),
  order: z.number().int().min(0).default(0),
});
export type Module = z.infer<typeof Module>;

/* ------------------------------------------------------------------ workflow */

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
  /** Fields that must be filled before the transition is allowed. */
  requires: z.array(FieldId).optional(),
  /** Extra guard in the expression language. */
  when: Expr.optional(),
  /** Engine action run with the transition, e.g. "post" on an invoice. */
  engineAction: Key.optional(),
});

export const Workflow = z.object({
  states: z.array(WorkflowState).min(2).max(30),
  initial: StateId,
  transitions: z.array(Transition).max(60),
});
export type Workflow = z.infer<typeof Workflow>;

/* -------------------------------------------------------- production stages */

export const QcCheck = z.object({
  id: QcId,
  key: Key,
  label: Label,
  type: z.enum(["number", "boolean", "select", "text"]),
  unit: z.string().max(16).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string().max(60)).max(30).optional(),
  required: z.boolean().default(true),
  /** block: the stage can't complete; flag: completes but raises a QC issue. */
  onFail: z.enum(["block", "flag"]).default("flag"),
});
export type QcCheck = z.infer<typeof QcCheck>;

export const Stage = z.object({
  id: StageId,
  key: Key,
  label: Label,
  /** Resource entity (machine, line, oven) the stage runs on. */
  resource: EntityId.optional(),
  qc: z.array(QcCheck).max(40).optional(),
  /** Scrap can be recorded at this stage. */
  allowsScrap: z.boolean().default(true),
});
export type Stage = z.infer<typeof Stage>;

/* ------------------------------------------------------------------- entity */

export const Entity = z.object({
  id: EntityId,
  key: Key,
  label: Label,
  labelPlural: Label,
  module: ModuleId,
  icon: z.string().max(40).optional(),
  binding: BindingKey.optional(),
  /** Field shown as the record's title in lists, links and search. */
  titleField: FieldId,
  fields: z.array(Field).min(1).max(150),
  workflow: Workflow.optional(),
  /** Ordered production stages; only for production.job bindings. */
  stages: z.array(Stage).max(30).optional(),
  numbering: z
    .object({
      /** e.g. "INV-{yyyy}-{seq:5}" */
      pattern: z.string().min(1).max(60),
    })
    .optional(),
  /** Stock items: track lots and expiry. */
  lots: z.object({ enabled: z.boolean(), expiry: z.boolean().default(false) }).optional(),
});
export type Entity = z.infer<typeof Entity>;

/* -------------------------------------------------------------------- rules */

export const RuleEffect = z.discriminatedUnion("kind", [
  /** Set a field to an expression's value. */
  z.object({ kind: z.literal("set"), field: FieldId, expr: Expr }),
  /** Reject the save with a message when `when` is true. */
  z.object({ kind: z.literal("reject"), message: z.string().min(1).max(200) }),
  /** Warn but allow. */
  z.object({ kind: z.literal("warn"), message: z.string().min(1).max(200) }),
  /** Apply a percentage discount to the document lines. */
  z.object({ kind: z.literal("discount_percent"), expr: Expr }),
  /** Notify roles. */
  z.object({ kind: z.literal("notify"), roles: z.array(RoleId).min(1), message: z.string().min(1).max(200) }),
]);

export const Rule = z.object({
  id: RuleId,
  key: Key,
  label: Label,
  entity: EntityId,
  on: z.array(z.enum(["create", "update", "transition"])).min(1),
  when: Expr.optional(),
  then: RuleEffect,
  enabled: z.boolean().default(true),
  /** Where the rule came from, e.g. "change:chg_19". */
  source: z.string().max(80).optional(),
});
export type Rule = z.infer<typeof Rule>;

/* ---------------------------------------------------------------- approvals */

/**
 * What an approval policy listens to. `entity` and `action` accept "*".
 * action is a workflow transition key, an engine action, or create/update/delete.
 */
export const ActionPattern = z.object({
  entity: z.union([EntityId, z.literal("*")]),
  action: z.union([Key, z.literal("*")]),
});

export const ApprovalStep = z.object({
  id: ApprovalStepId,
  label: Label.optional(),
  roles: z.array(RoleId).min(1),
  /** any: one approver from the roles is enough; all: one from each role. */
  mode: z.enum(["any", "all"]).default("any"),
});

export const ApprovalPolicy = z.object({
  id: ApprovalId,
  key: Key,
  label: Label,
  on: z.array(ActionPattern).min(1),
  /** Condition over the command input, record, actor and channel. Omit for always. */
  when: Expr.optional(),
  /** Steps run in order. */
  steps: z.array(ApprovalStep).min(1).max(5),
  enabled: z.boolean().default(true),
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicy>;

/* -------------------------------------------------------------------- roles */

export const PermissionAction = z.union([
  z.enum(["read", "create", "update", "delete", "export"]),
  /** "transition:mark_ready", "transition:*" */
  z.string().regex(/^transition:(\*|[a-z][a-z0-9_]*)$/),
  /** "action:post", "action:*" */
  z.string().regex(/^action:(\*|[a-z][a-z0-9_]*)$/),
]);

export const RowScope = z.union([
  z.literal("all"),
  /** Records the user created or is assigned to via a user field. */
  z.object({ kind: z.literal("own"), field: FieldId.optional() }),
  /** Any boolean expression; `$user` is the acting member. */
  z.object({ kind: z.literal("expr"), expr: Expr }),
]);

export const Permission = z.object({
  entity: z.union([EntityId, z.literal("*")]),
  actions: z.array(PermissionAction).min(1),
  scope: RowScope.default("all"),
});

export const Role = z.object({
  id: RoleId,
  key: Key,
  label: Label,
  /** Full access, including system changes and approvals. */
  owner: z.boolean().optional(),
  /** May request blueprint changes in the change studio. */
  canChangeSystem: z.boolean().optional(),
  permissions: z.array(Permission).max(200),
});
export type Role = z.infer<typeof Role>;

/* -------------------------------------------------------------------- views */

export const View = z.object({
  id: ViewId,
  entity: EntityId,
  label: Label,
  type: z.enum(["table", "kanban", "calendar", "gallery"]),
  columns: z.array(FieldId).max(20).optional(),
  /** kanban: "status", "stage", or a select/ref field. */
  groupBy: z.union([z.literal("status"), z.literal("stage"), FieldId]).optional(),
  /** calendar: date or datetime field. */
  dateField: FieldId.optional(),
  filter: Expr.optional(),
  sort: z.object({ field: z.union([FieldId, z.literal("updated_at"), z.literal("created_at")]), dir: z.enum(["asc", "desc"]) }).optional(),
  default: z.boolean().optional(),
});
export type View = z.infer<typeof View>;

/* ---------------------------------------------------------------- documents */

export const DocumentTemplate = z.object({
  id: DocumentId,
  key: Key,
  label: Label,
  entity: EntityId,
  template: z.enum(["invoice", "receipt", "delivery_note", "purchase_order", "grn", "job_card", "statement"]),
  /** Extra fields printed on the document. */
  extraFields: z.array(FieldId).max(12).optional(),
  footer: z.string().max(400).optional(),
});

/* ---------------------------------------------------------------- dashboard */

export const BUILTIN_METRICS = [
  "sales_this_month",
  "receivables_overdue",
  "payables_due",
  "cash_position",
  "jobs_in_progress",
  "jobs_late",
  "scrap_pct",
  "scrap_pct_by_resource",
  "yield_pct",
  "stock_below_reorder",
  "stock_value",
  "top_products",
  "orders_due_this_week",
  "qc_failures",
] as const;

export const Widget = z.object({
  id: WidgetId,
  label: Label.optional(),
  size: z.enum(["sm", "md", "lg"]).default("sm"),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("builtin"), metric: z.enum(BUILTIN_METRICS) }),
    z.object({
      kind: z.literal("aggregate"),
      entity: EntityId,
      agg: z.enum(["count", "sum", "avg"]),
      field: FieldId.optional(),
      filter: Expr.optional(),
      period: z.enum(["today", "week", "month", "quarter", "year", "all"]).default("month"),
    }),
  ]),
});
export type Widget = z.infer<typeof Widget>;

/* ---------------------------------------------------------------- blueprint */

export const LayerRef = z.object({ id: z.string().min(1).max(60), version: z.number().int().min(1) });

export const Blueprint = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** Version of this tenant's live blueprint; increments on every applied change. */
  version: z.number().int().min(1),
  base: LayerRef,
  pack: LayerRef.optional(),
  business: Business,
  modules: z.array(Module).min(1).max(40),
  entities: z.array(Entity).min(1).max(120),
  rules: z.array(Rule).max(300).default([]),
  approvals: z.array(ApprovalPolicy).max(100).default([]),
  roles: z.array(Role).min(1).max(40),
  views: z.array(View).max(300).default([]),
  documents: z.array(DocumentTemplate).max(40).default([]),
  dashboard: z.array(Widget).max(24).default([]),
});
export type Blueprint = z.infer<typeof Blueprint>;
export type BlueprintInput = z.input<typeof Blueprint>;
