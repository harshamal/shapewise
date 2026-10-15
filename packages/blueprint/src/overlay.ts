import { z } from "zod";
import { Label } from "./ids";

/**
 * Overlays are how industry packs and each business's customisations are stored:
 * an ordered list of operations applied on top of the base blueprint, addressed
 * by stable IDs. The live blueprint is merge(base, pack, customisations), then
 * validated. Because overlays are not copies, improvements to the base reach
 * every business on the next merge.
 */
export const ELEMENT_KINDS = [
  "module",
  "entity",
  "field",
  "column",
  "state",
  "transition",
  "stage",
  "qc",
  "rule",
  "approval",
  "approval_step",
  "role",
  "permission",
  "view",
  "document",
  "widget",
] as const;
export const ElementKind = z.enum(ELEMENT_KINDS);
export type ElementKind = z.infer<typeof ElementKind>;

/** Any element ID (prefix_suffix). Kind-specific checks happen in the merger. */
const AnyId = z.string().regex(/^[a-z]{2,3}_[a-z0-9]{2,24}$/);

/** Element body; validated against the kind's schema when merged. */
const Value = z.record(z.string(), z.unknown());

export const OverlayOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    kind: ElementKind,
    /** Parent element: entity for fields/states/stages, field for columns, stage for qc, approval for steps, role for permissions. Omit for top-level kinds. */
    parent: AnyId.optional(),
    /** Insert after this sibling; omit to append. */
    after: AnyId.optional(),
    value: Value,
  }),
  z.object({
    op: z.literal("update"),
    id: AnyId,
    /** Shallow patch of the element's properties. `id` cannot be changed. */
    patch: Value,
  }),
  z.object({ op: z.literal("remove"), id: AnyId }),
  z.object({ op: z.literal("set_enabled"), id: AnyId, enabled: z.boolean() }),
  z.object({ op: z.literal("move"), id: AnyId, after: AnyId.nullable() }),
  z.object({ op: z.literal("set_business"), patch: Value }),
]);
export type OverlayOp = z.infer<typeof OverlayOp>;

export const Overlay = z.object({
  id: z.string().regex(/^ovl_[a-z0-9]{4,24}$/),
  layer: z.enum(["pack", "custom"]),
  /** Plain-language summary shown in version history. */
  summary: Label.or(z.string().max(200)),
  ops: z.array(OverlayOp).min(1).max(500),
  /** Who asked: a member uid, "agent:<token label>", or "system". */
  author: z.string().min(1).max(120),
  /** The change request that produced it, if any. */
  changeId: z.string().max(60).optional(),
  createdAt: z.string().datetime(),
});
export type Overlay = z.infer<typeof Overlay>;
