/**
 * Firestore layout. Every tenant path is built from `tenantPaths(tid)`, so a
 * path into another tenant cannot be assembled from user input: the tenant id
 * comes from the verified token, and ids are checked before they reach a path.
 *
 * tenants/{tid}                       name, currency, locale, timezone, activeBlueprintVersion
 *   members/{uid}                     roleKey
 *   blueprints/{version}              immutable blueprint body + compiled metadata
 *   records/{rid}                     entityKey, data, idx, status, version, links[], searchTokens[], embedding
 *   accounts/{aid}                    chart of accounts
 *   journal/{jid}                     balanced entry, lines embedded (append only)
 *   stockMoves/{mid}                  append only
 *   stockLevels/{itemId}              on-hand projection, same transaction as the move
 *   sequences/{docKey}                gap-free counters
 *   approvals/{id}                    parked commands
 *   audit/{id}                        append only
 *   rollups/{metric_yyyymmdd}         dashboard aggregates
 *   changes/{id}                      change requests: diff, preview, status, undo pointer
 *   jobs/{id}                         import / generation progress
 *   outbox/{id}                       side effects relayed after commit
 * mcpTokens/{sha256}                  tenantId, roleKey, label, revoked
 */

export const TENANT_COLLECTIONS = [
  "members",
  "blueprints",
  "records",
  "accounts",
  "journal",
  "stockMoves",
  "stockLevels",
  "sequences",
  "approvals",
  "audit",
  "rollups",
  "changes",
  "jobs",
  "outbox",
  /** Idempotency results, keyed by a hash of actor + idempotency key. */
  "results",
] as const;
export type TenantCollection = (typeof TENANT_COLLECTIONS)[number];

/** Collections only the server engines append to; never updated or deleted. */
export const APPEND_ONLY: readonly TenantCollection[] = ["journal", "stockMoves", "audit"];

/** Document id: Firestore-safe, no slashes, no "." or ".." and no reserved __names__. */
const DOC_ID = /^(?!\.\.?$)(?!__.*__$)[A-Za-z0-9_\-.:]{1,128}$/;

export class InvalidPathSegment extends Error {
  constructor(readonly segment: string) {
    super(`Invalid document id: ${JSON.stringify(segment)}`);
    this.name = "InvalidPathSegment";
  }
}

export function assertDocId(id: string): string {
  if (!DOC_ID.test(id)) throw new InvalidPathSegment(id);
  return id;
}

export interface TenantPaths {
  tenant: string;
  collection(name: TenantCollection): string;
  doc(name: TenantCollection, id: string): string;
}

export function tenantPaths(tid: string): TenantPaths {
  const tenant = `tenants/${assertDocId(tid)}`;
  return {
    tenant,
    collection: (name) => `${tenant}/${name}`,
    doc: (name, id) => `${tenant}/${name}/${assertDocId(id)}`,
  };
}

export const mcpTokenPath = (sha256Hex: string) => {
  if (!/^[a-f0-9]{64}$/.test(sha256Hex)) throw new InvalidPathSegment(sha256Hex);
  return `mcpTokens/${sha256Hex}`;
};

/** users/{uid}: the workspaces a person belongs to, for the home screen. Server only. */
export const userPath = (uid: string) => `users/${assertDocId(uid)}`;

/** Blueprint docs are keyed by zero-padded version so they sort lexically. */
export const blueprintDocId = (version: number) => String(version).padStart(6, "0");

/** Rollup docs: one per metric per day, e.g. "sales_this_month_20261016". */
export const rollupDocId = (metric: string, date: Date) =>
  `${metric}_${date.toISOString().slice(0, 10).replaceAll("-", "")}`;
