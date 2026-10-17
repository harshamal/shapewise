import type { Compiled } from "../compile";
import type { StoredRecord, WriteTx } from "../store";

/**
 * What the inventory and accounting engines work with: the command's
 * transaction, so postings commit with the document or not at all.
 *
 * Engine records live beside the business's records under targets that
 * start with "_", which no blueprint can name: journal entries, stock
 * movements, stock levels per item and store, and one posting record per
 * document action that lists what it wrote, so a void can undo exactly that.
 */

export const JOURNAL = "_journal";
export const STOCK_MOVE = "_stock_move";
export const STOCK_LEVEL = "_stock_level";
export const STOCK_ITEM = "_stock_item";
export const POSTING = "_posting";

/** Engine record types, for snapshots and tools that read them. */
export const ENGINE_TARGETS = [JOURNAL, STOCK_MOVE, STOCK_LEVEL, STOCK_ITEM, POSTING] as const;

/** A posting the business has to fix before it can go through, said plainly. */
export class EngineRule extends Error {}

export interface EngineCtx {
  tx: WriteTx;
  c: Compiled;
  now: Date;
  today: string;
  actorId: string;
  newId(prefix: string): string;
  warn(message: string): void;
  audit(target: string, recordId: string | undefined, action: string, summary: string): void;
}

export function engineRecord(ctx: EngineCtx, target: string, id: string, data: Record<string, unknown>, links: string[] = []): StoredRecord {
  const at = ctx.now.toISOString();
  return { id, target, data, version: 1, createdAt: at, updatedAt: at, createdBy: ctx.actorId, updatedBy: ctx.actorId, links };
}

export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
export const rows = (rec: StoredRecord, key = "lines") => (Array.isArray(rec.data[key]) ? (rec.data[key] as Record<string, unknown>[]) : []);
/** Quantities are kept to three decimals. */
export const q3 = (n: number) => Math.round(n * 1000) / 1000;
export const EPS = 0.0005;

export const moduleOn = (c: Compiled, key: string) => c.bp.modules.some((m) => m.key === key && m.enabled);
export const extensionOn = (c: Compiled, key: string) => (c.bp.extensions as readonly string[]).includes(key);

/** Reads through the transaction, remembering what it has read. */
export class Cache {
  private m = new Map<string, StoredRecord | undefined>();
  private lists = new Map<string, StoredRecord[]>();
  constructor(private tx: WriteTx) {}
  async get(target: string, id: unknown): Promise<StoredRecord | undefined> {
    if (typeof id !== "string" || !id) return undefined;
    const k = `${target}/${id}`;
    if (!this.m.has(k)) this.m.set(k, await this.tx.get(target, id));
    return this.m.get(k);
  }
  async list(target: string): Promise<StoredRecord[]> {
    if (!this.lists.has(target)) this.lists.set(target, await this.tx.list(target));
    return this.lists.get(target)!;
  }
  /** Write and keep the cached copy current. */
  put(rec: StoredRecord) {
    this.m.set(`${rec.target}/${rec.id}`, rec);
    const l = this.lists.get(rec.target);
    if (l) {
      const i = l.findIndex((r) => r.id === rec.id);
      if (i >= 0) l[i] = rec;
      else l.push(rec);
    }
    this.tx.put(rec);
  }
}
