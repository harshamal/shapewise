import { taxParts, taxesOf, type BusinessTaxes, type SystemRole, type TaxDef, type TaxPart } from "@shapewise/blueprint";
import type { CAction, CTarget } from "../compile";
import type { StoredRecord } from "../store";
import { Books, type JournalLine } from "./books";
import { Cache, EPS, EngineRule, POSTING, STOCK_MOVE, engineRecord, extensionOn, moduleOn, num, q3, rows, str, type EngineCtx } from "./context";
import { Stock, TRANSIT, type MoveSource, type Place } from "./stock";

/**
 * What finishing a document does to stock and the books, per the posting
 * specification in the blueprint catalogue (catalogue/postings.ts): which
 * goods move where, and which account roles are debited and credited. Tax
 * lines only appear for the taxes the business is registered for, by tax
 * kind and the roles of the tax's parts (VAT, GST split into CGST and SGST,
 * sales tax, levies, withholding); otherwise the tax stays in the sale or
 * the cost. A tax on sales only (a levy, US sales tax) stays in the cost on
 * purchases.
 *
 * Where the specification leaves a gap, the choices are:
 * - stock leaves and returns at cost, and the inventory account follows the
 *   store's kind (raw materials, finished goods, general), so stock value and
 *   the inventory accounts always agree;
 * - receipts and payments settle the party's oldest open invoices or bills
 *   first; credit notes and vendor credits settle the document they're
 *   raised against first;
 * - POS sales reach the books when their shift closes (takings and the goods
 *   that left); a refund after that reverses the sale, before it the sale is
 *   simply left out of the takings;
 * - a vendor credit reverses what the bill and goods received posted: stock
 *   leaves at cost and the price difference clears goods not yet billed.
 *
 * Voids and reversals undo exactly what the posting record says was written.
 */

type Posted = { journal: string[]; moves: string[]; allocations: Allocation[] };
type TaxCode = { rate: number; kind: string; tax?: string; def?: TaxDef };
interface Allocation {
  target: "invoice" | "bill";
  id: string;
  amount: number;
}

export interface PostResult {
  journal: string[];
  moves: number;
}

const REVERSING = new Set(["void", "reverse"]);

/** Actions that undo every earlier posting on the document. */
export const isReversal = (a: Pick<CAction, "key">) => REVERSING.has(a.key);

export async function postAction(ctx: EngineCtx, t: CTarget, a: CAction, rec: StoredRecord): Promise<PostResult> {
  const p = new Posting(ctx, t, a, rec);
  if (isReversal(a)) await p.reverseAll();
  else await p.run();
  return p.finish();
}

class Posting {
  readonly cache: Cache;
  readonly books: Books;
  readonly stock: Stock;
  readonly out: Posted = { journal: [], moves: [], allocations: [] };
  private codes = new Map<string, TaxCode>();
  private _taxes?: BusinessTaxes;

  constructor(
    readonly ctx: EngineCtx,
    readonly t: CTarget,
    readonly a: CAction,
    readonly rec: StoredRecord,
  ) {
    this.cache = new Cache(ctx.tx);
    this.books = new Books(ctx, this.cache);
    this.stock = new Stock(ctx, this.cache);
  }

  get bp() {
    return this.ctx.c.bp;
  }
  /** The business's taxes, from its country and registrations. */
  get taxes(): BusinessTaxes {
    return (this._taxes ??= taxesOf(this.bp));
  }
  get wht() {
    return this.taxes.has("withholding");
  }
  get stockOn() {
    return moduleOn(this.ctx.c, "inventory") || moduleOn(this.ctx.c, "production");
  }
  get lotsOn() {
    return extensionOn(this.ctx.c, "lots") && this.ctx.c.targets.has("lot");
  }

  /** The document's business date: its own date, else today. */
  get date(): string {
    const d = str(this.rec.data.date) ?? str(this.rec.data.mfg_date);
    return d && d.length >= 10 ? d.slice(0, 10) : this.ctx.today;
  }

  src(date = this.date): MoveSource & { memo: string } {
    return { date, target: this.t.target, id: this.rec.id, number: this.rec.number, action: this.a.key, memo: `${this.a.label}: ${this.t.label.toLowerCase()} ${this.rec.number ?? ""}`.trim() };
  }

  async journal(lines: JournalLine[], date?: string) {
    const id = await this.books.post(this.src(date), lines);
    if (id) this.out.journal.push(id);
  }

  track(m: { id: string }) {
    this.out.moves.push(m.id);
  }

  async finish(): Promise<PostResult> {
    if (this.out.journal.length || this.out.moves.length || this.out.allocations.length) {
      const id = `pst_${this.rec.id}_${this.a.key}`;
      this.cache.put(engineRecord(this.ctx, POSTING, id, { target: this.t.target, record: this.rec.id, action: this.a.key, date: this.date, ...this.out, reversed: false }));
    }
    return { journal: this.out.journal, moves: this.out.moves.length };
  }

  /* ------------------------------------------------------------ lookups */

  async item(id: unknown) {
    return this.cache.get("item", id);
  }

  /** Goods whose stock is counted: not services, and not switched off. */
  async tracked(id: unknown): Promise<StoredRecord | undefined> {
    if (!this.stockOn) return undefined;
    const it = await this.item(id);
    if (!it || it.data.type === "service" || it.data.track_inventory === false) return undefined;
    return it;
  }

  async tax(code: unknown): Promise<TaxCode | undefined> {
    if (typeof code !== "string" || !code) return undefined;
    if (!this.codes.has(code)) {
      const r = await this.cache.get("tax_code", code);
      const tc = { rate: num(r?.data.rate), kind: String(r?.data.kind ?? "vat"), tax: str(r?.data.tax) };
      this.codes.set(code, { ...tc, def: this.taxes.forCode(tc) });
    }
    return this.codes.get(code);
  }

  /** The parts a tax posts to on this side, when the business is registered for it; else it stays in the sale or cost. */
  posts(def: TaxDef | undefined, flow: "sales" | "purchases"): readonly TaxPart[] | undefined {
    if (!def || !this.taxes.isRegistered(def.id) || def.kind === "withholding") return undefined;
    if (def.appliesTo !== "both" && def.appliesTo !== flow) return undefined;
    const parts = taxParts(def);
    if (!parts.length || (flow === "purchases" && parts.some((x) => !x.input))) return undefined;
    return parts;
  }

  /** A priced document split the way the books need it, in minor units, matching its totals. */
  async priced(r: StoredRecord = this.rec) {
    const out = { goods: 0, services: 0, stockLines: 0, byTax: new Map<string, number>(), otherTax: 0, total: 0 };
    for (const l of rows(r)) {
      const amount = num(l.amount);
      const it = await this.item(l.item);
      if (it?.data.type === "service") out.services += amount;
      else out.goods += amount;
      if (await this.tracked(l.item)) out.stockLines += amount;
      const tc = await this.tax(l.tax_code);
      if (tc) {
        const tax = Math.round((amount * tc.rate) / 100);
        if (tc.def) out.byTax.set(tc.def.id, (out.byTax.get(tc.def.id) ?? 0) + tax);
        else out.otherTax += tax;
      }
    }
    out.total = out.goods + out.services + [...out.byTax.values()].reduce((s, x) => s + x, 0) + out.otherTax;
    return out;
  }

  /**
   * Tax lines for the taxes the business is registered for, in the order
   * its country lists them, each split across its parts; the rest stays in
   * the sale or cost.
   */
  taxLines(p: { byTax: Map<string, number> }, side: "debit" | "credit", flow: "sales" | "purchases"): { lines: JournalLine[]; kept: number } {
    const lines: JournalLine[] = [];
    let kept = 0;
    for (const def of this.taxes.all) {
      const amount = p.byTax.get(def.id);
      if (!amount) continue;
      const parts = this.posts(def, flow);
      if (parts) lines.push(...split(amount, parts, (x) => (flow === "sales" ? x.output : x.input!), side));
      else kept += amount;
    }
    return { lines, kept };
  }

  /** Inventory account role for a store, by its kind. */
  async invRole(warehouse: string): Promise<SystemRole> {
    if (warehouse === TRANSIT) return "inventory";
    const w = await this.cache.get("warehouse", warehouse);
    switch (w?.data.kind) {
      case "raw_material":
      case "packaging":
        return "inventory_raw";
      case "wip":
        return "inventory_wip";
      case "finished_goods":
        return "inventory_fg";
      default:
        return "inventory";
    }
  }

  /** A store for documents that don't name one (returns, POS, production), by preference of kind. */
  async store(...kinds: string[]): Promise<string> {
    const all = (await this.cache.list("warehouse")).filter((w) => w.status !== "archived");
    for (const k of [...kinds, "general", undefined]) {
      const w = all.find((x) => (k === undefined ? true : (x.data.kind ?? "general") === k));
      if (w) return w.id;
    }
    throw new EngineRule("Add a store first, so stock has somewhere to be kept.");
  }

  /** The lot a line moves, creating one for goods that track lots and arrive without one. */
  async lotFor(item: StoredRecord, line: Record<string, unknown> | undefined, make?: { lot_no: string; expiry_date?: unknown; mfg_date?: unknown; supplier_lot_no?: unknown; held?: boolean }): Promise<string | null> {
    if (!this.lotsOn) return null;
    const given = str(line?.lot);
    if (given) return given;
    if (!make || !item.data.track_lots) return null;
    const id = this.ctx.newId("lot_");
    const lot = engineRecord(this.ctx, "lot", id, { lot_no: make.lot_no, item: item.id, expiry_date: str(make.expiry_date) ?? null, mfg_date: str(make.mfg_date) ?? null, supplier_lot_no: str(make.supplier_lot_no) ?? null, on_hand: 0 }, [item.id]);
    lot.status = make.held ? "quarantine" : "available";
    this.cache.put(lot);
    this.ctx.audit("lot", id, "create", `Lot ${make.lot_no} started for ${String(item.data.name ?? "an item")}`);
    if (line) line.lot = id;
    if (!this.rec.links.includes(id)) this.rec.links.push(id);
    return id;
  }

  /**
   * Goods out of a store at cost. Without a lot named, goods that track lots
   * come from the lots with the earliest expiry first (or oldest first).
   */
  async issueGoods(item: StoredRecord, warehouse: string, qty: number, line?: Record<string, unknown>, held = false): Promise<number> {
    const src = this.src();
    const lot = this.lotsOn ? str(line?.lot) : undefined;
    if (lot || !this.lotsOn || !item.data.track_lots) {
      const m = await this.stock.issue(src, { item: item.id, warehouse, lot: lot ?? null, held }, qty);
      this.track(m);
      return -m.value;
    }
    const levels = await this.stock.levelsOf(item.id, (d) => d.warehouse === warehouse && Boolean(d.held) === held && Boolean(d.lot) && num(d.qty) > EPS);
    const lots = await Promise.all(levels.map(async (l) => ({ l, lot: await this.cache.get("lot", l.data.lot) })));
    const fefo = this.bp.settings.inventory.fifoDispatch;
    lots.sort((x, y) => (fefo ? String(x.lot?.data.expiry_date ?? "9999").localeCompare(String(y.lot?.data.expiry_date ?? "9999")) : 0) || String(x.lot?.createdAt ?? "").localeCompare(String(y.lot?.createdAt ?? "")));
    let left = qty;
    let value = 0;
    for (const { l, lot } of lots) {
      if (left <= EPS) break;
      // A lot put on hold isn't picked.
      if (!held && lot?.status === "quarantine") continue;
      const take = Math.min(left, num(l.data.qty));
      const m = await this.stock.issue(src, { item: item.id, warehouse, lot: String(l.data.lot), held }, take);
      this.track(m);
      value -= m.value;
      left = q3(left - take);
    }
    if (left > EPS) {
      const m = await this.stock.issue(src, { item: item.id, warehouse, lot: null, held }, left);
      this.track(m);
      value -= m.value;
    }
    return value;
  }

  /** The store for returned goods, when the document has any. */
  async storeIfGoods(r: StoredRecord, ...kinds: string[]): Promise<string | undefined> {
    for (const l of rows(r)) if (num(l.quantity) > 0 && (await this.tracked(l.item))) return this.store(...kinds);
    return undefined;
  }

  async receiveGoods(p: Place, qty: number, value: number) {
    this.track(await this.stock.receive(this.src(), p, qty, value));
  }

  /** Moves this document wrote for an earlier action, for exact follow-ups (release, receive). */
  async movesOf(action: string): Promise<Record<string, unknown>[]> {
    const p = await this.cache.get(POSTING, `pst_${this.rec.id}_${action}`);
    if (!p || p.data.reversed) return [];
    const out: Record<string, unknown>[] = [];
    for (const id of (p.data.moves as string[]) ?? []) {
      const m = await this.cache.get(STOCK_MOVE, id);
      if (m) out.push(m.data);
    }
    return out;
  }

  /* -------------------------------------------------------- settlement */

  /** Settle open invoices or bills of a party, the named one first, then the oldest. */
  async settle(target: "invoice" | "bill", party: unknown, amount: number, first?: unknown): Promise<number> {
    if (amount <= 0 || typeof party !== "string") return amount;
    const key = target === "invoice" ? "customer" : "vendor";
    const open = (await this.cache.list(target))
      .filter((d) => d.status === "posted" && d.data[key] === party && num(d.data.amount_due) > 0)
      .sort((x, y) => Number(y.id === first) - Number(x.id === first) || String(x.data.due_date ?? x.data.date ?? "").localeCompare(String(y.data.due_date ?? y.data.date ?? "")) || String(x.number ?? "").localeCompare(String(y.number ?? "")));
    let left = amount;
    for (const d of open) {
      if (left <= 0) break;
      const take = Math.min(left, num(d.data.amount_due));
      d.data.amount_due = num(d.data.amount_due) - take;
      d.data.payment_status = paymentStatus(d);
      this.cache.put(d);
      this.out.allocations.push({ target, id: d.id, amount: take });
      left -= take;
    }
    return left;
  }

  /* ------------------------------------------------------------ actions */

  async run() {
    const key = `${this.t.target}.${this.a.key}`;
    const handler = HANDLERS[key];
    if (handler) await handler(this);
  }

  /** Undo every earlier posting on this document, exactly, dated today. */
  async reverseAll() {
    const { rec, t } = this;
    if (t.paymentStatus && num(rec.data.amount_due) !== num(rec.data.total)) {
      throw new EngineRule(`Payments or credits are recorded against this ${t.label.toLowerCase()}. Void those first.`);
    }
    const src = this.src(this.ctx.today);
    for (const other of t.actions) {
      if (isReversal(other)) continue;
      const p = await this.cache.get(POSTING, `pst_${rec.id}_${other.key}`);
      if (!p || p.data.reversed) continue;
      for (const id of [...((p.data.moves as string[]) ?? [])].reverse()) {
        const m = await this.cache.get(STOCK_MOVE, id);
        if (!m) continue;
        const d = m.data;
        const place: Place = { item: String(d.item), warehouse: String(d.warehouse), lot: (d.lot as string | null) ?? null, held: Boolean(d.held) };
        const moved = num(d.qty) > 0 ? await this.stock.removeExact(src, place, num(d.qty), num(d.value)) : await this.stock.restoreExact(src, place, -num(d.qty), -num(d.value));
        this.track(moved);
      }
      for (const id of [...((p.data.journal as string[]) ?? [])].reverse()) {
        const r = await this.books.reverse(id, src);
        if (r) this.out.journal.push(r);
      }
      for (const al of (p.data.allocations as Allocation[]) ?? []) {
        const d = await this.cache.get(al.target, al.id);
        if (!d) continue;
        d.data.amount_due = num(d.data.amount_due) + al.amount;
        d.data.payment_status = paymentStatus(d);
        this.cache.put(d);
      }
      p.data.reversed = true;
      p.data.reversed_by = this.a.key;
      this.cache.put(p);
    }
  }
}

function paymentStatus(d: StoredRecord): string {
  const due = num(d.data.amount_due);
  return due <= 0 ? "paid" : due < num(d.data.total) ? "partly_paid" : "unpaid";
}

const party = (target: "customer" | "vendor", id: unknown) => (typeof id === "string" && id ? { target, id } : undefined);

/* ---------------------------------------------------------------- handlers */

type Handler = (p: Posting) => Promise<void>;

/** Revenue lines for a sale: goods to sales, services to service income, unregistered tax kept in sales. */
async function revenue(p: Posting, r: StoredRecord, side: "debit" | "credit") {
  const pr = await p.priced(r);
  const tax = p.taxLines(pr, side, "sales");
  return {
    total: pr.total,
    lines: [{ role: "sales" as SystemRole, [side]: pr.goods + pr.otherTax + tax.kept }, { role: "service_income" as SystemRole, [side]: pr.services }, ...tax.lines],
  };
}

/** Goods on a document's lines out of a store at cost; returns the value that left. */
async function linesOut(p: Posting, warehouse: string, lineKey = "quantity"): Promise<number> {
  let value = 0;
  for (const l of rows(p.rec)) {
    const it = await p.tracked(l.item);
    const qty = num(l[lineKey]);
    if (!it || qty <= 0) continue;
    value += await p.issueGoods(it, warehouse, qty, l);
  }
  return value;
}

async function linesBackIn(p: Posting, r: StoredRecord, warehouse: string): Promise<number> {
  let value = 0;
  for (const l of rows(r)) {
    const it = await p.tracked(l.item);
    const qty = num(l.quantity);
    if (!it || qty <= 0) continue;
    const v = Math.round(qty * (await p.stock.unitCost(it.id)));
    await p.receiveGoods({ item: it.id, warehouse, lot: await p.lotFor(it, l) }, qty, v);
    value += v;
  }
  return value;
}

async function moneyAccount(p: Posting, field: string): Promise<{ role: SystemRole; bank_account?: string }> {
  const id = str(p.rec.data[field]);
  return { role: await p.books.roleOfBank(id), bank_account: id };
}

const HANDLERS: Record<string, Handler> = {
  /* selling */
  async "delivery_note.dispatch"(p) {
    const wh = str(p.rec.data.warehouse) ?? (await p.store("finished_goods"));
    const cost = await linesOut(p, wh);
    await p.journal([{ role: "cogs", debit: cost }, { role: await p.invRole(wh), credit: cost }]);
  },

  async "invoice.post"(p) {
    const rv = await revenue(p, p.rec, "credit");
    await p.journal([{ role: "receivables", debit: rv.total, party: party("customer", p.rec.data.customer) }, ...rv.lines]);
    p.rec.data.amount_due = rv.total;
    p.rec.data.payment_status = "unpaid";
  },

  async "receipt.post"(p) {
    const amount = num(p.rec.data.amount);
    const wht = p.wht ? num(p.rec.data.wht_deducted) : 0;
    const bank = await moneyAccount(p, "deposit_to");
    await p.journal([{ ...bank, debit: amount }, { role: "wht_receivable", debit: wht }, { role: "receivables", credit: amount + wht, party: party("customer", p.rec.data.customer) }]);
    await p.settle("invoice", p.rec.data.customer, amount + wht);
  },

  async "credit_note.post"(p) {
    const rv = await revenue(p, p.rec, "debit");
    const lines: JournalLine[] = [...rv.lines, { role: "receivables", credit: rv.total, party: party("customer", p.rec.data.customer) }];
    const wh = await p.storeIfGoods(p.rec, "finished_goods");
    if (wh) {
      const cost = await linesBackIn(p, p.rec, wh);
      lines.push({ role: await p.invRole(wh), debit: cost }, { role: "cogs", credit: cost });
    }
    await p.journal(lines);
    await p.settle("invoice", p.rec.data.customer, rv.total, p.rec.data.invoice);
  },

  async "pos_shift.close"(p) {
    const sales = (await p.cache.list("pos_sale")).filter((s) => s.data.shift === p.rec.id && s.status === "completed");
    if (!sales.length) return;
    const cash = await p.books.defaultBank("cash");
    let total = 0;
    const lines: JournalLine[] = [];
    let cost = 0;
    let wh: string | undefined;
    for (const s of sales) {
      const rv = await revenue(p, s, "credit");
      total += rv.total;
      lines.push(...rv.lines);
      for (const l of rows(s)) {
        const it = await p.tracked(l.item);
        if (!it || num(l.quantity) <= 0) continue;
        wh ??= await p.store("finished_goods");
        cost += await p.issueGoods(it, wh, num(l.quantity), { lot: l.lot });
      }
    }
    lines.unshift({ role: "cash", debit: total, bank_account: cash?.data.kind === "cash" ? cash.id : undefined });
    if (wh) lines.push({ role: "cogs", debit: cost }, { role: await p.invRole(wh), credit: cost });
    await p.journal(lines, p.ctx.today);
  },

  async "pos_sale.refund"(p) {
    // Only a sale whose takings are in the books has anything to reverse.
    const shift = await p.cache.get("pos_shift", p.rec.data.shift);
    if (shift?.status !== "closed") return;
    const rv = await revenue(p, p.rec, "debit");
    const cash = await p.books.defaultBank("cash");
    const lines: JournalLine[] = [...rv.lines, { role: "cash", credit: rv.total, bank_account: cash?.data.kind === "cash" ? cash.id : undefined }];
    const wh = await p.storeIfGoods(p.rec, "finished_goods");
    if (wh) {
      const cost = await linesBackIn(p, p.rec, wh);
      lines.push({ role: await p.invRole(wh), debit: cost }, { role: "cogs", credit: cost });
    }
    await p.journal(lines, p.ctx.today);
  },

  async "cheque.realise"(p) {
    const amount = num(p.rec.data.amount);
    const bankId = str(p.rec.data.bank_account) ?? (await p.books.defaultBank())?.id;
    const bank = { role: await p.books.roleOfBank(bankId), bank_account: bankId };
    const date = str(p.rec.data.cheque_date) ?? p.ctx.today;
    if (p.rec.data.direction === "issued") await p.journal([{ role: "payables", debit: amount }, { ...bank, credit: amount }], date);
    else await p.journal([{ ...bank, debit: amount }, { role: "receivables", credit: amount }], date);
  },

  /* buying */
  async "goods_receipt.post"(p) {
    const wh = str(p.rec.data.warehouse) ?? (await p.store("raw_material"));
    const po = await p.cache.get("purchase_order", p.rec.data.purchase_order);
    const qc = extensionOn(p.ctx.c, "incoming_qc");
    let total = 0;
    for (const [i, l] of rows(p.rec).entries()) {
      const it = await p.tracked(l.item);
      const qty = num(l.quantity);
      if (!it || qty <= 0) continue;
      const poLine = rows(po ?? p.rec).find((x) => po && x.item === l.item);
      const unit = l.unit_cost !== undefined && l.unit_cost !== null ? num(l.unit_cost) : poLine ? num(poLine.unit_price) * (1 - num(poLine.discount_pct) / 100) : num(it.data.purchase_price) || (await p.stock.unitCost(it.id));
      const value = Math.round(qty * unit);
      const held = qc && it.data.inspect_on_arrival === true;
      const lot = await p.lotFor(it, l, { lot_no: str(l.supplier_lot_no) ?? `${p.rec.number ?? "GRN"}-${i + 1}`, expiry_date: l.expiry_date, supplier_lot_no: l.supplier_lot_no, held });
      await p.receiveGoods({ item: it.id, warehouse: wh, lot, held }, qty, value);
      total += value;
    }
    p.rec.data.total = total;
    await p.journal([{ role: await p.invRole(wh), debit: total }, { role: "grni", credit: total }]);
  },

  async "bill.post"(p) {
    const pr = await p.priced();
    const tax = p.taxLines(pr, "debit", "purchases");
    await p.journal([
      { role: "grni", debit: pr.stockLines },
      { role: "purchases_expense", debit: pr.goods + pr.services - pr.stockLines + pr.otherTax + tax.kept },
      ...tax.lines,
      { role: "payables", credit: pr.total, party: party("vendor", p.rec.data.vendor) },
    ]);
    p.rec.data.amount_due = pr.total;
    p.rec.data.payment_status = "unpaid";
  },

  async "payment.post"(p) {
    const amount = num(p.rec.data.amount);
    const wht = p.wht ? num(p.rec.data.wht_deducted) : 0;
    const bank = await moneyAccount(p, "paid_from");
    await p.journal([{ role: "payables", debit: amount + wht, party: party("vendor", p.rec.data.vendor) }, { ...bank, credit: amount }, { role: "wht_payable", credit: wht }]);
    await p.settle("bill", p.rec.data.vendor, amount + wht);
  },

  async "vendor_credit.post"(p) {
    const pr = await p.priced();
    const tax = p.taxLines(pr, "credit", "purchases");
    const lines: JournalLine[] = [{ role: "payables", debit: pr.total, party: party("vendor", p.rec.data.vendor) }, ...tax.lines];
    lines.push({ role: "purchases_expense", credit: pr.goods + pr.services - pr.stockLines + pr.otherTax + tax.kept });
    if (pr.stockLines) {
      const wh = await p.store("raw_material", "packaging");
      const cost = await linesOut(p, wh);
      // Stock leaves at cost; the difference to the billed price clears goods not yet billed.
      lines.push({ role: await p.invRole(wh), credit: cost }, { role: "grni", credit: pr.stockLines - cost });
    }
    await p.journal(lines);
    await p.settle("bill", p.rec.data.vendor, pr.total, p.rec.data.bill);
  },

  async "vendor_advance.post"(p) {
    const amount = num(p.rec.data.amount);
    await p.journal([{ role: "vendor_advances", debit: amount }, { ...(await moneyAccount(p, "paid_from")), credit: amount }]);
    p.rec.data.unapplied = amount;
  },

  async "expense.post"(p) {
    // The amount is what was paid; tax on it (VAT, GST) is claimed back when registered.
    const gross = num(p.rec.data.amount);
    const tc = await p.tax(p.rec.data.tax_code);
    const parts = tc && tc.rate > 0 ? p.posts(tc.def, "purchases") : undefined;
    const claim = parts ? Math.round((gross * tc!.rate) / (100 + tc!.rate)) : 0;
    const account = (await p.cache.get("account", p.rec.data.account))?.id;
    await p.journal([
      account ? { account, debit: gross - claim } : { role: "purchases_expense", debit: gross - claim },
      ...(parts ? split(claim, parts, (x) => x.input!, "debit") : []),
      { ...(await moneyAccount(p, "paid_from")), credit: gross },
    ]);
  },

  /* stock */
  async "stock_adjustment.post"(p) {
    const wh = str(p.rec.data.warehouse) ?? (await p.store());
    let net = 0;
    for (const [i, l] of rows(p.rec).entries()) {
      const it = await p.tracked(l.item);
      const delta = num(l.quantity_delta);
      if (!it || Math.abs(delta) <= EPS) continue;
      if (delta > 0) {
        const unit = l.unit_cost !== undefined && l.unit_cost !== null ? num(l.unit_cost) : await p.stock.unitCost(it.id, await p.stock.level({ item: it.id, warehouse: wh, lot: str(l.lot) ?? null }));
        const value = Math.round(delta * unit);
        const lot = await p.lotFor(it, l, { lot_no: `${p.rec.number ?? "ADJ"}-${i + 1}` });
        await p.receiveGoods({ item: it.id, warehouse: wh, lot }, delta, value);
        net += value;
      } else net -= await p.issueGoods(it, wh, -delta, l);
    }
    // Opening stock is equity; anything else is a gain or loss on stock.
    const contra: SystemRole = p.rec.data.reason === "opening" ? "opening_balance_equity" : "stock_adjustment";
    await p.journal([{ role: await p.invRole(wh), debit: net }, { role: contra, credit: net }]);
  },

  async "stock_transfer.send"(p) {
    const from = str(p.rec.data.from_warehouse)!;
    for (const l of rows(p.rec)) {
      const it = await p.tracked(l.item);
      const qty = num(l.quantity);
      if (!it || qty <= 0) continue;
      const value = await p.issueGoods(it, from, qty, l);
      await p.receiveGoods({ item: it.id, warehouse: TRANSIT, lot: str(l.lot) ?? null }, qty, value);
    }
  },

  async "stock_transfer.receive"(p) {
    const from = str(p.rec.data.from_warehouse)!;
    const to = str(p.rec.data.to_warehouse)!;
    let value = 0;
    for (const m of (await p.movesOf("send")).filter((m) => m.warehouse === TRANSIT)) {
      const place = { item: String(m.item), lot: (m.lot as string | null) ?? null };
      const moved = await p.stock.moveExact(p.src(p.ctx.today), { ...place, warehouse: TRANSIT }, { ...place, warehouse: to }, num(m.qty), num(m.value));
      p.track(moved.out);
      p.track(moved.in);
      value += num(m.value);
    }
    const [fromAcc, toAcc] = [await p.books.accountFor(await p.invRole(from)), await p.books.accountFor(await p.invRole(to))];
    if (fromAcc !== toAcc) await p.journal([{ account: toAcc, debit: value }, { account: fromAcc, credit: value }], p.ctx.today);
  },

  async "inspection.pass"(p) {
    const item = str(p.rec.data.item);
    if (!item) return;
    const lot = str(p.rec.data.lot);
    const grn = await p.cache.get("goods_receipt", p.rec.data.goods_receipt);
    const held = await p.stock.levelsOf(item, (d) => Boolean(d.held) && num(d.qty) > EPS && (!lot || d.lot === lot) && (!grn || d.warehouse === grn.data.warehouse));
    let left = lot ? Infinity : grn ? rows(grn).filter((l) => l.item === item).reduce((s, l) => s + num(l.quantity), 0) : Infinity;
    for (const l of held) {
      if (left <= EPS) break;
      const qty = Math.min(left, num(l.data.qty));
      const place = { item, warehouse: String(l.data.warehouse), lot: (l.data.lot as string | null) ?? null };
      const moved = await p.stock.move(p.src(p.ctx.today), { ...place, held: true }, place, qty);
      p.track(moved.out);
      p.track(moved.in);
      left = q3(left - qty);
    }
    const lotRec = await p.cache.get("lot", lot);
    if (lotRec?.status === "quarantine") {
      lotRec.status = "available";
      p.cache.put(lotRec);
    }
  },

  /* making */
  async "batch.issue_materials"(p) {
    const order = await p.cache.get("production_order", p.rec.data.production_order);
    const wh = str(order?.data.source_warehouse) ?? (await p.store("raw_material", "packaging"));
    let total = 0;
    for (const l of rows(p.rec)) {
      const it = await p.tracked(l.item);
      const qty = num(l.quantity);
      if (!it || qty <= 0) continue;
      const v = await p.issueGoods(it, wh, qty, l);
      l.unit_cost = Math.round(v / qty);
      total += v;
    }
    p.rec.data.material_cost = total;
    await p.journal([{ role: "inventory_wip", debit: total }, { role: await p.invRole(wh), credit: total }]);
  },

  async "batch.finish"(p) {
    const order = await p.cache.get("production_order", p.rec.data.production_order);
    const product = await p.tracked(order?.data.item);
    const qty = num(p.rec.data.output_quantity) || num(p.rec.data.planned_quantity);
    const material = num(p.rec.data.material_cost);
    const { labour, overhead } = await conversionCost(p);
    const cost = material + labour + overhead;
    if (product && qty > 0) {
      const wh = str(order?.data.destination_warehouse) ?? (await p.store("finished_goods"));
      const lot = await p.lotFor(product, undefined, { lot_no: p.rec.number ?? p.rec.id, mfg_date: p.rec.data.mfg_date, expiry_date: p.rec.data.expiry_date, held: true });
      await p.receiveGoods({ item: product.id, warehouse: wh, lot, held: true }, qty, cost);
      p.rec.data.unit_cost = Math.round(cost / qty);
      await p.journal([{ role: await p.invRole(wh), debit: cost }, { role: "inventory_wip", credit: material }, { role: "labour_absorbed", credit: labour }, { role: "overhead_absorbed", credit: overhead }]);
    } else {
      // Nothing came off the line to carry the cost: it stays a production cost.
      await p.journal([{ role: "production_variance", debit: cost }, { role: "inventory_wip", credit: material }, { role: "labour_absorbed", credit: labour }, { role: "overhead_absorbed", credit: overhead }]);
    }
  },

  async "batch.release"(p) {
    for (const m of (await p.movesOf("finish")).filter((m) => m.held && num(m.qty) > 0)) {
      const place = { item: String(m.item), warehouse: String(m.warehouse), lot: (m.lot as string | null) ?? null };
      const moved = await p.stock.moveExact(p.src(p.ctx.today), { ...place, held: true }, place, num(m.qty), num(m.value));
      p.track(moved.out);
      p.track(moved.in);
      const lot = await p.cache.get("lot", place.lot);
      if (lot?.status === "quarantine") {
        lot.status = "available";
        p.cache.put(lot);
      }
    }
  },

  async "batch.reject"(p) {
    let value = 0;
    let wh: string | undefined;
    for (const m of (await p.movesOf("finish")).filter((m) => m.held && num(m.qty) > 0)) {
      wh = String(m.warehouse);
      p.track(await p.stock.removeExact(p.src(p.ctx.today), { item: String(m.item), warehouse: wh, lot: (m.lot as string | null) ?? null, held: true }, num(m.qty), num(m.value)));
      value += num(m.value);
    }
    if (wh) await p.journal([{ role: "scrap", debit: value }, { role: await p.invRole(wh), credit: value }], p.ctx.today);
  },

  async "ncr.close"(p) {
    if (p.rec.data.disposition !== "scrap") return;
    const lot = str(p.rec.data.lot);
    const item = str(p.rec.data.item) ?? str((await p.cache.get("lot", lot))?.data.item);
    const it = await p.tracked(item);
    const qty = num(p.rec.data.quantity);
    if (!it || qty <= 0) return;
    const levels = await p.stock.levelsOf(it.id, (d) => d.warehouse !== TRANSIT && num(d.qty) > EPS && (!lot || d.lot === lot));
    levels.sort((x, y) => Number(Boolean(y.data.held)) - Number(Boolean(x.data.held)));
    const from = levels[0];
    const wh = from ? String(from.data.warehouse) : await p.store();
    const value = await p.issueGoods(it, wh, qty, { lot: from?.data.lot ?? lot }, Boolean(from?.data.held));
    await p.journal([{ role: "scrap", debit: value }, { role: await p.invRole(wh), credit: value }], p.ctx.today);
  },

  /* accounts */
  async "journal.post"(p) {
    await p.journal(rows(p.rec).map((l) => ({ account: String(l.account), debit: num(l.debit), credit: num(l.credit), memo: str(l.description) })));
  },

  async "fixed_asset.dispose"(p) {
    await disposeAsset(p);
  },

  async "fixed_asset.write_off"(p) {
    await disposeAsset(p);
  },

  async "vat_return.finalise"(p) {
    // Each part's input tax is set against its own output tax (CGST against CGST).
    let output = 0;
    let input = 0;
    const lines: JournalLine[] = [];
    for (const part of returnParts(p)) {
      const o = await balanceOf(p, part.output);
      const i = part.input ? await balanceOf(p, part.input) : 0;
      output += o;
      input += i;
      const offset = Math.max(0, Math.min(o, i));
      lines.push({ role: part.output, debit: offset });
      if (part.input) lines.push({ role: part.input, credit: offset });
    }
    p.rec.data.output_vat = output;
    p.rec.data.input_vat = input;
    p.rec.data.net_payable = output - input;
    await p.journal(lines, p.ctx.today);
  },

  async "vat_return.pay"(p) {
    const due = num(p.rec.data.net_payable);
    if (due <= 0) return;
    const bank = await p.books.defaultBank();
    const parts = returnParts(p);
    const lines: JournalLine[] = [];
    let left = due;
    for (const [n, part] of parts.entries()) {
      const pay = n === parts.length - 1 ? left : Math.min(left, Math.max(0, await balanceOf(p, part.output)));
      left -= pay;
      lines.push({ role: part.output, debit: pay });
    }
    await p.journal([...lines, { role: await p.books.roleOfBank(bank?.id), credit: due, bank_account: bank?.id }], p.ctx.today);
  },
};

async function disposeAsset(p: Posting) {
  const cost = num(p.rec.data.cost);
  const wdv = p.rec.data.written_down_value === undefined || p.rec.data.written_down_value === null ? cost : num(p.rec.data.written_down_value);
  await p.journal([{ role: "accumulated_depreciation", debit: cost - wdv }, { role: "asset_disposal", debit: wdv }, { role: "fixed_assets", credit: cost }], p.ctx.today);
}

/** The output and input roles a tax return settles: the registered taxes on sales, else plain VAT. */
function returnParts(p: Posting): { output: SystemRole; input?: SystemRole }[] {
  const out = new Map<SystemRole, SystemRole | undefined>();
  for (const t of p.taxes.registered) {
    if (t.kind !== "value_added" && t.kind !== "sales") continue;
    for (const x of taxParts(t)) if (!out.has(x.output)) out.set(x.output, t.appliesTo === "sales" ? undefined : x.input);
  }
  if (!out.size) out.set("vat_output", "vat_input");
  return [...out].map(([output, input]) => ({ output, input }));
}

/** A tax amount split across a tax's parts by share, the last part taking the rounding. */
function split(amount: number, parts: readonly TaxPart[], role: (part: TaxPart) => SystemRole, side: "debit" | "credit"): JournalLine[] {
  let left = amount;
  return parts.map((x, i) => {
    const a = i === parts.length - 1 ? left : Math.round(amount * x.share);
    left -= a;
    return { role: role(x), [side]: a };
  });
}

/** An account's balance on its normal side, in minor units. */
async function balanceOf(p: Posting, role: SystemRole): Promise<number> {
  const acc = await p.cache.get("account", await p.books.accountFor(role));
  return num(acc?.data.balance);
}

/** Labour and machine time on a batch's operations, costed at each resource's hourly rate. */
async function conversionCost(p: Posting): Promise<{ labour: number; overhead: number }> {
  let labour = 0;
  let overhead = 0;
  for (const op of rows(p.rec, "operations")) {
    if (op.status === "skipped") continue;
    const minutes = num(op.actual_setup_minutes) + num(op.actual_run_minutes) || num(op.setup_minutes) + num(op.run_minutes);
    if (minutes <= 0) continue;
    const rate = async (id: unknown) => num((await p.cache.get("resource", id))?.data.hourly_rate);
    const l = Math.round(((await rate(op.labour)) * (num(op.labour_count) || 1) * minutes) / 60);
    const o = Math.round((((await rate(op.machine)) || (await rate(op.work_centre))) * minutes) / 60);
    op.cost = l + o;
    labour += l;
    overhead += o;
  }
  return { labour, overhead };
}
