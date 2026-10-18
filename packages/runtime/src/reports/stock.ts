import { STOCK_LEVEL, STOCK_MOVE } from "../engines/context";
import { TRANSIT } from "../engines/stock";
import type { StoredRecord } from "../store";
import { addDays, daysBetween, groupSum, num, str, within, type ReportImpl, type ReportRow, type Snapshot } from "./engine";

/**
 * Reports read from the inventory engine: stock levels per item, store and
 * lot (quantity and value at cost), and the movements behind them.
 */

const LEVEL_READS = [STOCK_LEVEL, "item", "warehouse", "lot"] as const;
const EPS = 0.0005;

/** Stock per item, adding up its stores and lots; goods between stores counted apart. */
export function stockByItem(s: Snapshot) {
  const by = new Map<string, { item: string; qty: number; value: number; held: number; transit: number; stores: Set<string> }>();
  for (const l of s.list(STOCK_LEVEL)) {
    const item = String(l.data.item);
    const g = by.get(item) ?? { item, qty: 0, value: 0, held: 0, transit: 0, stores: new Set<string>() };
    const qty = num(l.data.qty);
    g.value += num(l.data.value);
    if (l.data.warehouse === TRANSIT) g.transit += qty;
    else {
      g.qty += qty;
      if (l.data.held) g.held += qty;
      if (Math.abs(qty) > EPS) g.stores.add(String(l.data.warehouse));
    }
    by.set(item, g);
  }
  return [...by.values()].map((g) => ({ ...g, qty: q3(g.qty), held: q3(g.held), transit: q3(g.transit) }));
}

const q3 = (n: number) => Math.round(n * 1000) / 1000;
const storeName = (s: Snapshot, id: string) => (id === TRANSIT ? "Between stores" : s.title("warehouse", id));

export const stockOnHand: ReportImpl = {
  reads: LEVEL_READS,
  run(s) {
    const rows: ReportRow[] = s
      .list(STOCK_LEVEL)
      .filter((l) => Math.abs(num(l.data.qty)) > EPS)
      .map((l) => ({
        label: s.title("item", l.data.item),
        store: storeName(s, String(l.data.warehouse)),
        lot: l.data.lot ? s.title("lot", l.data.lot) : "",
        state: l.data.held ? "On hold" : num(l.data.qty) < 0 ? "Below zero" : "",
        quantity: num(l.data.qty),
        unit: str(s.get("item", l.data.item)?.data.unit) ?? "",
        value: num(l.data.value),
      }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label)) || String(a.store).localeCompare(String(b.store)));
    const items = new Set(s.list(STOCK_LEVEL).filter((l) => num(l.data.qty) > EPS && l.data.warehouse !== TRANSIT).map((l) => String(l.data.item)));
    return {
      headline: { label: "Items in stock", value: items.size, unit: "count" },
      columns: [
        { key: "label", label: "Item", type: "text" },
        { key: "store", label: "Store", type: "text" },
        ...(rows.some((r) => r.lot) ? [{ key: "lot", label: "Lot", type: "text" as const }] : []),
        { key: "state", label: "", type: "text" },
        { key: "quantity", label: "On hand", type: "quantity" },
        { key: "unit", label: "Unit", type: "text" },
        { key: "value", label: "Value", type: "money" },
      ],
      rows,
      totals: { label: "Total", store: "", lot: "", state: "", quantity: null, unit: "", value: rows.reduce((t, r) => t + num(r.value), 0) },
      note: "Stock in every store now, valued at cost.",
      empty: "No stock recorded yet. Post goods received or an opening stock count.",
    };
  },
};

export const stockValuation: ReportImpl = {
  reads: LEVEL_READS,
  run(s) {
    const items = stockByItem(s).filter((g) => Math.abs(g.qty + g.transit) > EPS || g.value !== 0);
    const rows = items
      .map((g) => ({ label: s.title("item", g.item), quantity: q3(g.qty + g.transit), avg_cost: Math.abs(g.qty + g.transit) > EPS ? Math.round(g.value / (g.qty + g.transit)) : null, value: g.value }))
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((t, r) => t + r.value, 0);
    const byStore = groupSum(s.list(STOCK_LEVEL), (l) => storeName(s, String(l.data.warehouse)), (l) => num(l.data.value)).filter((g) => g.value !== 0);
    return {
      headline: { label: "Stock value", value: total, unit: "money", items: rows.slice(0, 3).map((r) => ({ label: r.label, value: r.value })) },
      columns: [
        { key: "label", label: "Item", type: "text" },
        { key: "quantity", label: "Quantity", type: "quantity" },
        { key: "avg_cost", label: "Average cost", type: "money" },
        { key: "value", label: "Value", type: "money" },
      ],
      rows,
      totals: { label: "Total", quantity: null, avg_cost: null, value: total },
      chart: { type: "bar", unit: "money", points: byStore.map((g) => ({ label: g.label, value: g.value })) },
      note: "Stock at cost, the same figure as the inventory accounts in the books.",
      empty: "No stock recorded yet.",
    };
  },
};

/** How much to order: back up to twice the reorder level, at least the minimum order, in whole order multiples. */
export function suggestedOrder(item: StoredRecord, onHand: number): number {
  const level = num(item.data.reorder_level);
  let qty = Math.max(level * 2 - onHand, num(item.data.min_order_qty), 0);
  const multiple = num(item.data.order_multiple);
  if (multiple > 0) qty = Math.ceil(qty / multiple - EPS) * multiple;
  return q3(qty);
}

export const reorder: ReportImpl = {
  reads: [...LEVEL_READS, "purchase_order"],
  run(s) {
    const stock = new Map(stockByItem(s).map((g) => [g.item, g]));
    // Ordered and not yet received counts towards what's coming.
    const coming = new Map<string, number>();
    for (const po of s.list("purchase_order")) {
      if (po.status !== "issued" && po.status !== "partly_received") continue;
      for (const l of (po.data.lines as Record<string, unknown>[] | undefined) ?? []) if (l.item) coming.set(String(l.item), (coming.get(String(l.item)) ?? 0) + Math.max(0, num(l.quantity) - num(l.received_qty)));
    }
    const rows = s
      .list("item")
      .filter((it) => it.status !== "archived" && num(it.data.reorder_level) > 0)
      .map((it) => {
        const g = stock.get(it.id);
        const onHand = q3((g?.qty ?? 0) - (g?.held ?? 0));
        return { it, onHand, coming: q3(coming.get(it.id) ?? 0) };
      })
      .filter((x) => x.onHand + x.coming <= num(x.it.data.reorder_level))
      .map((x) => ({ label: str(x.it.data.name) ?? "Item", on_hand: x.onHand, reorder_level: num(x.it.data.reorder_level), on_order: x.coming, suggested: suggestedOrder(x.it, x.onHand + x.coming), unit: str(x.it.data.unit) ?? "" }))
      .sort((a, b) => a.on_hand / (a.reorder_level || 1) - b.on_hand / (b.reorder_level || 1));
    return {
      headline: { label: "Items to reorder", value: rows.length, unit: "count", items: rows.slice(0, 3).map((r) => ({ label: r.label, value: r.on_hand })) },
      columns: [
        { key: "label", label: "Item", type: "text" },
        { key: "on_hand", label: "Usable stock", type: "quantity" },
        { key: "on_order", label: "On order", type: "quantity" },
        { key: "reorder_level", label: "Reorder level", type: "quantity" },
        { key: "suggested", label: "Suggested order", type: "quantity" },
        { key: "unit", label: "Unit", type: "text" },
      ],
      rows,
      note: "Items whose usable stock plus what is on order is at or below their reorder level. Goods on quality hold aren't counted.",
      empty: "Nothing needs reordering. Set reorder levels on items to be told when they run low.",
    };
  },
};

export const stockMovement: ReportImpl = {
  reads: [STOCK_MOVE, "item"],
  period: "month",
  run(s, ctx) {
    const range = ctx.range!;
    const by = new Map<string, { qin: number; qout: number; vin: number; vout: number }>();
    for (const m of s.list(STOCK_MOVE)) {
      // Moves between stores, on and off hold, net to nothing for the business.
      if (!within(String(m.data.date), range) || m.data.warehouse === TRANSIT || ["stock_transfer", "inspection"].includes(String(m.data.source_target)) || (m.data.source_target === "batch" && m.data.action === "release")) continue;
      const g = by.get(String(m.data.item)) ?? { qin: 0, qout: 0, vin: 0, vout: 0 };
      if (num(m.data.qty) > 0) {
        g.qin += num(m.data.qty);
        g.vin += num(m.data.value);
      } else {
        g.qout -= num(m.data.qty);
        g.vout -= num(m.data.value);
      }
      by.set(String(m.data.item), g);
    }
    const rows = [...by.entries()].map(([item, g]) => ({ label: s.title("item", item), in: q3(g.qin), out: q3(g.qout), net: q3(g.qin - g.qout), value_in: g.vin, value_out: g.vout })).sort((a, b) => b.out - a.out);
    return {
      headline: { label: `Stock value used ${range.label.toLowerCase()}`, value: rows.reduce((t, r) => t + r.value_out, 0), unit: "money" },
      columns: [
        { key: "label", label: "Item", type: "text" },
        { key: "in", label: "In", type: "quantity" },
        { key: "out", label: "Out", type: "quantity" },
        { key: "net", label: "Change", type: "quantity" },
        { key: "value_in", label: "Value in", type: "money" },
        { key: "value_out", label: "Value out", type: "money" },
      ],
      rows,
      note: "Goods received, made, sold, used and adjusted in the period, at cost. Moves between stores are left out.",
      empty: "No stock moved in this period.",
    };
  },
};

export const slowMoving: ReportImpl = {
  reads: [...LEVEL_READS, STOCK_MOVE],
  run(s, ctx) {
    const lastOut = new Map<string, string>();
    for (const m of s.list(STOCK_MOVE)) {
      if (num(m.data.qty) >= 0 || m.data.source_target === "stock_transfer") continue;
      const item = String(m.data.item);
      const d = String(m.data.date);
      if (!lastOut.has(item) || lastOut.get(item)! < d) lastOut.set(item, d);
    }
    const cutoff = addDays(ctx.today, -90);
    const rows = stockByItem(s)
      .filter((g) => g.qty > EPS && (!lastOut.has(g.item) || lastOut.get(g.item)! < cutoff))
      .map((g) => ({ label: s.title("item", g.item), quantity: g.qty, value: g.value, last_used: lastOut.get(g.item) ?? null, days: lastOut.has(g.item) ? daysBetween(lastOut.get(g.item)!, ctx.today) : null }))
      .sort((a, b) => b.value - a.value);
    return {
      headline: { label: "Value sitting unused 90 days or more", value: rows.reduce((t, r) => t + r.value, 0), unit: "money" },
      columns: [
        { key: "label", label: "Item", type: "text" },
        { key: "quantity", label: "On hand", type: "quantity" },
        { key: "value", label: "Value", type: "money" },
        { key: "last_used", label: "Last went out", type: "date" },
        { key: "days", label: "Days since", type: "count" },
      ],
      rows,
      note: "Items in stock that haven't been sold or used in the last 90 days.",
      empty: "Everything in stock has moved in the last 90 days.",
    };
  },
};

export const expiry: ReportImpl = {
  reads: [...LEVEL_READS, "lot"],
  run(s, ctx) {
    const days = 90;
    const until = addDays(ctx.today, days);
    const qty = new Map<string, { qty: number; value: number }>();
    for (const l of s.list(STOCK_LEVEL)) {
      if (!l.data.lot || l.data.warehouse === TRANSIT) continue;
      const g = qty.get(String(l.data.lot)) ?? { qty: 0, value: 0 };
      g.qty += num(l.data.qty);
      g.value += num(l.data.value);
      qty.set(String(l.data.lot), g);
    }
    const rows = s
      .list("lot")
      .filter((lot) => str(lot.data.expiry_date) && lot.data.expiry_date! <= until && (qty.get(lot.id)?.qty ?? 0) > EPS)
      .map((lot) => ({ label: str(lot.data.lot_no) ?? "Lot", item: s.title("item", lot.data.item), expiry: String(lot.data.expiry_date), days: daysBetween(ctx.today, String(lot.data.expiry_date)), quantity: q3(qty.get(lot.id)!.qty), value: qty.get(lot.id)!.value }))
      .sort((a, b) => a.expiry.localeCompare(b.expiry));
    return {
      headline: { label: `Lots expiring within ${days} days`, value: rows.length, unit: "count" },
      columns: [
        { key: "label", label: "Lot", type: "text" },
        { key: "item", label: "Item", type: "text" },
        { key: "expiry", label: "Expires", type: "date" },
        { key: "days", label: "Days left", type: "count" },
        { key: "quantity", label: "On hand", type: "quantity" },
        { key: "value", label: "Value", type: "money" },
      ],
      rows,
      note: "Lots with stock that expire in the next 90 days, or already have.",
      empty: "No stock expires in the next 90 days.",
    };
  },
};
