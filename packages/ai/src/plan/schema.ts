import { z } from "zod";
import {
  CORE_RECORDS,
  EXTENSION_KEYS,
  INDUSTRY_PRESETS,
  MODULES,
  PERM_ACTIONS,
  SeedOperationType,
  SeedParameter,
  SeedQcTemplate,
  SeedResource,
  type CoreRecordKey,
} from "@shapewise/blueprint";

/**
 * The Blueprint Plan: what the model writes when it designs a business's
 * system. It is deliberately small and refers to everything by key, never by
 * id. Every choice that exists in the catalogue is an enum generated from it,
 * so the model cannot invent a module, extension, field type or permission.
 * Code (assemble.ts) turns a plan into a full, validated blueprint.
 */

const nonEmpty = <T extends string>(xs: readonly T[]) => xs as unknown as [T, ...T[]];

const Key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).describe("snake_case, starting with a letter");
const Label = z.string().min(1).max(60);

export const PlanPreset = z.enum(nonEmpty(INDUSTRY_PRESETS.map((p) => p.key)));
export const PlanModule = z.enum(nonEmpty(MODULES.filter((m) => !m.core).map((m) => m.key)));
/** Submodules that may be hidden (not core, not owned by an extension). */
export const PlanHideable = z.enum(nonEmpty(MODULES.filter((m) => !m.core).flatMap((m) => m.submodules.filter((s) => !s.core && !s.extension).map((s) => s.key))));
export const PlanExtension = z.enum(EXTENSION_KEYS);
/** Core records that accept custom fields. */
export const PlanCustomTarget = z.enum(nonEmpty((Object.keys(CORE_RECORDS) as CoreRecordKey[]).filter((k) => CORE_RECORDS[k].customFields.length > 0)));
export const PlanFieldType = z.enum(["text", "longtext", "integer", "decimal", "money", "quantity", "percent", "date", "datetime", "boolean", "select", "multiselect", "ref", "user", "phone", "email", "url"]);
const Perm = z.enum(PERM_ACTIONS);
const Tone = z.enum(["neutral", "info", "success", "warning", "danger"]);
/** A core record key ("customer") or the key of a record type in this plan. */
const RecordRef = Key.describe("core record key (e.g. customer, item, sales_order) or a recordTypes[].key from this plan");
/** A Shapewise expression, e.g. `total > 500000 and status = 'confirmed'`. */
const Expr = z.string().min(1).max(300).describe("Shapewise expression over the record's field keys");

export const PlanField = z.object({
  key: Key,
  label: Label,
  type: PlanFieldType,
  required: z.boolean(),
  description: z.string().max(160).optional(),
  maxLength: z.number().int().min(1).max(2000).optional().describe("text only"),
  options: z.array(z.object({ value: Key, label: Label })).max(40).optional().describe("select and multiselect only"),
  refTo: RecordRef.optional().describe("ref only: the record type it points at"),
  unit: z.string().max(12).optional().describe("quantity only, e.g. kg, pcs, ml"),
  filterable: z.boolean().optional(),
});
export type PlanField = z.infer<typeof PlanField>;

export const PlanCustomField = PlanField.extend({
  record: PlanCustomTarget,
  part: z.enum(["header", "line"]).describe("line = on each document line; only for documents with lines"),
  showOnDocuments: z.boolean(),
  showInProduction: z.boolean().describe("only meaningful for sales_order lines"),
});
export type PlanCustomField = z.infer<typeof PlanCustomField>;

export const PlanRecordType = z.object({
  key: Key,
  label: Label,
  labelPlural: Label,
  module: z.enum(nonEmpty(MODULES.filter((m) => m.key !== "settings").map((m) => m.key))),
  titleField: Key.describe("key of one of its text fields"),
  numberingPrefix: z.string().regex(/^[A-Z]{2,5}$/).optional(),
  fields: z.array(PlanField).min(1).max(40),
  workflow: z
    .object({
      states: z.array(z.object({ key: Key, label: Label, tone: Tone, terminal: z.boolean().optional() })).min(2).max(12),
      initial: Key,
      transitions: z
        .array(
          z.object({
            key: Key.describe("verb, e.g. start, approve, complete; not create/update/delete"),
            label: Label,
            from: z.array(Key).min(1),
            to: Key,
            permission: z.enum(["edit", "approve", "void", "manage"]),
            requiredFields: z.array(Key).max(10).optional(),
          }),
        )
        .max(20),
    })
    .optional(),
  why: z.string().max(200),
});
export type PlanRecordType = z.infer<typeof PlanRecordType>;

export const PlanRole = z.object({
  key: Key,
  label: Label,
  description: z.string().max(160),
  grants: z
    .array(z.object({ area: z.string().min(1).max(40).describe("submodule key, recordTypes[].key, or * for everything"), actions: z.array(Perm).min(1) }))
    .max(80),
});

export const PlanApproval = z.object({
  label: Label,
  record: RecordRef,
  action: Key.describe("lifecycle action such as post, issue, confirm; or create/update/delete"),
  when: Expr.optional(),
  stages: z
    .array(z.object({ name: Label, minAmount: z.number().min(0), roles: z.array(Key).min(1).describe("role keys"), requireAll: z.boolean() }))
    .min(1)
    .max(4),
  onlyFor: z.array(z.enum(["web", "assistant", "mcp", "import"])).optional().describe("hold only changes from these channels"),
});

export const PlanRule = z.object({
  label: Label,
  record: RecordRef,
  on: z.array(Key).min(1).max(5).describe("create, update or an action key"),
  when: Expr.optional(),
  effect: z.enum(["reject", "warn", "set", "discount_percent", "notify"]),
  message: z.string().max(200).optional().describe("reject, warn, notify"),
  field: Key.optional().describe("set: field to set"),
  value: Expr.optional().describe("set, discount_percent: expression"),
  roles: z.array(Key).optional().describe("notify: role keys"),
});

export const PlanView = z.object({
  record: RecordRef,
  label: Label,
  type: z.enum(["table", "kanban", "calendar"]),
  columns: z.array(Key).max(10).optional(),
  groupBy: Key.optional().describe("kanban: status or a select field"),
  dateField: Key.optional().describe("calendar: a date field"),
  filter: Expr.optional(),
});

const Mode = z.enum(["off", "warn", "block"]);

export const PlanSettings = z.object({
  sales: z.object({ moqMode: Mode.optional(), creditLimitMode: Mode.optional(), defaultPaymentTermsDays: z.number().int().min(0).max(180).optional() }).optional(),
  inventory: z.object({ costingMethod: z.enum(["weighted_average", "fifo"]).optional(), negativeStock: Mode.optional() }).optional(),
  production: z
    .object({
      useOperations: z.boolean().optional(),
      useOutputs: z.boolean().optional(),
      mixModeDefault: z.boolean().optional(),
      qcHoldByDefault: z.boolean().optional(),
      autoNcrOnFail: z.boolean().optional(),
      coaBeforeDispatch: z.boolean().optional(),
    })
    .optional(),
  tax: z.object({ vatRegistered: z.boolean().optional(), ssclRegistered: z.boolean().optional(), wht: z.boolean().optional(), irdTaxInvoice: z.boolean().optional() }).optional(),
});

export const BlueprintPlan = z.object({
  businessName: z.string().min(2).max(120),
  industryDescription: z.string().max(120),
  preset: PlanPreset.describe("the closest starting point"),
  modules: z.array(PlanModule).describe("modules to switch on (Overview, Accounting, Governance and Settings are always on)"),
  hideSubmodules: z.array(PlanHideable).max(30).describe("screens this business doesn't use"),
  extensions: z.array(PlanExtension).describe("optional features to switch on"),
  settings: PlanSettings,
  customFields: z.array(PlanCustomField).max(60),
  recordTypes: z.array(PlanRecordType).max(12).describe("only for things no core record covers"),
  roles: z.array(PlanRole).max(12).describe("roles to add or replace; the preset's owner, manager and accountant stay"),
  approvals: z.array(PlanApproval).max(20),
  rules: z.array(PlanRule).max(30),
  views: z.array(PlanView).max(20),
  seed: z.object({
    resources: z.array(SeedResource).max(60).optional(),
    parameters: z.array(SeedParameter).max(60).optional(),
    operationTypes: z.array(SeedOperationType).max(30).optional(),
    qcTemplates: z.array(SeedQcTemplate).max(15).optional(),
  }),
  assumptions: z.array(z.string().max(200)).max(15).describe("what you assumed, in plain words, for the person to check"),
});
export type BlueprintPlan = z.infer<typeof BlueprintPlan>;
