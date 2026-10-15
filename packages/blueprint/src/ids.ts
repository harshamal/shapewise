import { z } from "zod";

/**
 * Every blueprint element has a stable ID that never changes, plus a human key
 * and label that can. References inside a blueprint always use IDs, so renames
 * are metadata-only and never touch stored data.
 */
export const ID_PREFIXES = {
  module: "mod",
  entity: "ent",
  field: "fld",
  state: "st",
  transition: "tr",
  stage: "stg",
  qc: "qc",
  rule: "rul",
  approval: "apr",
  approvalStep: "aps",
  role: "rol",
  view: "vw",
  document: "doc",
  widget: "wdg",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const idPattern = (prefix: string) => new RegExp(`^${prefix}_[a-z0-9]{2,24}$`);

export const idOf = <K extends IdKind>(kind: K) =>
  z
    .string()
    .regex(idPattern(ID_PREFIXES[kind]), `Expected a ${kind} id like "${ID_PREFIXES[kind]}_x7k2"`);

export const ModuleId = idOf("module");
export const EntityId = idOf("entity");
export const FieldId = idOf("field");
export const StateId = idOf("state");
export const TransitionId = idOf("transition");
export const StageId = idOf("stage");
export const QcId = idOf("qc");
export const RuleId = idOf("rule");
export const ApprovalId = idOf("approval");
export const ApprovalStepId = idOf("approvalStep");
export const RoleId = idOf("role");
export const ViewId = idOf("view");
export const DocumentId = idOf("document");
export const WidgetId = idOf("widget");

/** snake_case key used in tool names, URLs and expressions. */
export const Key = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/, "Expected a snake_case key starting with a letter");

export const Label = z.string().trim().min(1).max(80);

/**
 * Expressions are written in Shapewise's own safe expression language and
 * parsed + type-checked by the validator. Here they are only bounded strings.
 */
export const Expr = z.string().trim().min(1).max(500);

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Generates a new ID for a blueprint element. Not cryptographic; uniqueness is checked by the validator. */
export function newId(kind: IdKind, random: () => number = Math.random): string {
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `${ID_PREFIXES[kind]}_${suffix}`;
}
