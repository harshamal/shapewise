import { CORE_RECORDS, type CoreRecordKey, type CustomField, type Entity, type Field, type FieldType } from "@shapewise/blueprint";

/**
 * Typed index slots. Firestore composite indexes are per database, not per
 * tenant, so blueprints never create indexes. Instead the compiler assigns each
 * indexed field to a fixed slot (`idx.s1`, `idx.n2`, ...), and one catalogue of
 * indexes over (entityKey, status, slot) serves every tenant.
 *
 * Core records' own indexed fields take slots first, in catalogue order, so
 * they are the same in every tenant; custom fields fill the rest.
 */
export const SLOT_KINDS = {
  /** text, select, phone, email, boolean: normalised lowercase string */
  s: 8,
  /** integer, decimal, money (minor units), quantity, percent */
  n: 6,
  /** date, datetime: epoch millis */
  d: 6,
  /** ref, user: record id / uid */
  r: 6,
} as const;
export type SlotKind = keyof typeof SLOT_KINDS;
export type Slot = `${SlotKind}${number}`;

export function allSlots(): Slot[] {
  return (Object.keys(SLOT_KINDS) as SlotKind[]).flatMap((k) =>
    Array.from({ length: SLOT_KINDS[k] }, (_, i) => `${k}${i + 1}` as Slot),
  );
}

const KIND_BY_TYPE: Partial<Record<FieldType, SlotKind>> = {
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

/** A field that wants an index slot, addressed by core key or custom field id. */
export interface Indexable {
  id: string;
  type: FieldType;
}

export function slotKindFor(type: FieldType): SlotKind | undefined {
  return KIND_BY_TYPE[type];
}

export interface SlotAssignment {
  /** field key or id → slot */
  slots: Record<string, Slot>;
  /** Fields that wanted an index but didn't get one. */
  overflow: { fieldId: string; reason: "no_slot_kind" | "slots_full" }[];
}

/**
 * Assign slots. `previous` keeps existing assignments stable across blueprint
 * versions, so stored `idx` values never need rewriting just because a field
 * was added or reordered.
 */
export function assignSlots(wanted: readonly Indexable[], previous: Record<string, Slot> = {}): SlotAssignment {
  const slots: Record<string, Slot> = {};
  const overflow: SlotAssignment["overflow"] = [];
  const used = new Set<Slot>();
  const byId = new Map(wanted.map((f) => [f.id, f]));

  for (const [id, slot] of Object.entries(previous)) {
    const field = byId.get(id);
    const kind = field && slotKindFor(field.type);
    if (kind && slot.startsWith(kind) && !used.has(slot)) {
      slots[id] = slot;
      used.add(slot);
    }
  }

  for (const field of wanted) {
    if (slots[field.id]) continue;
    const kind = slotKindFor(field.type);
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

const indexedField = (f: Field): f is Field => Boolean(f.filterable || f.sortable);
const typeOf = (f: Field): FieldType => (f.type === "computed" ? f.resultType : f.type);

/** Slots for a core record: its indexed catalogue fields, then indexed custom header fields. */
export function slotsForCore(record: CoreRecordKey, customFields: readonly CustomField[], previous: Record<string, Slot> = {}): SlotAssignment {
  const core: Indexable[] = CORE_RECORDS[record].fields.filter((f) => f.indexed).map((f) => ({ id: f.key, type: f.type }));
  const custom: Indexable[] = customFields
    .filter((c) => c.target === record && c.part === "header" && indexedField(c.field))
    .map((c) => ({ id: c.field.id, type: typeOf(c.field) }));
  // Core fields are reserved up front so they never move; a stale previous
  // assignment can never take a core field's slot.
  const reserved = assignSlots(core).slots;
  const taken = new Set(Object.values(reserved));
  const kept = Object.fromEntries(Object.entries(previous).filter(([id, slot]) => !(id in reserved) && !taken.has(slot)));
  return assignSlots([...core, ...custom], { ...reserved, ...kept });
}

/** Slots for a custom record type's filterable and sortable fields. */
export function slotsForEntity(entity: Entity, previous: Record<string, Slot> = {}): SlotAssignment {
  return assignSlots(entity.fields.filter(indexedField).map((f) => ({ id: f.id, type: typeOf(f) })), previous);
}
