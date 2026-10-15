import { allSlots } from "./slots";

/**
 * The fixed composite-index catalogue for `records`, deployed once and shared
 * by every tenant and blueprint. Generated into firestore.indexes.json by
 * `pnpm gen:indexes`; never hand-edit that file.
 */
type Order = "ASCENDING" | "DESCENDING";
interface IndexField {
  fieldPath: string;
  order?: Order;
  arrayConfig?: "CONTAINS";
  vectorConfig?: { dimension: number; flat: Record<string, never> };
}
interface Index {
  collectionGroup: string;
  queryScope: "COLLECTION";
  fields: IndexField[];
}

/** Gemini embedding output dimension used for record embeddings. */
export const EMBEDDING_DIMENSION = 768;

const rec = (...fields: IndexField[]): Index => ({ collectionGroup: "records", queryScope: "COLLECTION", fields });
const asc = (fieldPath: string): IndexField => ({ fieldPath, order: "ASCENDING" });
const desc = (fieldPath: string): IndexField => ({ fieldPath, order: "DESCENDING" });

export function buildIndexes() {
  const indexes: Index[] = [];

  // Default list views: newest first, per entity, optionally per status.
  for (const ts of ["updatedAt", "createdAt"]) {
    indexes.push(rec(asc("entityKey"), desc(ts)));
    indexes.push(rec(asc("entityKey"), asc("status"), desc(ts)));
  }

  // Filter or sort on any slot, with and without status.
  for (const slot of allSlots()) {
    const path = `idx.${slot}`;
    indexes.push(rec(asc("entityKey"), asc(path), desc("updatedAt")));
    indexes.push(rec(asc("entityKey"), asc("status"), asc(path), desc("updatedAt")));
    indexes.push(rec(asc("entityKey"), desc(path)));
    indexes.push(rec(asc("entityKey"), asc("status"), desc(path)));
  }

  // Kanban by production stage.
  indexes.push(rec(asc("entityKey"), asc("stage"), desc("updatedAt")));

  // Instant search and reverse reference lookups.
  indexes.push(rec(asc("entityKey"), { fieldPath: "searchTokens", arrayConfig: "CONTAINS" }, desc("updatedAt")));
  indexes.push(rec({ fieldPath: "links", arrayConfig: "CONTAINS" }, asc("entityKey"), desc("updatedAt")));

  // Vector search (findNearest) scoped to an entity.
  indexes.push(rec(asc("entityKey"), { fieldPath: "embedding", vectorConfig: { dimension: EMBEDDING_DIMENSION, flat: {} } }));

  // Approvals inbox and change history.
  const other = (group: string, ...fields: IndexField[]): Index => ({ collectionGroup: group, queryScope: "COLLECTION", fields });
  indexes.push(other("approvals", asc("status"), desc("createdAt")));
  indexes.push(other("audit", asc("recordId"), desc("at")));
  indexes.push(other("audit", asc("actor.id"), desc("at")));
  indexes.push(other("stockMoves", asc("itemId"), desc("at")));
  indexes.push(other("journal", asc("accountIds"), desc("date")));

  return { indexes, fieldOverrides: fieldOverrides() };
}

/** Large fields we never query on; excluding them saves index writes and storage. */
function fieldOverrides() {
  const exempt = (collectionGroup: string, fieldPath: string) => ({ collectionGroup, fieldPath, indexes: [] });
  return [
    exempt("records", "data"),
    exempt("blueprints", "body"),
    exempt("blueprints", "compiled"),
    exempt("changes", "diff"),
    exempt("changes", "preview"),
    exempt("approvals", "envelope"),
    exempt("audit", "before"),
    exempt("audit", "after"),
  ];
}
