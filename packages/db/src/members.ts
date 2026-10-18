import { createHash, randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { tenantPaths, userPath } from "./paths";

/**
 * The people in a workspace and the invitations to join it. Invitations are
 * links: the token is shown once to whoever creates it and only its hash is
 * stored, so a leaked database export can't be used to join. An invitation
 * names an email; only someone signed in with that email can accept it.
 */

export interface Member {
  uid: string;
  roleKey: string;
  email?: string | null;
  name?: string | null;
  joinedAt?: string;
}

export interface Invite {
  id: string;
  email: string;
  roleKey: string;
  invitedBy: string;
  invitedByName?: string | null;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "accepted" | "revoked";
  acceptedBy?: string;
}

export class TeamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamError";
  }
}

const INVITE_DAYS = 14;
const hash = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 40);
const norm = (email: string) => email.trim().toLowerCase();

export async function listMembers(db: Firestore, tid: string): Promise<Member[]> {
  const snap = await db.collection(tenantPaths(tid).collection("members")).get();
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<Member, "uid">) })).sort((a, b) => String(a.name ?? a.email ?? "").localeCompare(String(b.name ?? b.email ?? "")));
}

export async function listInvites(db: Firestore, tid: string): Promise<Invite[]> {
  const snap = await db.collection(tenantPaths(tid).collection("invites")).where("status", "==", "pending").get();
  const now = new Date().toISOString();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Invite, "id">) })).filter((i) => i.expiresAt > now);
}

/** Creates an invitation and returns its one-time token (to build the join link). */
export async function createInvite(db: Firestore, tid: string, input: { email: string; roleKey: string; invitedBy: string; invitedByName?: string | null }): Promise<{ id: string; token: string; expiresAt: string }> {
  const email = norm(input.email);
  const members = await listMembers(db, tid);
  if (members.some((m) => m.email && norm(m.email) === email)) throw new TeamError(`${email} is already in this workspace.`);
  // A new invitation for the same email replaces any earlier one.
  const earlier = await db.collection(tenantPaths(tid).collection("invites")).where("email", "==", email).where("status", "==", "pending").get();
  const token = randomBytes(24).toString("base64url");
  const id = hash(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString();
  const batch = db.batch();
  earlier.docs.forEach((d) => batch.update(d.ref, { status: "revoked" }));
  batch.set(db.doc(tenantPaths(tid).doc("invites", id)), { email, roleKey: input.roleKey, invitedBy: input.invitedBy, invitedByName: input.invitedByName ?? null, createdAt: now.toISOString(), expiresAt, status: "pending" });
  await batch.commit();
  return { id, token, expiresAt };
}

export async function revokeInvite(db: Firestore, tid: string, id: string): Promise<void> {
  await db.doc(tenantPaths(tid).doc("invites", id)).update({ status: "revoked" });
}

/** The invitation behind a join link, if it's still good. */
export async function findInvite(db: Firestore, tid: string, token: string): Promise<Invite | null> {
  const snap = await db.doc(tenantPaths(tid).doc("invites", hash(token))).get();
  if (!snap.exists) return null;
  const inv = { id: snap.id, ...(snap.data() as Omit<Invite, "id">) };
  return inv.status === "pending" && inv.expiresAt > new Date().toISOString() ? inv : null;
}

/**
 * Accepts an invitation for the signed-in person: they must be signed in with
 * the invited email. Records the membership and marks the invitation used,
 * in one transaction. Returns the role they now have.
 */
export async function acceptInvite(db: Firestore, tid: string, token: string, user: { uid: string; email?: string | null; name?: string | null }, workspaceName: string): Promise<string> {
  const ref = db.doc(tenantPaths(tid).doc("invites", hash(token)));
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new TeamError("This invitation link isn't valid.");
    const inv = snap.data() as Omit<Invite, "id">;
    if (inv.status !== "pending") throw new TeamError(inv.status === "accepted" ? "This invitation has already been used." : "This invitation was withdrawn.");
    if (inv.expiresAt <= new Date().toISOString()) throw new TeamError("This invitation has expired. Ask for a new one.");
    if (!user.email || norm(user.email) !== inv.email) throw new TeamError(`This invitation is for ${inv.email}. Sign in with that email to accept it.`);
    const memberRef = db.doc(tenantPaths(tid).doc("members", user.uid));
    const existing = await t.get(memberRef);
    const userRef = db.doc(userPath(user.uid));
    const userDoc = await t.get(userRef);
    const now = new Date().toISOString();
    // Someone already in the workspace keeps their role; the invitation is simply used up.
    const roleKey = existing.exists ? String(existing.data()!.roleKey) : inv.roleKey;
    if (!existing.exists) t.set(memberRef, { uid: user.uid, roleKey, email: norm(user.email), name: user.name ?? null, joinedAt: now, invitedBy: inv.invitedBy });
    const tenants = { ...((userDoc.data()?.tenants as Record<string, unknown>) ?? {}), [tid]: { name: workspaceName, roleKey } };
    t.set(userRef, { tenants, updatedAt: now }, { merge: true });
    t.update(ref, { status: "accepted", acceptedBy: user.uid, acceptedAt: now });
    return roleKey;
  });
}

/** Changes someone's role, or removes them (roleKey null). The last owner can't be demoted or removed. */
export async function setMemberRole(db: Firestore, tid: string, uid: string, roleKey: string | null, ownerKeys: readonly string[], workspaceName: string): Promise<void> {
  await db.runTransaction(async (t) => {
    const all = await t.get(db.collection(tenantPaths(tid).collection("members")));
    const me = all.docs.find((d) => d.id === uid);
    if (!me) throw new TeamError("That person isn't in this workspace.");
    const owners = all.docs.filter((d) => ownerKeys.includes(String(d.data().roleKey)));
    const losingOwner = ownerKeys.includes(String(me.data().roleKey)) && (roleKey === null || !ownerKeys.includes(roleKey));
    if (losingOwner && owners.length <= 1) throw new TeamError("Every workspace needs an owner. Make someone else the owner first.");
    const userRef = db.doc(userPath(uid));
    const userDoc = await t.get(userRef);
    const tenants = { ...((userDoc.data()?.tenants as Record<string, unknown>) ?? {}) };
    if (roleKey === null) {
      t.delete(me.ref);
      delete tenants[tid];
    } else {
      t.update(me.ref, { roleKey, updatedAt: new Date().toISOString() });
      tenants[tid] = { name: workspaceName, roleKey };
    }
    t.set(userRef, { tenants, updatedAt: new Date().toISOString() }, { merge: true });
  });
}
