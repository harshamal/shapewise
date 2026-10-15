import { z } from "zod";
import { PermAction } from "./catalogue/actions";
import { ExtensionKey } from "./catalogue/extensions";
import { RowScope } from "./schema";
import { Key, Label, RoleId } from "./ids";

/**
 * Overlays are how changes are stored: an ordered list of small operations
 * applied to a blueprint. The change studio (plain-language changes), industry
 * presets and undo all produce overlays, so every change is a readable diff
 * that can be previewed, validated and reversed.
 *
 * Catalogue things (modules, submodules, extensions, settings) are addressed
 * by key; things the business created are addressed by their stable id.
 */

/** Collections of id-addressed elements. */
export const COLLECTIONS = [
  "customModules",
  "customFields",
  "entities",
  /** parent: entity id */
  "fields",
  /** parent: entity id */
  "states",
  /** parent: entity id */
  "transitions",
  "rules",
  "approvals",
  /** parent: approval id */
  "approvalStages",
  "roles",
  "views",
  "documents",
  "dashboard",
] as const;
export const Collection = z.enum(COLLECTIONS);
export type Collection = z.infer<typeof Collection>;

/** Any element id (prefix_suffix). */
const ElementId = z.string().regex(/^[a-z]{2,3}_[a-z0-9]{2,24}$/);

/** Element body; checked against the collection's schema when applied. */
const Value = z.record(z.string(), z.unknown());

/** Dotted settings path, e.g. "sales.moqMode". */
const SettingPath = z.string().regex(/^[a-z]+\.[a-zA-Z]+$/);

const SEED_KINDS = ["units", "itemClasses", "warehouses", "resources", "parameters", "operationTypes", "qcTemplates"] as const;

export const OverlayOp = z.discriminatedUnion("op", [
  /* catalogue configuration */
  z.object({ op: z.literal("set_module"), key: Key, enabled: z.boolean().optional(), label: Label.nullable().optional(), order: z.number().int().optional() }),
  z.object({ op: z.literal("set_submodule"), key: Key, enabled: z.boolean().optional(), label: Label.nullable().optional(), order: z.number().int().optional() }),
  z.object({ op: z.literal("set_extension"), key: ExtensionKey, enabled: z.boolean() }),
  z.object({ op: z.literal("set_setting"), path: SettingPath, value: z.unknown() }),
  z.object({ op: z.literal("set_business"), patch: Value }),
  /** Replace a role's grant on one target; an empty action list removes it. */
  z.object({ op: z.literal("set_grant"), role: RoleId, target: z.union([z.literal("*"), Key]), actions: z.array(PermAction).max(8), scope: RowScope.optional() }),
  /** Append starter data (never overwrites existing rows). */
  z.object({ op: z.literal("add_seed"), kind: z.enum(SEED_KINDS), value: Value }),

  /* id-addressed elements */
  z.object({
    op: z.literal("add"),
    collection: Collection,
    /** Entity for fields/states/transitions, approval for approvalStages. */
    parent: ElementId.optional(),
    /** Insert after this sibling; omit to append. */
    after: ElementId.optional(),
    value: Value,
  }),
  /** Shallow patch. `id` cannot change. */
  z.object({ op: z.literal("update"), id: ElementId, patch: Value }),
  z.object({ op: z.literal("remove"), id: ElementId }),
  z.object({ op: z.literal("move"), id: ElementId, after: ElementId.nullable() }),
]);
export type OverlayOp = z.infer<typeof OverlayOp>;

export const Overlay = z.object({
  id: z.string().regex(/^ovl_[a-z0-9]{4,24}$/),
  layer: z.enum(["preset", "custom"]),
  /** Plain-language summary for version history. */
  summary: z.string().min(1).max(200),
  ops: z.array(OverlayOp).min(1).max(500),
  /** A member uid, "agent:<token label>", or "system". */
  author: z.string().min(1).max(120),
  changeId: z.string().max(60).optional(),
  createdAt: z.iso.datetime(),
});
export type Overlay = z.infer<typeof Overlay>;
