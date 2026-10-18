import type { Firestore } from "firebase-admin/firestore";
import { Blueprint } from "@shapewise/blueprint";
import { blueprintDocId, tenantPaths } from "./paths";

/**
 * Change requests from the change studio: a drafted change (the setup it
 * would produce, described in plain words), waiting for approval, applied or
 * rejected. Applying saves the drafted setup as the next blueprint version;
 * the history of versions is what undo goes back through.
 */

export interface ChangeDoc {
  id: string;
  status: "draft" | "pending" | "applied" | "rejected";
  request: string;
  summary: string;
  lines: string[];
  notes: string[];
  /** The setup version the draft was built on; applying refuses if the setup moved since. */
  baseVersion: number;
  body: Blueprint;
  by: string;
  byName?: string | null;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  appliedVersion?: number;
}

const col = (tid: string) => tenantPaths(tid).collection("changes");

export async function saveChange(db: Firestore, tid: string, doc: Omit<ChangeDoc, "id">): Promise<string> {
  const ref = db.collection(col(tid)).doc();
  await ref.set(doc);
  return ref.id;
}

export async function getChange(db: Firestore, tid: string, id: string): Promise<ChangeDoc | null> {
  const snap = await db.doc(`${col(tid)}/${id}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as Omit<ChangeDoc, "id">;
  return { id: snap.id, ...data, body: Blueprint.parse(data.body) };
}

export async function updateChange(db: Firestore, tid: string, id: string, patch: Partial<Omit<ChangeDoc, "id" | "body">>): Promise<void> {
  await db.doc(`${col(tid)}/${id}`).update(patch);
}

/** Recent changes, newest first, without the setup bodies. */
export async function listChanges(db: Firestore, tid: string, limit = 30): Promise<Omit<ChangeDoc, "body">[]> {
  const snap = await db.collection(col(tid)).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => {
    const { body: _b, ...rest } = d.data() as Omit<ChangeDoc, "id">;
    return { id: d.id, ...rest };
  });
}

export interface VersionInfo {
  version: number;
  summary: string;
  createdAt: string;
  createdBy: string;
}

/** The setup's versions, newest first. */
export async function blueprintHistory(db: Firestore, tid: string, limit = 20): Promise<VersionInfo[]> {
  const snap = await db.collection(tenantPaths(tid).collection("blueprints")).orderBy("version", "desc").limit(limit).get();
  return snap.docs.map((d) => {
    const x = d.data();
    return { version: Number(x.version), summary: String(x.summary ?? ""), createdAt: String(x.createdAt ?? ""), createdBy: String(x.createdBy ?? "") };
  });
}

export async function loadBlueprintVersion(db: Firestore, tid: string, version: number): Promise<Blueprint | null> {
  const snap = await db.doc(`${tenantPaths(tid).collection("blueprints")}/${blueprintDocId(version)}`).get();
  return snap.exists ? Blueprint.parse(snap.data()!.body) : null;
}
