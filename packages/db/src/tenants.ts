import type { Firestore } from "firebase-admin/firestore";
import { Blueprint } from "@shapewise/blueprint";
import { assertDocId, blueprintDocId, tenantPaths, userPath } from "./paths";
import { workspaceIdProblem } from "./workspace-id";

/**
 * Workspaces (tenants), their versioned blueprints and memberships.
 *
 *   tenants/{tid}                     name, currency, timezone, activeBlueprintVersion
 *   tenants/{tid}/blueprints/{000001} immutable blueprint body per version
 *   tenants/{tid}/members/{uid}       roleKey, email, name
 *   users/{uid}                       tenants: { tid: { name, roleKey } } for the home screen
 */

export class WorkspaceIdTaken extends Error {
  constructor(readonly id: string) {
    super(`The address "${id}" is already taken.`);
    this.name = "WorkspaceIdTaken";
  }
}

export class BlueprintConflict extends Error {
  constructor() {
    super("The setup was changed by someone else a moment ago. Reload and try again.");
    this.name = "BlueprintConflict";
  }
}

export interface TenantDoc {
  name: string;
  currency: string;
  timezone: string;
  activeBlueprintVersion: number;
  preset?: string;
  createdAt: string;
  createdBy: string;
}

export interface Owner {
  uid: string;
  email?: string;
  name?: string;
}

/** Create a workspace with its first blueprint and its owner, atomically. */
export async function createTenant(db: Firestore, tid: string, bp: Blueprint, owner: Owner): Promise<void> {
  const problem = workspaceIdProblem(tid);
  if (problem) throw new Error(problem);
  const p = tenantPaths(tid);
  const ownerRole = bp.roles.find((r) => r.owner)?.key;
  if (!ownerRole) throw new Error("The blueprint has no owner role.");
  const now = new Date().toISOString();

  await db.runTransaction(async (t) => {
    const tenantRef = db.doc(p.tenant);
    if ((await t.get(tenantRef)).exists) throw new WorkspaceIdTaken(tid);
    const userRef = db.doc(userPath(owner.uid));
    const user = await t.get(userRef);

    const doc: TenantDoc = {
      name: bp.business.name,
      currency: bp.business.currency,
      timezone: bp.business.timezone,
      activeBlueprintVersion: bp.version,
      preset: bp.preset?.id,
      createdAt: now,
      createdBy: owner.uid,
    };
    t.set(tenantRef, doc);
    t.set(db.doc(`${p.collection("blueprints")}/${blueprintDocId(bp.version)}`), { version: bp.version, body: bp, createdAt: now, createdBy: owner.uid, summary: `Created from the ${bp.preset?.id ?? "custom"} preset` });
    t.set(db.doc(p.doc("members", owner.uid)), { uid: owner.uid, roleKey: ownerRole, email: owner.email ?? null, name: owner.name ?? null, joinedAt: now });
    const tenants = { ...((user.data()?.tenants as Record<string, unknown>) ?? {}), [tid]: { name: bp.business.name, roleKey: ownerRole } };
    t.set(userRef, { tenants, updatedAt: now }, { merge: true });
  });
}

const parsed = new Map<string, { version: number; bp: Blueprint }>();

/**
 * The active blueprint of a workspace, or null if it doesn't exist. Parsed
 * blueprints are cached per version, so the compiled form stays cached too.
 */
export async function loadBlueprint(db: Firestore, tid: string): Promise<{ tenant: TenantDoc; bp: Blueprint } | null> {
  assertDocId(tid);
  const p = tenantPaths(tid);
  const snap = await db.doc(p.tenant).get();
  if (!snap.exists) return null;
  const tenant = snap.data() as TenantDoc;
  const hit = parsed.get(tid);
  if (hit && hit.version === tenant.activeBlueprintVersion) return { tenant, bp: hit.bp };
  const bpSnap = await db.doc(`${p.collection("blueprints")}/${blueprintDocId(tenant.activeBlueprintVersion)}`).get();
  if (!bpSnap.exists) throw new Error(`Workspace ${tid} is missing blueprint version ${tenant.activeBlueprintVersion}.`);
  const bp = Blueprint.parse(bpSnap.data()!.body);
  parsed.set(tid, { version: bp.version, bp });
  return { tenant, bp };
}

/**
 * Save a new blueprint version and make it active. Refused if the active
 * version moved since `bp` was derived from it (optimistic locking).
 */
export async function saveBlueprint(db: Firestore, tid: string, bp: Blueprint, by: string, summary: string): Promise<void> {
  const p = tenantPaths(tid);
  await db.runTransaction(async (t) => {
    const ref = db.doc(p.tenant);
    const snap = await t.get(ref);
    if (!snap.exists) throw new Error("That workspace doesn't exist.");
    if ((snap.data() as TenantDoc).activeBlueprintVersion !== bp.version - 1) throw new BlueprintConflict();
    const now = new Date().toISOString();
    t.set(db.doc(`${p.collection("blueprints")}/${blueprintDocId(bp.version)}`), { version: bp.version, body: bp, createdAt: now, createdBy: by, summary });
    t.update(ref, { activeBlueprintVersion: bp.version, name: bp.business.name, timezone: bp.business.timezone });
  });
  parsed.set(tid, { version: bp.version, bp });
}

/** A person's role in a workspace, read from its members collection. */
export async function memberRole(db: Firestore, tid: string, uid: string): Promise<string | null> {
  const snap = await db.doc(tenantPaths(tid).doc("members", uid)).get();
  return snap.exists ? ((snap.data()!.roleKey as string) ?? null) : null;
}

/** The workspaces a person belongs to, newest first. */
export async function userWorkspaces(db: Firestore, uid: string): Promise<{ id: string; name: string; roleKey: string }[]> {
  const snap = await db.doc(userPath(uid)).get();
  const tenants = (snap.data()?.tenants ?? {}) as Record<string, { name: string; roleKey: string }>;
  return Object.entries(tenants).map(([id, v]) => ({ id, name: v.name, roleKey: v.roleKey }));
}

/** How many members hold a role, so a role still in use isn't removed from under them. */
export async function membersWithRole(db: Firestore, tid: string, roleKey: string): Promise<number> {
  const snap = await db.collection(tenantPaths(tid).collection("members")).where("roleKey", "==", roleKey).limit(50).get();
  return snap.size;
}
