import { STOCK_LEVEL, TRANSIT, titleOf, type StoredRecord } from "@shapewise/runtime";
import { loadSnapshot, stockByItem, suggestedOrder } from "@shapewise/runtime/reports";
import { cx } from "@shapewise/ui";
import { draftReorder, draftReorderPicked } from "@/app/w/[tenant]/stock-actions";
import { formatMoney, formatValue } from "@/lib/format";
import { hrefFor, type Query } from "@/lib/screens";
import type { Workspace } from "@/lib/workspace";
import { Empty, Filters, MaybeLink, Pill, SelectField, Stat, Stats, Table, TextField, td, tdNum, th, thNum } from "./kit";

/**
 * Stock screens over the inventory engine: what's on hand where, what to
 * reorder (and a draft order per supplier), and the three-way match between
 * what was ordered, received and billed.
 */

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const qty = (n: number, unit?: unknown) => `${n.toLocaleString("en-LK", { maximumFractionDigits: 3 })}${typeof unit === "string" && unit ? ` ${unit}` : ""}`;

/* ------------------------------------------------------------ stock on hand */

export async function StockOnHand({ ws, q }: { ws: Workspace; q: Query }) {
  const s = await loadSnapshot(ws.store, ws.tenant, ws.compiled, [STOCK_LEVEL, "item", "warehouse", "lot"]);
  const money = (n: number) => formatMoney(n, ws.bp.business.currency);
  const it = ws.compiled.targets.get("item")!;
  const levels = s.list(STOCK_LEVEL);
  const byItem = new Map(stockByItem(s).map((g) => [g.item, g]));
  const warehouses = s.list("warehouse").filter((w) => w.status !== "archived");
  const store = q.store && q.store !== "all" ? q.store : undefined;
  const search = (q.q ?? "").trim().toLowerCase();

  const rows = s
    .list("item")
    .filter((i) => i.status !== "archived" && i.data.type !== "service" && (i.data.track_inventory !== false || byItem.has(i.id)))
    .map((i) => {
      const mine = levels.filter((l) => l.data.item === i.id && (!store || l.data.warehouse === store) && Math.abs(num(l.data.qty)) > 0.0005);
      const onHand = mine.filter((l) => l.data.warehouse !== TRANSIT).reduce((t, l) => t + num(l.data.qty), 0);
      const held = mine.filter((l) => l.data.held).reduce((t, l) => t + num(l.data.qty), 0);
      const value = mine.reduce((t, l) => t + num(l.data.value), 0);
      const level = num(i.data.reorder_level);
      const state = onHand < -0.0005 ? "below" : onHand <= 0.0005 ? "out" : level > 0 && onHand - held <= level ? "low" : "ok";
      return { i, name: titleOf(it, i), mine, onHand, held, value, level, state };
    })
    .filter((r) => (!search || `${r.name} ${r.i.data.sku ?? ""}`.toLowerCase().includes(search)) && (q.show !== "low" || r.state !== "ok") && (!store || r.mine.length))
    .sort((a, b) => a.name.localeCompare(b.name));

  const total = rows.reduce((t, r) => t + r.value, 0);
  const lot = (id: unknown) => (id ? s.title("lot", id) : "");
  const where = (id: unknown) => (id === TRANSIT ? "Between stores" : s.title("warehouse", id));

  return (
    <div className="space-y-4">
      <Filters>
        <TextField name="q" label="Item" value={q.q} placeholder="Name or SKU" />
        {warehouses.length > 1 && <SelectField name="store" label="Store" value={q.store} placeholder="All stores" options={warehouses.map((w) => ({ value: w.id, label: String(w.data.name ?? w.data.code ?? "Store") }))} />}
        <SelectField name="show" label="Show" value={q.show} options={[{ value: "", label: "Everything" }, { value: "low", label: "Low, out or below zero" }]} />
      </Filters>
      <Stats>
        <Stat label="Items in stock" value={rows.filter((r) => r.onHand > 0.0005).length} />
        <Stat label="Stock value at cost" value={money(total)} />
        <Stat label="Low or out" value={rows.filter((r) => r.state === "low" || r.state === "out").length} tone={rows.some((r) => r.state === "low" || r.state === "out") ? "warn" : undefined} />
        <Stat label="On quality hold" value={rows.filter((r) => r.held > 0.0005).length} />
      </Stats>
      {rows.length === 0 ? (
        <Empty>{search || q.show || store ? "Nothing matches." : "No stock recorded yet. Post goods received or a stock adjustment to start."}</Empty>
      ) : (
        <Table>
          <thead>
            <tr className="border-b">
              <th className={th}>Item</th>
              <th className={th}>Where</th>
              <th className={thNum}>On hand</th>
              <th className={thNum}>Reorder at</th>
              <th className={thNum}>Value</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i.id} className="border-b last:border-0">
                <td className={td}>
                  <MaybeLink href={hrefFor(ws, "item", r.i.id)} className="font-medium">
                    {r.name}
                  </MaybeLink>
                  {typeof r.i.data.sku === "string" && r.i.data.sku && <span className="block text-xs text-ink-faint">{r.i.data.sku}</span>}
                </td>
                <td className={cx(td, "text-xs text-ink-muted")}>
                  {r.mine.length === 0
                    ? "None"
                    : r.mine.map((l) => (
                        <span key={l.id} className="block">
                          {where(l.data.warehouse)}
                          {l.data.lot ? ` · ${lot(l.data.lot)}` : ""}: <span className="tabular text-ink">{qty(num(l.data.qty))}</span>
                          {l.data.held ? " on hold" : ""}
                        </span>
                      ))}
                </td>
                <td className={cx(tdNum, "font-medium")}>{qty(r.onHand, r.i.data.unit)}</td>
                <td className={cx(tdNum, "text-ink-muted")}>{r.level ? qty(r.level) : ""}</td>
                <td className={tdNum}>{money(r.value)}</td>
                <td className={td}>{r.state === "below" ? <Pill tone="bad">Below zero</Pill> : r.state === "out" ? <Pill tone="bad">Out</Pill> : r.state === "low" ? <Pill tone="warn">Low</Pill> : null}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-surface-sunken font-medium">
              <td className={td} colSpan={4}>
                Total
              </td>
              <td className={tdNum}>{money(total)}</td>
              <td />
            </tr>
          </tfoot>
        </Table>
      )}
    </div>
  );
}

/* -------------------------------------------------------- reorder suggestions */

export async function ReorderSuggestions({ ws, q }: { ws: Workspace; q: Query }) {
  const s = await loadSnapshot(ws.store, ws.tenant, ws.compiled, [STOCK_LEVEL, "item", "purchase_order", "goods_receipt", "bill", "vendor"]);
  const money = (n: number) => formatMoney(n, ws.bp.business.currency);
  const it = ws.compiled.targets.get("item")!;
  const stock = new Map(stockByItem(s).map((g) => [g.item, g]));
  const coming = new Map<string, number>();
  const lastVendor = new Map<string, { vendor: string; date: string }>();
  for (const po of s.list("purchase_order")) {
    for (const l of (po.data.lines as Record<string, unknown>[] | undefined) ?? []) {
      if (!l.item) continue;
      const id = String(l.item);
      if (po.status === "issued" || po.status === "partly_received") coming.set(id, (coming.get(id) ?? 0) + Math.max(0, num(l.quantity) - num(l.received_qty)));
      remember(lastVendor, id, po);
    }
  }
  for (const doc of [...s.list("goods_receipt"), ...s.list("bill")]) for (const l of (doc.data.lines as Record<string, unknown>[] | undefined) ?? []) if (l.item) remember(lastVendor, String(l.item), doc);

  const rows = s
    .list("item")
    .filter((i) => i.status !== "archived" && num(i.data.reorder_level) > 0)
    .map((i) => {
      const g = stock.get(i.id);
      const usable = (g?.qty ?? 0) - (g?.held ?? 0);
      const onOrder = coming.get(i.id) ?? 0;
      return { i, name: titleOf(it, i), usable, onOrder, level: num(i.data.reorder_level), suggested: suggestedOrder(i, usable + onOrder), vendor: lastVendor.get(i.id)?.vendor };
    })
    .filter((r) => r.usable + r.onOrder <= r.level && r.suggested > 0)
    .sort((a, b) => a.usable / (a.level || 1) - b.usable / (b.level || 1));

  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.vendor ?? "", [...(groups.get(r.vendor ?? "") ?? []), r]);
  const canOrder = ws.compiled.can(ws.actor.roleKey, ws.compiled.targets.get("purchase_order")?.submodule ?? "purchase_orders", "create");
  const vendors = s.list("vendor").filter((v) => v.status !== "archived" && v.data.approval_status !== "blocked");

  if (!rows.length) {
    return (
      <div className="space-y-3">
        {q.error && <p role="alert" className="rounded-sw bg-danger-bg px-3 py-2 text-sm text-danger-fg">{q.error}</p>}
        <Empty>Nothing needs reordering. Items appear here when their usable stock, plus what's already on order, falls to their reorder level.</Empty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {q.error && <p role="alert" className="rounded-sw bg-danger-bg px-3 py-2 text-sm text-danger-fg">{q.error}</p>}
      <p className="text-sm text-ink-muted">
        {rows.length} {rows.length === 1 ? "item is" : "items are"} at or below the reorder level. Suggested amounts bring stock back to twice the reorder level, in the item's minimum and multiples. Goods on quality hold don't count.
      </p>
      {[...groups.entries()].map(([vendor, items]) => {
        const value = items.reduce((t, r) => t + Math.round(num(r.i.data.purchase_price) * r.suggested), 0);
        const order = draftReorder.bind(null, ws.tenant, vendor, items.map((r) => ({ item: r.i.id, quantity: r.suggested })));
        return (
          <section key={vendor || "none"} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">{vendor ? <MaybeLink href={hrefFor(ws, "vendor", vendor)}>{s.title("vendor", vendor)}</MaybeLink> : "No supplier yet"}</h2>
              {canOrder &&
                (vendor ? (
                  <form action={order}>
                    <button type="submit" className="h-8 rounded-sw bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover">
                      Draft a purchase order{value ? ` (${money(value)})` : ""}
                    </button>
                  </form>
                ) : vendors.length > 0 ? (
                  <form action={draftReorderPicked.bind(null, ws.tenant, items.map((r) => ({ item: r.i.id, quantity: r.suggested })))} className="flex gap-2">
                    <select name="vendor" required aria-label="Supplier" className="h-8 rounded-sw border border-border-strong bg-canvas px-2 text-[13px]">
                      <option value="">Choose a supplier</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {String(v.data.name ?? "Vendor")}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="h-8 rounded-sw bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover">
                      Draft order
                    </button>
                  </form>
                ) : null)}
            </div>
            <Table>
              <thead>
                <tr className="border-b">
                  <th className={th}>Item</th>
                  <th className={thNum}>Usable stock</th>
                  <th className={thNum}>On order</th>
                  <th className={thNum}>Reorder at</th>
                  <th className={thNum}>Suggested</th>
                  <th className={thNum}>At cost</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.i.id} className="border-b last:border-0">
                    <td className={td}>
                      <MaybeLink href={hrefFor(ws, "item", r.i.id)}>{r.name}</MaybeLink>
                    </td>
                    <td className={cx(tdNum, r.usable <= 0 && "text-danger-fg")}>{qty(r.usable, r.i.data.unit)}</td>
                    <td className={cx(tdNum, "text-ink-muted")}>{r.onOrder ? qty(r.onOrder) : ""}</td>
                    <td className={cx(tdNum, "text-ink-muted")}>{qty(r.level)}</td>
                    <td className={cx(tdNum, "font-medium")}>{qty(r.suggested, r.i.data.unit)}</td>
                    <td className={tdNum}>{num(r.i.data.purchase_price) ? money(Math.round(num(r.i.data.purchase_price) * r.suggested)) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        );
      })}
    </div>
  );
}

function remember(m: Map<string, { vendor: string; date: string }>, item: string, doc: StoredRecord) {
  const vendor = doc.data.vendor;
  const date = String(doc.data.date ?? doc.createdAt);
  if (typeof vendor !== "string" || !vendor) return;
  const had = m.get(item);
  if (!had || had.date < date) m.set(item, { vendor, date });
}

/* -------------------------------------------------------- three-way match */

type MatchState = "matched" | "price" | "over_billed" | "not_received" | "within";

export async function ThreeWayMatch({ ws, q }: { ws: Workspace; q: Query }) {
  const s = await loadSnapshot(ws.store, ws.tenant, ws.compiled, ["purchase_order", "goods_receipt", "bill", "vendor", "item"]);
  const money = (n: number) => formatMoney(n, ws.bp.business.currency);
  const date = (d: unknown) => (typeof d === "string" ? formatValue({ type: "date" }, d, { currency: "" }) : "");
  const tol = ws.bp.settings.purchasing.matchTolerancePct / 100;
  const receipts = s.list("goods_receipt").filter((g) => g.status === "posted");
  const bills = s.list("bill").filter((b) => b.status !== "void" && b.status !== "cancelled");

  const rows = bills
    .filter((b) => typeof b.data.purchase_order === "string" && b.data.purchase_order)
    .map((b) => {
      const po = s.get("purchase_order", b.data.purchase_order);
      const grns = receipts.filter((g) => g.data.purchase_order === b.data.purchase_order);
      const lines = ((b.data.lines as Record<string, unknown>[] | undefined) ?? []).filter((l) => l.item).map((l) => {
        const item = String(l.item);
        const ordered = ((po?.data.lines as Record<string, unknown>[] | undefined) ?? []).filter((x) => x.item === item);
        const orderedQty = ordered.reduce((t, x) => t + num(x.quantity), 0);
        const orderedPrice = ordered.length ? num(ordered[0]!.unit_price) : 0;
        // The order keeps what has arrived against each line; receipts linked to the order are a fallback.
        const onOrder = ordered.reduce((t, x) => t + num(x.received_qty), 0);
        const viaReceipts = grns.flatMap((g) => (g.data.lines as Record<string, unknown>[] | undefined) ?? []).filter((x) => x.item === item).reduce((t, x) => t + num(x.quantity), 0);
        const received = Math.max(onOrder, viaReceipts);
        const billedQty = num(l.quantity);
        const billedPrice = num(l.unit_price);
        const priceOff = orderedPrice > 0 && Math.abs(billedPrice - orderedPrice) / orderedPrice;
        const qtyOff = received > 0 ? (billedQty - received) / received : billedQty > 0 ? 1 : 0;
        const state: MatchState = received <= 0 ? "not_received" : qtyOff > tol ? "over_billed" : priceOff !== false && priceOff > tol ? "price" : qtyOff > 0 || (priceOff !== false && priceOff > 0) ? "within" : "matched";
        return { item, orderedQty, orderedPrice, received, billedQty, billedPrice, state };
      });
      const worst: MatchState = lines.find((l) => l.state === "not_received")?.state ?? lines.find((l) => l.state === "over_billed")?.state ?? lines.find((l) => l.state === "price")?.state ?? (lines.some((l) => l.state === "within") ? "within" : "matched");
      return { b, po, grns, lines, state: worst };
    })
    .filter((r) => q.show !== "problems" || r.state === "not_received" || r.state === "over_billed" || r.state === "price")
    .sort((a, b) => String(b.b.data.date).localeCompare(String(a.b.data.date)));

  const unmatched = bills.filter((b) => !b.data.purchase_order && (b.data.lines as unknown[] | undefined)?.length).length;
  const notBilled = s.list("purchase_order").filter((po) => (po.status === "received" || po.status === "partly_received") && !bills.some((b) => b.data.purchase_order === po.id));
  const label: Record<MatchState, { text: string; tone: "good" | "bad" | "warn" | "info" }> = {
    matched: { text: "Matched", tone: "good" },
    within: { text: "Within tolerance", tone: "info" },
    price: { text: "Price differs", tone: "warn" },
    over_billed: { text: "Billed more than received", tone: "bad" },
    not_received: { text: "Nothing received", tone: "bad" },
  };
  const all = rows.length;
  const bt = ws.compiled.targets.get("bill");
  const pt = ws.compiled.targets.get("purchase_order");

  return (
    <div className="space-y-4">
      <Filters>
        <SelectField name="show" label="Show" value={q.show} options={[{ value: "", label: "Every bill against an order" }, { value: "problems", label: "Only problems" }]} />
      </Filters>
      <Stats>
        <Stat label="Bills checked" value={all} />
        <Stat label="Need a look" value={rows.filter((r) => r.state === "price" || r.state === "over_billed" || r.state === "not_received").length} tone={rows.some((r) => r.state === "over_billed" || r.state === "not_received") ? "bad" : undefined} />
        <Stat label="Received, not billed yet" value={notBilled.length} note="Orders with goods in and no bill" />
        <Stat label="Bills without an order" value={unmatched} note="Can't be matched" />
      </Stats>
      <p className="text-xs text-ink-faint">Each bill line is compared with the purchase order's price and with the quantity posted on goods received notes. Differences up to {ws.bp.settings.purchasing.matchTolerancePct}% are allowed (change this in purchasing settings).</p>
      {rows.length === 0 ? (
        <Empty>{q.show === "problems" ? "No problems. Every bill agrees with its order and what was received." : "No bills against purchase orders yet. Create a bill from a purchase order or goods received note to match it."}</Empty>
      ) : (
        rows.map((r) => (
          <section key={r.b.id} className="rounded-sw border bg-surface">
            <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5 text-sm">
              <MaybeLink href={hrefFor(ws, "bill", r.b.id)} className="font-medium">
                {bt ? titleOf(bt, r.b) : "Bill"}
              </MaybeLink>
              <span className="text-ink-muted">{s.title("vendor", r.b.data.vendor)}</span>
              <span className="text-ink-faint">{date(r.b.data.date)}</span>
              <span className="text-ink-faint">
                Order <MaybeLink href={r.po ? hrefFor(ws, "purchase_order", r.po.id) : undefined}>{r.po && pt ? titleOf(pt, r.po) : "missing"}</MaybeLink>
                {r.grns.length > 0 && <> · {r.grns.length} {r.grns.length === 1 ? "receipt" : "receipts"}</>}
              </span>
              <span className="ml-auto">
                <Pill tone={label[r.state].tone}>{label[r.state].text}</Pill>
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className={th}>Item</th>
                    <th className={thNum}>Ordered</th>
                    <th className={thNum}>Received</th>
                    <th className={thNum}>Billed</th>
                    <th className={thNum}>Order price</th>
                    <th className={thNum}>Bill price</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className={td}>{s.title("item", l.item)}</td>
                      <td className={tdNum}>{qty(l.orderedQty)}</td>
                      <td className={cx(tdNum, l.state === "not_received" && "text-danger-fg")}>{qty(l.received)}</td>
                      <td className={cx(tdNum, l.state === "over_billed" && "font-medium text-danger-fg")}>{qty(l.billedQty)}</td>
                      <td className={tdNum}>{l.orderedPrice ? money(l.orderedPrice) : ""}</td>
                      <td className={cx(tdNum, l.state === "price" && "font-medium text-warning-fg")}>{money(l.billedPrice)}</td>
                      <td className={td}>{l.state !== "matched" && <Pill tone={label[l.state].tone}>{label[l.state].text}</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
