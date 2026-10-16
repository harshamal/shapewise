import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { ApprovalDoc, AuditEntry, ReadTx, Store, StoredRecord, WriteTx } from "@shapewise/runtime";
import { tenantPaths } from "./paths";

/**
 * The command pipeline's store on Firestore.
 *
 * Every record lives in tenants/{tid}/records/{id} with an `entityKey`, so a
 * blueprint change never needs a new collection. A command runs inside one
 * Firestore transaction; its writes are buffered and applied at the end,
 * which satisfies Firestore's reads-before-writes rule while still letting
 * the pipeline read what it just wrote. Firestore retries the whole command
 * on contention, so handlers stay side-effect free until commit.
 */
export class FirestoreStore implements Store {
  constructor(private readonly db: Firestore) {}

  async read<T>(tid: string, fn: (tx: ReadTx) => Promise<T>): Promise<T> {
    return fn(new Reader(this.db, tid));
  }

  async write<T>(tid: string, fn: (tx: WriteTx) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (t) => {
      const w = new Writer(this.db, tid, t);
      const out = await fn(w);
      w.commit();
      return out;
    });
  }

  async listApprovals(tid: string, status?: ApprovalDoc["status"]): Promise<ApprovalDoc[]> {
    const col = this.db.collection(tenantPaths(tid).collection("approvals"));
    const snap = await (status ? col.where("status", "==", status) : col).orderBy("createdAt", "desc").limit(200).get();
    return snap.docs.map((d) => d.data() as ApprovalDoc);
  }

  async listAudit(tid: string, filter: { target?: string; recordId?: string; limit?: number } = {}): Promise<AuditEntry[]> {
    let q: FirebaseFirestore.Query = this.db.collection(tenantPaths(tid).collection("audit"));
    if (filter.recordId) q = q.where("recordId", "==", filter.recordId);
    else if (filter.target) q = q.where("target", "==", filter.target);
    const snap = await q.orderBy("at", "desc").limit(filter.limit ?? 50).get();
    return snap.docs.map((d) => d.data() as AuditEntry);
  }
}

/* --------------------------------------------------------------------------- */

const toStored = (data: FirebaseFirestore.DocumentData): StoredRecord => {
  const { entityKey, idx: _idx, searchTokens: _s, ...rest } = data;
  return { ...(rest as Omit<StoredRecord, "target">), target: entityKey as string };
};

/** Searchable prefixes of a record's title and number, lower-cased. */
function searchTokens(rec: StoredRecord): string[] {
  const words = [rec.number, rec.data.name, rec.data.title, rec.data.code, rec.data.sku]
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.toLowerCase().split(/[\s\-_/]+/))
    .filter(Boolean);
  const out = new Set<string>();
  for (const w of words) for (let i = 1; i <= Math.min(w.length, 12); i++) out.add(w.slice(0, i));
  return [...out].slice(0, 100);
}

const toDoc = (rec: StoredRecord) => {
  const { target, ...rest } = rec;
  return { ...rest, entityKey: target, searchTokens: searchTokens(rec) };
};

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 40);

class Reader implements ReadTx {
  protected readonly paths;
  constructor(
    protected readonly db: Firestore,
    tid: string,
    protected readonly t?: Transaction,
  ) {
    this.paths = tenantPaths(tid);
  }

  protected getDoc(ref: FirebaseFirestore.DocumentReference) {
    return this.t ? this.t.get(ref) : ref.get();
  }
  protected getQuery(q: FirebaseFirestore.Query) {
    return this.t ? this.t.get(q) : q.get();
  }

  async get(target: string, id: string): Promise<StoredRecord | undefined> {
    const snap = await this.getDoc(this.db.doc(this.paths.doc("records", id)));
    if (!snap.exists) return undefined;
    const rec = toStored(snap.data()!);
    return rec.target === target ? rec : undefined;
  }

  async list(target: string): Promise<StoredRecord[]> {
    const snap = await this.getQuery(this.db.collection(this.paths.collection("records")).where("entityKey", "==", target).limit(5000));
    return snap.docs.map((d) => toStored(d.data()));
  }

  async referencedBy(id: string): Promise<StoredRecord | undefined> {
    const snap = await this.getQuery(this.db.collection(this.paths.collection("records")).where("links", "array-contains", id).limit(1));
    return snap.empty ? undefined : toStored(snap.docs[0]!.data());
  }

  async getApproval(id: string): Promise<ApprovalDoc | undefined> {
    const snap = await this.getDoc(this.db.doc(this.paths.doc("approvals", id)));
    return snap.exists ? (snap.data() as ApprovalDoc) : undefined;
  }
}

type Op = { kind: "set"; path: string; data: object } | { kind: "delete"; path: string };

class Writer extends Reader implements WriteTx {
  /** Pending writes by document path; later writes to the same path win. */
  private ops = new Map<string, Op>();
  private seq = new Map<string, number>();

  constructor(db: Firestore, tid: string, t: Transaction) {
    super(db, tid, t);
  }

  /* Reads see this command's own pending writes first. */
  override async get(target: string, id: string) {
    const op = this.ops.get(this.paths.doc("records", id));
    if (op) return op.kind === "delete" ? undefined : ((d) => (d.target === target ? structuredClone(d) : undefined))(toStored(op.data as FirebaseFirestore.DocumentData));
    return super.get(target, id);
  }

  override async list(target: string) {
    const stored = await super.list(target);
    const byId = new Map(stored.map((r) => [r.id, r]));
    for (const [path, op] of this.ops) {
      if (!path.startsWith(this.paths.collection("records") + "/")) continue;
      const id = path.slice(path.lastIndexOf("/") + 1);
      if (op.kind === "delete") byId.delete(id);
      else {
        const rec = toStored(op.data as FirebaseFirestore.DocumentData);
        if (rec.target === target) byId.set(id, rec);
      }
    }
    return [...byId.values()];
  }

  override async referencedBy(id: string) {
    for (const [path, op] of this.ops) {
      if (op.kind === "set" && path.startsWith(this.paths.collection("records") + "/") && ((op.data as { links?: string[] }).links ?? []).includes(id)) {
        return toStored(op.data as FirebaseFirestore.DocumentData);
      }
    }
    return super.referencedBy(id);
  }

  override async getApproval(id: string) {
    const op = this.ops.get(this.paths.doc("approvals", id));
    return op?.kind === "set" ? (structuredClone(op.data) as ApprovalDoc) : super.getApproval(id);
  }

  put(rec: StoredRecord) {
    this.ops.set(this.paths.doc("records", rec.id), { kind: "set", path: this.paths.doc("records", rec.id), data: toDoc(structuredClone(rec)) });
  }

  remove(_target: string, id: string) {
    this.ops.set(this.paths.doc("records", id), { kind: "delete", path: this.paths.doc("records", id) });
  }

  async nextSeq(key: string) {
    const docId = key.replaceAll("/", "_");
    let n = this.seq.get(docId);
    if (n === undefined) {
      const snap = await this.getDoc(this.db.doc(this.paths.doc("sequences", docId)));
      n = (snap.exists ? Number(snap.data()!.value) : 0) || 0;
    }
    n += 1;
    this.seq.set(docId, n);
    this.ops.set(this.paths.doc("sequences", docId), { kind: "set", path: this.paths.doc("sequences", docId), data: { value: n } });
    return n;
  }

  putApproval(a: ApprovalDoc) {
    this.ops.set(this.paths.doc("approvals", a.id), { kind: "set", path: this.paths.doc("approvals", a.id), data: structuredClone(a) });
  }

  audit(e: AuditEntry) {
    this.ops.set(this.paths.doc("audit", e.id), { kind: "set", path: this.paths.doc("audit", e.id), data: structuredClone(e) });
  }

  async getResult(key: string) {
    const snap = await this.getDoc(this.db.doc(this.paths.doc("results", hashKey(key))));
    return snap.exists ? snap.data()!.result : undefined;
  }

  putResult(key: string, result: unknown) {
    const path = this.paths.doc("results", hashKey(key));
    this.ops.set(path, { kind: "set", path, data: { result: structuredClone(result), at: new Date().toISOString() } });
  }

  /** Apply every buffered write to the transaction, after all reads. */
  commit() {
    const t = this.t!;
    for (const op of this.ops.values()) {
      const ref = this.db.doc(op.path);
      if (op.kind === "delete") t.delete(ref);
      else t.set(ref, op.data);
    }
  }
}
