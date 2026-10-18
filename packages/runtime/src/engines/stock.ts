import type { StoredRecord } from "../store";
import { Cache, EPS, EngineRule, STOCK_ITEM, STOCK_LEVEL, STOCK_MOVE, engineRecord, num, q3, type EngineCtx } from "./context";

/**
 * The inventory engine: stock levels per item, store and lot, each carrying
 * its quantity and value, and a movement for every change. Costing follows
 * settings.inventory.costingMethod: weighted average keeps one average per
 * level; FIFO keeps layers and takes the oldest first. Value is the
 * authority (the ledger posts exactly what a movement says it moved), so
 * stock valuation always equals the inventory accounts.
 *
 * Goods on quality hold sit on their own level (held) until released, and
 * goods between stores sit at TRANSIT until received.
 */

export const TRANSIT = "transit";

export interface Place {
  item: string;
  warehouse: string;
  lot?: string | null;
  held?: boolean;
}

interface Layer {
  qty: number;
  value: number;
}

export interface MoveSource {
  date: string;
  target: string;
  id: string;
  number?: string;
  action: string;
}

export interface Moved {
  id: string;
  qty: number;
  value: number;
}

const levelId = (p: Place) => `stl_${p.item}_${p.warehouse}_${p.lot || "x"}_${p.held ? "h" : "a"}`;

export class Stock {
  private warned = new Set<string>();

  constructor(
    private ctx: EngineCtx,
    private cache: Cache,
  ) {}

  private get fifo() {
    return this.ctx.c.bp.settings.inventory.costingMethod === "fifo";
  }

  async level(p: Place): Promise<StoredRecord> {
    const id = levelId(p);
    return (await this.cache.get(STOCK_LEVEL, id)) ?? engineRecord(this.ctx, STOCK_LEVEL, id, { item: p.item, warehouse: p.warehouse, lot: p.lot || null, held: Boolean(p.held), qty: 0, value: 0, layers: [] });
  }

  /** Levels of an item that hold stock, for picking lots or finding quarantined goods. */
  async levelsOf(item: string, filter: (d: Record<string, unknown>) => boolean = () => true): Promise<StoredRecord[]> {
    return (await this.cache.list(STOCK_LEVEL)).filter((l) => l.data.item === item && filter(l.data));
  }

  /** Cost of one unit for goods that aren't there to cost: the level's average, the item's, else its purchase price. */
  async unitCost(item: string, level?: StoredRecord): Promise<number> {
    if (level && num(level.data.qty) > EPS) return num(level.data.value) / num(level.data.qty);
    const agg = await this.cache.get(STOCK_ITEM, `sti_${item}`);
    if (agg && num(agg.data.qty) > EPS && num(agg.data.value) > 0) return num(agg.data.value) / num(agg.data.qty);
    const it = await this.cache.get("item", item);
    return num(it?.data.avg_cost) || num(it?.data.purchase_price);
  }

  /** Goods come in at a known value. */
  async receive(src: MoveSource, p: Place, qty: number, value: number): Promise<Moved> {
    const l = await this.level(p);
    const layers = this.layers(l);
    if (this.fifo) layers.push({ qty, value });
    return this.write(src, l, layers, qty, value, "in");
  }

  /** Goods go out at cost. Returns the value that left. */
  async issue(src: MoveSource, p: Place, qty: number): Promise<Moved> {
    const l = await this.level(p);
    await this.checkEnough(l, qty);
    const layers = this.layers(l);
    const have = num(l.data.qty);
    let value = 0;
    let short = qty;
    if (this.fifo) {
      while (layers.length) {
        const top = layers[0]!;
        if (top.qty < -EPS) break;
        if (top.qty <= EPS) {
          // A layer left with value but no quantity goes with the next issue.
          value += top.value;
          layers.shift();
          continue;
        }
        if (short <= EPS) break;
        if (top.qty <= short + EPS) {
          value += top.value;
          short = q3(short - top.qty);
          layers.shift();
        } else {
          const part = Math.round((top.value * short) / top.qty);
          value += part;
          top.qty = q3(top.qty - short);
          top.value -= part;
          short = 0;
        }
      }
    } else if (have >= qty - EPS) {
      value = Math.abs(have - qty) <= EPS ? num(l.data.value) : Math.round((num(l.data.value) * qty) / have);
      short = 0;
    } else if (have > EPS) {
      value = num(l.data.value);
      short = q3(qty - have);
    }
    if (short > EPS) {
      const sv = Math.round(short * (await this.unitCost(p.item, have > EPS ? l : undefined)));
      value += sv;
      if (this.fifo) layers.push({ qty: -short, value: -sv });
    }
    return this.write(src, l, layers, -qty, -value, "out");
  }

  /** Undo goods coming in, at exactly the value they came in at (a void). */
  async removeExact(src: MoveSource, p: Place, qty: number, value: number): Promise<Moved> {
    const l = await this.level(p);
    await this.checkEnough(l, qty, true);
    const layers = this.layers(l);
    if (this.fifo) {
      let need = qty;
      while (need > EPS && layers.length && layers[layers.length - 1]!.qty > EPS) {
        const last = layers[layers.length - 1]!;
        if (last.qty <= need + EPS) {
          need = q3(need - last.qty);
          layers.pop();
        } else {
          last.value -= Math.round((last.value * need) / last.qty);
          last.qty = q3(last.qty - need);
          need = 0;
        }
      }
      if (need > EPS) layers.push({ qty: -need, value: 0 });
    }
    return this.write(src, l, layers, -qty, -value, "out");
  }

  /** Undo goods going out, at exactly the value they left at (a void). Back in as the oldest layer. */
  async restoreExact(src: MoveSource, p: Place, qty: number, value: number): Promise<Moved> {
    const l = await this.level(p);
    const layers = this.layers(l);
    if (this.fifo) layers.unshift({ qty, value });
    return this.write(src, l, layers, qty, value, "in");
  }

  /** Move goods between places (stores, hold, transit) at cost; the value moves with them. */
  async move(src: MoveSource, from: Place, to: Place, qty: number): Promise<{ out: Moved; in: Moved }> {
    const out = await this.issue(src, from, qty);
    const inn = await this.receive(src, to, qty, -out.value);
    return { out, in: inn };
  }

  /** Move an exact quantity and value, e.g. out of transit or off hold. */
  async moveExact(src: MoveSource, from: Place, to: Place, qty: number, value: number): Promise<{ out: Moved; in: Moved }> {
    const out = await this.removeExact(src, from, qty, value);
    const inn = await this.receive(src, to, qty, value);
    return { out, in: inn };
  }

  private layers(l: StoredRecord): Layer[] {
    return this.fifo ? ((l.data.layers as Layer[] | undefined) ?? []).map((x) => ({ ...x })) : [];
  }

  /** Stock going below zero, per settings.inventory.negativeStock. */
  private async checkEnough(l: StoredRecord, qty: number, undoing = false) {
    if (l.data.warehouse === TRANSIT || l.data.held) return;
    const have = num(l.data.qty);
    if (have - qty >= -EPS) return;
    const mode = this.ctx.c.bp.settings.inventory.negativeStock;
    if (mode === "off") return;
    const item = await this.cache.get("item", l.data.item);
    const wh = await this.cache.get("warehouse", l.data.warehouse);
    const name = String(item?.data.name ?? "this item");
    const where = wh ? ` in ${String(wh.data.name ?? wh.data.code)}` : "";
    const message = undoing
      ? `Undoing this would take ${name}${where} below zero: ${fmt(have)} on hand, ${fmt(qty)} to take back. The goods have been used since.`
      : `Not enough ${name}${where}: ${fmt(have)} on hand, ${fmt(qty)} needed.`;
    if (mode === "block") throw new EngineRule(message);
    const key = `${l.id}`;
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.ctx.warn(`${message} Stock goes below zero.`);
    }
  }

  private async write(src: MoveSource, l: StoredRecord, layers: Layer[], dq: number, dv: number, kind: "in" | "out"): Promise<Moved> {
    l.data.qty = q3(num(l.data.qty) + dq);
    l.data.value = num(l.data.value) + dv;
    if (this.fifo) {
      net(layers);
      // Layers always add up to the level, so rounding never drifts the value.
      const residual = num(l.data.value) - layers.reduce((s, x) => s + x.value, 0);
      if (residual) {
        if (layers.length) layers[0]!.value += residual;
        else layers.push({ qty: 0, value: residual });
      }
      l.data.layers = layers.filter((x) => Math.abs(x.qty) > EPS || x.value !== 0);
    }
    l.updatedAt = this.ctx.now.toISOString();
    this.cache.put(l);

    const id = this.ctx.newId("stm_");
    const d = l.data;
    this.cache.put(
      engineRecord(this.ctx, STOCK_MOVE, id, {
        date: src.date,
        item: d.item,
        warehouse: d.warehouse,
        lot: d.lot ?? null,
        held: Boolean(d.held),
        qty: dq,
        value: dv,
        kind,
        source_target: src.target,
        source_id: src.id,
        source_number: src.number ?? null,
        action: src.action,
      }),
    );

    // Item totals: on hand (not counting goods between stores) and average cost.
    const item = String(d.item);
    const agg = (await this.cache.get(STOCK_ITEM, `sti_${item}`)) ?? engineRecord(this.ctx, STOCK_ITEM, `sti_${item}`, { item, qty: 0, value: 0, transit: 0 });
    agg.data.qty = q3(num(agg.data.qty) + dq);
    agg.data.value = num(agg.data.value) + dv;
    if (d.warehouse === TRANSIT) agg.data.transit = q3(num(agg.data.transit) + dq);
    this.cache.put(agg);
    const it = await this.cache.get("item", item);
    if (it) {
      it.data.on_hand = q3(num(agg.data.qty) - num(agg.data.transit));
      if (num(agg.data.qty) > EPS) it.data.avg_cost = Math.round(num(agg.data.value) / num(agg.data.qty));
      this.cache.put(it);
    }
    if (d.lot && d.warehouse !== TRANSIT) {
      const lot = await this.cache.get("lot", d.lot);
      if (lot) {
        lot.data.on_hand = q3(num(lot.data.on_hand) + dq);
        this.cache.put(lot);
      }
    }
    return { id, qty: dq, value: dv };
  }
}

/** Short (negative) layers are filled by the next goods in. */
function net(layers: Layer[]) {
  for (;;) {
    const ni = layers.findIndex((l) => l.qty < -EPS);
    const pi = layers.findIndex((l) => l.qty > EPS);
    if (ni < 0 || pi < 0) return;
    const a = layers[ni]!;
    const b = layers[pi]!;
    const m = { qty: q3(a.qty + b.qty), value: a.value + b.value };
    if (m.qty > EPS) {
      layers[pi] = m;
      layers.splice(ni, 1);
    } else if (m.qty < -EPS) {
      layers[ni] = m;
      layers.splice(pi, 1);
    } else {
      layers[pi] = { qty: 0, value: m.value };
      layers.splice(ni, 1);
    }
  }
}

const fmt = (n: number) => n.toLocaleString("en-LK", { maximumFractionDigits: 3 });
