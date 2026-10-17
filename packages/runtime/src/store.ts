import type { CommandEnvelope } from "./commands";

/**
 * Storage behind the command pipeline. The pipeline only ever writes inside
 * `write`, which is atomic: all of a command's changes (record, numbering
 * counter, approval, audit entry) commit together or not at all.
 *
 * MemoryStore backs the demo workspaces and tests. A Firestore store
 * implements the same interface with runTransaction.
 */

export interface StoredRecord {
  id: string;
  target: string;
  /** Field values by key. Money in minor units (cents), dates "YYYY-MM-DD". */
  data: Record<string, unknown>;
  status?: string;
  number?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  /** Ids of records this one references, for reverse lookups. */
  links: string[];
  /** Set while a change to this record waits for approval. */
  pendingApproval?: string;
}

export interface ApprovalStageState {
  id: string;
  name: string;
  roles: string[];
  requireAll: boolean;
}

export interface ApprovalDoc {
  id: string;
  status: "pending" | "approved" | "rejected";
  policyId: string;
  label: string;
  target: string;
  recordId?: string;
  action: string;
  /** Plain-language summary for the inbox. */
  summary: string;
  /** Amount in major units, if the record has one. */
  amount?: number;
  envelope: CommandEnvelope;
  stages: ApprovalStageState[];
  stageIndex: number;
  decisions: { stageId: string; by: string; byName?: string; roleId?: string; decision: "approve" | "reject"; note?: string; at: string }[];
  requestedBy: string;
  requestedByName?: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  commandId: string;
  actor: { id: string; name?: string; kind: string; channel: string; roleKey: string };
  target: string;
  recordId?: string;
  action: string;
  summary: string;
}

export interface ReadTx {
  get(target: string, id: string): Promise<StoredRecord | undefined>;
  list(target: string): Promise<StoredRecord[]>;
  /** Any one record that references this id (for "can't delete, it's in use"). */
  referencedBy(id: string): Promise<StoredRecord | undefined>;
  getApproval(id: string): Promise<ApprovalDoc | undefined>;
}

export interface WriteTx extends ReadTx {
  put(rec: StoredRecord): void;
  remove(target: string, id: string): void;
  /** Next value of a gap-free counter. */
  nextSeq(key: string): Promise<number>;
  putApproval(a: ApprovalDoc): void;
  audit(e: AuditEntry): void;
  /** Idempotency: a previous result for this key, if any. */
  getResult(key: string): Promise<unknown>;
  putResult(key: string, result: unknown): void;
}

export interface Store {
  read<T>(tid: string, fn: (tx: ReadTx) => Promise<T>): Promise<T>;
  write<T>(tid: string, fn: (tx: WriteTx) => Promise<T>): Promise<T>;
  listApprovals(tid: string, status?: ApprovalDoc["status"]): Promise<ApprovalDoc[]>;
  listAudit(tid: string, filter?: { target?: string; recordId?: string; limit?: number }): Promise<AuditEntry[]>;
}

interface TenantState {
  records: Map<string, Map<string, StoredRecord>>;
  seq: Map<string, number>;
  approvals: Map<string, ApprovalDoc>;
  audit: AuditEntry[];
  results: Map<string, unknown>;
}

const emptyState = (): TenantState => ({ records: new Map(), seq: new Map(), approvals: new Map(), audit: [], results: new Map() });

export class MemoryStore implements Store {
  private tenants = new Map<string, TenantState>();
  private locks = new Map<string, Promise<unknown>>();

  private state(tid: string): TenantState {
    let s = this.tenants.get(tid);
    if (!s) this.tenants.set(tid, (s = emptyState()));
    return s;
  }

  has(tid: string): boolean {
    return this.tenants.has(tid);
  }

  async read<T>(tid: string, fn: (tx: ReadTx) => Promise<T>): Promise<T> {
    return fn(readTx(this.state(tid)));
  }

  /** Serialised per tenant; runs on a copy and swaps it in only if fn succeeds. */
  async write<T>(tid: string, fn: (tx: WriteTx) => Promise<T>): Promise<T> {
    const prev = this.locks.get(tid) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.locks.set(tid, prev.then(() => mine));
    await prev.catch(() => undefined);
    try {
      const draft = structuredClone(this.state(tid));
      const tx: WriteTx = {
        ...readTx(draft),
        put(rec) {
          let m = draft.records.get(rec.target);
          if (!m) draft.records.set(rec.target, (m = new Map()));
          m.set(rec.id, structuredClone(rec));
        },
        remove(target, id) {
          draft.records.get(target)?.delete(id);
        },
        async nextSeq(key) {
          const n = (draft.seq.get(key) ?? 0) + 1;
          draft.seq.set(key, n);
          return n;
        },
        putApproval(a) {
          draft.approvals.set(a.id, structuredClone(a));
        },
        audit(e) {
          draft.audit.push(e);
        },
        async getResult(key) {
          return draft.results.get(key);
        },
        putResult(key, result) {
          draft.results.set(key, structuredClone(result));
        },
      };
      const out = await fn(tx);
      this.tenants.set(tid, draft);
      return out;
    } finally {
      release();
    }
  }

  async listApprovals(tid: string, status?: ApprovalDoc["status"]) {
    return [...this.state(tid).approvals.values()].filter((a) => !status || a.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listAudit(tid: string, filter: { target?: string; recordId?: string; limit?: number } = {}) {
    return this.state(tid)
      .audit.filter((e) => (!filter.target || e.target === filter.target) && (!filter.recordId || e.recordId === filter.recordId))
      .slice(-(filter.limit ?? 50))
      .reverse();
  }
}

function readTx(s: TenantState): ReadTx {
  return {
    async get(target, id) {
      const r = s.records.get(target)?.get(id);
      return r ? structuredClone(r) : undefined;
    },
    async list(target) {
      return [...(s.records.get(target)?.values() ?? [])].map((r) => structuredClone(r));
    },
    async referencedBy(id) {
      for (const m of s.records.values()) for (const r of m.values()) if (r.links.includes(id)) return structuredClone(r);
      return undefined;
    },
    async getApproval(id) {
      const a = s.approvals.get(id);
      return a ? structuredClone(a) : undefined;
    },
  };
}
