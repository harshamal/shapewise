import type { Compiled } from "../compile";
import type { StoredRecord, WriteTx } from "../store";
import { POSTING, type EngineCtx } from "./context";
import { postAction } from "./postings";

/**
 * Posts documents that reached their state without the engines: records
 * written straight to the store (the demo workspaces) or saved before the
 * engines existed. Each document gets the postings of the steps that took
 * it to its state, in date order, so stock and the books end up as if every
 * step had gone through the pipeline. Documents already posted are skipped,
 * so it is safe to run again.
 */

/** The posting steps behind each state, per record type. */
const STEPS: Record<string, Record<string, string[]>> = {
  invoice: { posted: ["post"] },
  receipt: { posted: ["post"] },
  credit_note: { posted: ["post"] },
  bill: { posted: ["post"] },
  payment: { posted: ["post"] },
  vendor_credit: { posted: ["post"] },
  vendor_advance: { posted: ["post"] },
  expense: { posted: ["post"] },
  goods_receipt: { posted: ["post"] },
  stock_adjustment: { posted: ["post"] },
  journal: { posted: ["post"] },
  delivery_note: { dispatched: ["dispatch"], delivered: ["dispatch"] },
  stock_transfer: { in_transit: ["send"], received: ["send", "receive"] },
  pos_shift: { closed: ["close"] },
  pos_sale: { refunded: ["refund"] },
  cheque: { realised: ["realise"] },
  inspection: { passed: ["pass"] },
  ncr: { closed: ["close"] },
  batch: {
    materials_issued: ["issue_materials"],
    in_process: ["issue_materials"],
    qc_hold: ["issue_materials", "finish"],
    released: ["issue_materials", "finish", "release"],
    rejected: ["issue_materials", "finish", "reject"],
  },
  fixed_asset: { disposed: ["dispose"], written_off: ["write_off"] },
  vat_return: { finalised: ["finalise"], filed: ["finalise"], paid: ["finalise", "pay"] },
};

/** Within a day: stock in before it goes out, documents before what settles them. */
const ORDER: Record<string, number> = { stock_adjustment: 0, goods_receipt: 1, inspection: 2, batch: 3, stock_transfer: 3, bill: 4, invoice: 4, delivery_note: 5, pos_shift: 5, credit_note: 6, vendor_credit: 6, pos_sale: 7, receipt: 8, payment: 8 };

const dateOf = (r: StoredRecord) => String(r.data.date ?? r.data.mfg_date ?? r.data.cheque_date ?? r.data.opened_at ?? r.createdAt).slice(0, 10);

export async function replayPostings(tx: WriteTx, compiled: Compiled, opts: { now: Date; today: string; newId: (prefix: string) => string; actorId?: string }): Promise<number> {
  // History has already happened: stock that went below zero then is recorded, not refused.
  const c: Compiled = { ...compiled, bp: { ...compiled.bp, settings: { ...compiled.bp.settings, inventory: { ...compiled.bp.settings.inventory, negativeStock: "off" } } } };
  const docs: { rec: StoredRecord; steps: string[] }[] = [];
  for (const [target, states] of Object.entries(STEPS)) {
    if (!c.targets.has(target)) continue;
    for (const rec of await tx.list(target)) {
      const steps = states[rec.status ?? ""];
      if (steps) docs.push({ rec, steps });
    }
  }
  docs.sort((a, b) => dateOf(a.rec).localeCompare(dateOf(b.rec)) || (ORDER[a.rec.target] ?? 9) - (ORDER[b.rec.target] ?? 9) || a.rec.createdAt.localeCompare(b.rec.createdAt));

  let posted = 0;
  for (const { rec: stale, steps } of docs) {
    const t = c.targets.get(stale.target)!;
    for (const key of steps) {
      if (await tx.get(POSTING, `pst_${stale.id}_${key}`)) continue;
      const a = t.actions.find((x) => x.key === key);
      if (!a) continue;
      // Earlier steps may have changed the document (costs, amounts due); post on its latest form.
      const rec = (await tx.get(t.target, stale.id)) ?? stale;
      const ctx: EngineCtx = {
        tx,
        c,
        now: opts.now,
        today: dateOf(rec) <= opts.today ? dateOf(rec) : opts.today,
        actorId: opts.actorId ?? "system",
        newId: opts.newId,
        warn: () => undefined,
        audit: () => undefined,
      };
      await postAction(ctx, t, a, rec);
      tx.put(rec);
      posted++;
    }
  }
  return posted;
}
