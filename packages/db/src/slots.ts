import type { Entity, Field } from "@shapewise/blueprint";

/**
 * Typed index slots. Firestore composite indexes are per database, not per
 * tenant, so blueprints never create indexes. Instead the compiler assigns each
 * filterable or sortable field to a fixed slot (`idx.s1`, `idx.n2`, ...), and one
 * catalogue of indexes over (entityKey, status, slot) serves every tenant.
 */
export const SLOT_KINDS = {
  /** text, select, phone, email: normalised lowercase string */
  s: 8,
  /** number, money (minor units), quantity, integer */
  n: 6,
  /** date, datetime: epoch millis */
  d: 6,
  /** ref, user: record id / uid */
  r: 4,
} as const;
export type SlotKind = keyof typeof SLOT_KINDS;
export type Slot = `${SlotKind}${number}`;

export function allSlots(): Slot[] {
  return (Object.keys(SLOT_KINDS) as SlotKind[]).flatMap((k) =>
    Array.from({ length: SLOT_KINDS[k] }, (_, i) => `${k}${i + 1}` as Slot),
  );
}

const KIND_BY_TYPE: Partial<Record<Field["type"], SlotKind>> = {
  text: "s",
  select: "s",
  phone: "s",
  email: "s",
  boolean: "s",
  integer: "n",
  decimal: "n",
  money: "n",
  quantity: "n",
  percent: "n",
  date: "d",
  datetime: "d",
  ref: "r",
  user: "r",
};

export function slotKindFor(field: Field): SlotKind | undefined {
  // Computed fields are materialised on write, so they index like their result.
  return KIND_BY_TYPE[field.type === "computed" ? field.resultType : field.type];
}

export interface SlotAssignment {
  /** field id → slot */
  slots: Record<string, Slot>;
  /** Fields that asked for filter/sort but didn't get a slot (out of slots or unindexable type). */
  overflow: { fieldId: string; reason: "no_slot_kind" | "slots_full" }[];
}

/**
 * Assign slots for one entity. `previous` keeps existing assignments stable
 * across blueprint versions so stored `idx` values never need rewriting just
 * because a field was added or reordered.
 */
export function assignSlots(entity: Entity, previous: Record<string, Slot> = {}): SlotAssignment {
  const slots: Record<string, Slot> = {};
  const overflow: SlotAssignment["overflow"] = [];
  const used = new Set<Slot>();

  const wanted = entity.fields.filter((f) => isIndexed(f));
  const wantedIds = new Set(wanted.map((f) => f.id));

  for (const [fieldId, slot] of Object.entries(previous)) {
    const field = wanted.find((f) => f.id === fieldId);
    if (wantedIds.has(fieldId) && field && slot.startsWith(slotKindFor(field) ?? "?")) {
      slots[fieldId] = slot;
      used.add(slot);
    }
  }

  for (const field of wanted) {
    if (slots[field.id]) continue;
    const kind = slotKindFor(field);
    if (!kind) {
      overflow.push({ fieldId: field.id, reason: "no_slot_kind" });
      continue;
    }
    const free = Array.from({ length: SLOT_KINDS[kind] }, (_, i) => `${kind}${i + 1}` as Slot).find((s) => !used.has(s));
    if (!free) {
      overflow.push({ fieldId: field.id, reason: "slots_full" });
      continue;
    }
    slots[field.id] = free;
    used.add(free);
  }
  return { slots, overflow };
}

function isIndexed(field: Field): boolean {
  const f = field as { filterable?: boolean; sortable?: boolean };
  return Boolean(f.filterable || f.sortable);
}
