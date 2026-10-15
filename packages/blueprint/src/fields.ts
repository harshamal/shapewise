import { z } from "zod";
import { EntityId, Expr, FieldId, Key, Label } from "./ids";
import { CORE_RECORD_KEYS } from "./catalogue/records";

/** A core record type ("customer") or a custom record type ("ent_x7k2"). */
export const Target = z.union([z.enum(CORE_RECORD_KEYS), EntityId]);
export type Target = z.infer<typeof Target>;

/**
 * The field-type catalogue. The runtime, form renderer, import mapper and tool
 * generator all switch on `type`, so adding a type here is a deliberate change
 * to every one of them.
 */
export const FIELD_TYPES = [
  "text",
  "longtext",
  "integer",
  "decimal",
  "money",
  "quantity",
  "percent",
  "date",
  "datetime",
  "boolean",
  "select",
  "multiselect",
  "ref",
  "user",
  "phone",
  "email",
  "url",
  "file",
  "image",
  "computed",
  "lines",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const Tone = z.enum(["neutral", "info", "success", "warning", "danger"]);
export type Tone = z.infer<typeof Tone>;

const fieldBase = {
  id: FieldId,
  key: Key,
  label: Label,
  description: z.string().max(300).optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  /** Indexed so lists can filter on it. Assigned to a typed slot by the compiler. */
  filterable: z.boolean().optional(),
  /** Indexed so lists can sort on it. */
  sortable: z.boolean().optional(),
  /** Included in prefix search tokens and embeddings. */
  searchable: z.boolean().optional(),
  hidden: z.boolean().optional(),
  readonly: z.boolean().optional(),
};

const SelectOption = z.object({
  value: Key,
  label: Label,
  tone: Tone.optional(),
});

const TextField = z.object({ ...fieldBase, type: z.literal("text"), maxLength: z.number().int().min(1).max(2000).optional() });
const LongTextField = z.object({ ...fieldBase, type: z.literal("longtext") });
const IntegerField = z.object({ ...fieldBase, type: z.literal("integer"), min: z.number().int().optional(), max: z.number().int().optional() });
const DecimalField = z.object({
  ...fieldBase,
  type: z.literal("decimal"),
  scale: z.number().int().min(0).max(6).default(2),
  min: z.number().optional(),
  max: z.number().optional(),
});
/** Stored as integer minor units in the business currency. */
const MoneyField = z.object({ ...fieldBase, type: z.literal("money"), min: z.number().optional() });
/** Stored as integer milli-units with a unit code. */
const QuantityField = z.object({
  ...fieldBase,
  type: z.literal("quantity"),
  /** Fixed unit, e.g. "kg"; or take the unit from the referenced item. */
  unit: z.string().max(16).optional(),
  unitFromItem: FieldId.optional(),
});
const PercentField = z.object({ ...fieldBase, type: z.literal("percent") });
const DateField = z.object({ ...fieldBase, type: z.literal("date") });
const DateTimeField = z.object({ ...fieldBase, type: z.literal("datetime") });
const BooleanField = z.object({ ...fieldBase, type: z.literal("boolean") });
const SelectField = z.object({ ...fieldBase, type: z.literal("select"), options: z.array(SelectOption).min(1).max(100) });
const MultiSelectField = z.object({ ...fieldBase, type: z.literal("multiselect"), options: z.array(SelectOption).min(1).max(100) });
const RefField = z.object({ ...fieldBase, type: z.literal("ref"), to: Target });
/** A member of the business (staff user). */
const UserField = z.object({ ...fieldBase, type: z.literal("user") });
const PhoneField = z.object({ ...fieldBase, type: z.literal("phone") });
const EmailField = z.object({ ...fieldBase, type: z.literal("email") });
const UrlField = z.object({ ...fieldBase, type: z.literal("url") });
const FileField = z.object({ ...fieldBase, type: z.literal("file"), multiple: z.boolean().optional() });
const ImageField = z.object({ ...fieldBase, type: z.literal("image"), multiple: z.boolean().optional() });
/** Materialised on write from the expression; never set directly. */
const ComputedField = z.object({
  ...fieldBase,
  type: z.literal("computed"),
  expr: Expr,
  resultType: z.enum(["integer", "decimal", "money", "quantity", "percent", "text", "boolean", "date"]),
});

/** Every field type that may appear as a column inside `lines`. */
export const ScalarField = z.discriminatedUnion("type", [
  TextField,
  LongTextField,
  IntegerField,
  DecimalField,
  MoneyField,
  QuantityField,
  PercentField,
  DateField,
  DateTimeField,
  BooleanField,
  SelectField,
  MultiSelectField,
  RefField,
  UserField,
  PhoneField,
  EmailField,
  UrlField,
  FileField,
  ImageField,
  ComputedField,
]);
export type ScalarField = z.infer<typeof ScalarField>;

/** Line items (order lines, BOM inputs). One level deep; lines cannot nest. */
const LinesField = z.object({
  ...fieldBase,
  type: z.literal("lines"),
  /** The record each line points at, usually "item". */
  item: Target.optional(),
  columns: z.array(ScalarField).min(1).max(30),
});

export const Field = z.discriminatedUnion("type", [
  TextField,
  LongTextField,
  IntegerField,
  DecimalField,
  MoneyField,
  QuantityField,
  PercentField,
  DateField,
  DateTimeField,
  BooleanField,
  SelectField,
  MultiSelectField,
  RefField,
  UserField,
  PhoneField,
  EmailField,
  UrlField,
  FileField,
  ImageField,
  ComputedField,
  LinesField,
]);
export type Field = z.infer<typeof Field>;
