import type { Compiled } from "../compile";
import { formatNumber } from "../data";
import type { Store, StoredRecord } from "../store";
import { addDays, daysBetween } from "./engine";

/**
 * A few months of believable trading for the public demo workspaces, so
 * their dashboards and reports have real numbers to show. Written straight
 * to the store (the demos are in memory and reset on restart), dated
 * relative to today, and the same every time for the same day.
 *
 * Only record types switched on in the workspace are written.
 */

interface Catalogue {
  customers: [name: string, terms: number][];
  vendors: [name: string, terms: number][];
  products: [sku: string, name: string, price: number, cost: number][];
  materials: [sku: string, name: string, price: number][];
  expenses: [name: string, typical: number][];
  checks: string[];
  /** Units sold per invoice line, as [min, max]. */
  qty: [number, number];
  batchSize: number;
  /** Typical scrap per batch, percent. */
  scrap: number;
}

const PLASTICS: Catalogue = {
  customers: [["Perera Stores", 30], ["Lanka Dairies", 45], ["Ceylon Foods Exports", 60], ["Kandy Sweets", 30], ["Green Leaf Restaurants", 14], ["Hill Country Tea", 45]],
  vendors: [["Polymer Traders Lanka", 30], ["Asia Resins", 45], ["Colombo Packaging", 30], ["Ruwan Engineering", 14]],
  products: [["C500", "500 ml round container", 38, 21], ["C1000", "1 L square container", 62, 35], ["L95", "95 mm lid", 12, 6], ["IML750", "750 ml IML tub", 85, 48], ["C250", "250 ml cup", 22, 12]],
  materials: [["PP-H", "PP homopolymer resin (kg)", 520], ["PP-C", "PP copolymer resin (kg)", 560], ["MB-W", "White masterbatch (kg)", 1450]],
  expenses: [["Electricity", 385_000], ["Factory rent", 450_000], ["Transport", 65_000], ["Repairs and maintenance", 48_000], ["Staff welfare", 22_000]],
  checks: ["Wall thickness", "Lid fit", "Visual defects", "Weight"],
  qty: [1_000, 12_000],
  batchSize: 6_000,
  scrap: 4,
};

const BAKERY: Catalogue = {
  customers: [["Café Mocha", 14], ["Green Cabin", 14], ["Hotel Lakeview", 30], ["Sunrise Supermarket", 30], ["Office Bites Catering", 21]],
  vendors: [["Prima Flour Mills", 30], ["Highland Dairy", 14], ["Sugar Lanka", 30], ["Packwell", 30]],
  products: [["BRD-W", "White sandwich loaf", 180, 95], ["BUN-T", "Tea bun", 60, 28], ["CAKE-C", "Chocolate cake 1 kg", 2_400, 1_150], ["PAS-F", "Fish bun", 120, 62], ["CRO-B", "Butter croissant", 220, 110]],
  materials: [["FLR", "Wheat flour (kg)", 210], ["BTR", "Butter (kg)", 2_600], ["SGR", "Sugar (kg)", 280]],
  expenses: [["Electricity", 95_000], ["Shop rent", 120_000], ["Gas", 38_000], ["Transport", 24_000], ["Repairs and maintenance", 15_000]],
  checks: ["Bake colour", "Weight", "Taste test"],
  qty: [20, 300],
  batchSize: 400,
  scrap: 3,
};

/** Small, seeded random numbers, so a demo looks the same all day. */
function random(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export async function seedDemoRecords(store: Store, tenant: string, compiled: Compiled, today: string): Promise<number> {
  const c = compiled.bp.preset?.id === "plastics" ? PLASTICS : BAKERY;
  const rnd = random(`${tenant}:${today}`);
  const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const on = (t: string) => compiled.targets.has(t);
  const out: StoredRecord[] = [];
  const seq = new Map<string, number>();
  let n = 0;

  function put(target: string, data: Record<string, unknown>, status: string | undefined, date: string, numbered = true): string {
    const t = compiled.targets.get(target);
    if (!t) return "";
    const id = `${target.slice(0, 3)}_demo${(++n).toString(36)}`;
    const at = `${date}T03:${String(n % 60).padStart(2, "0")}:00.000Z`;
    let number: string | undefined;
    if (numbered && t.numbering && status !== "draft") {
      const k = `${target}:${t.numbering.includes("{mm}") ? date.slice(0, 7) : t.numbering.includes("{yy") ? date.slice(0, 4) : ""}`;
      seq.set(k, (seq.get(k) ?? 0) + 1);
      number = formatNumber(t.numbering, seq.get(k)!, date);
    }
    const links = Object.values(data).filter((v): v is string => typeof v === "string" && /_demo/.test(v));
    out.push({ id, target, data, status: status ?? t.initial, number, version: 1, createdAt: at, updatedAt: at, createdBy: "demo", updatedBy: "demo", links });
    return id;
  }

  /* masters */
  const vatOn = compiled.bp.settings.tax.vatRegistered;
  const vat = vatOn ? put("tax_code", { name: "VAT 18%", rate: 18, kind: "vat" }, "active", today) : "";
  const warehouse = put("warehouse", { code: "MAIN", name: "Main store", kind: "general" }, "active", today);
  const cash = put("bank_account", { name: "Cash in hand", kind: "cash" }, "active", today);
  const bank = put("bank_account", { name: "Commercial Bank current", kind: "bank", bank: "Commercial Bank" }, "active", today) || cash;
  const salespeople = on("salesperson") ? ["Nimal Silva", "Dilini Fernando"].map((name) => put("salesperson", { name }, "active", today)) : [];
  const customers = c.customers.map(([name, terms], i) => ({ id: put("customer", { name, payment_terms_days: terms, salesperson: salespeople[i % 2] }, "active", today), terms }));
  const vendors = c.vendors.map(([name, terms]) => ({ id: put("vendor", { name, payment_terms_days: terms }, "active", today), terms }));
  const products = c.products.map(([sku, name, price, cost]) => ({ id: put("item", { sku, name, type: "goods", sales_price: price * 100, purchase_price: cost * 100, track_inventory: true, tax_code: vat || undefined }, "active", today), price, cost }));
  const materials = c.materials.map(([sku, name, price]) => ({ id: put("item", { sku, name, type: "goods", purchase_price: price * 100, track_inventory: true }, "active", today), price }));
  const accounts = c.expenses.map(([name, typical], i) => ({ id: put("account", { code: `6${String(i + 1).padStart(3, "0")}`, name, type: "expense" }, "active", today), typical }));

  const resources = new Map<string, string>();
  for (const r of compiled.bp.seed.production.resources) {
    resources.set(r.code, put("resource", { code: r.code, name: r.name, type: r.type, parent: r.parent ? resources.get(r.parent) : undefined, hourly_rate: r.hourlyRate !== undefined ? r.hourlyRate * 100 : undefined, hours_per_day: r.hoursPerDay }, "active", today));
  }
  const machines = compiled.bp.seed.production.resources.filter((r) => r.type === "machine").map((r) => resources.get(r.code)!).filter(Boolean);

  /* documents with priced lines */
  const priced = (rows: { item: string; quantity: number; price: number }[], extra: Record<string, unknown> = {}) => {
    const ls = rows.map((r, i) => ({ _line: `l${i}`, item: r.item, quantity: r.quantity, unit_price: r.price * 100, tax_code: vat || undefined, amount: Math.round(r.quantity * r.price * 100), ...extra }));
    const sub = ls.reduce((t, l) => t + l.amount, 0);
    const tax = vat ? Math.round(sub * 0.18) : 0;
    return { lines: ls, sub_total: sub, tax_total: tax, total: sub + tax };
  };
  const saleRows = () => Array.from({ length: between(1, 3) }, () => {
    const p = pick(products);
    return { item: p.id, quantity: Math.round(between(c.qty[0], c.qty[1]) / 10) * 10 || 1, price: p.price };
  });

  /* invoices, receipts and credit notes over the last four months */
  const invoices: { id: string; customer: string; date: string; total: number; due: string }[] = [];
  for (let back = 120; back >= 0; back -= between(1, 4)) {
    const date = addDays(today, -back);
    const cu = pick(customers);
    const doc = priced(saleRows());
    const due = addDays(date, cu.terms);
    const id = put("invoice", { date, customer: cu.id, due_date: due, salesperson: salespeople.length ? pick(salespeople) : undefined, ...doc, amount_due: doc.total }, back < 2 && rnd() < 0.5 ? "draft" : "posted", date);
    if (id) invoices.push({ id, customer: cu.id, date, total: doc.total, due });
  }
  for (const inv of invoices) {
    const age = daysBetween(inv.date, today);
    // Most customers pay a little after the due date; a few are slow.
    const paid = age > 75 ? (rnd() < 0.85 ? 1 : 0.5) : age > 40 ? (rnd() < 0.6 ? 1 : 0) : rnd() < 0.15 ? 1 : 0;
    if (!paid) continue;
    const date = addDays(inv.date, Math.min(age, between(10, 50)));
    put("receipt", { date, customer: inv.customer, amount: Math.round(inv.total * paid), method: pick(["bank_transfer", "cheque", "cash"]), deposit_to: bank }, "posted", date);
  }
  for (const inv of invoices.filter((_, i) => i % 13 === 5)) {
    const date = addDays(inv.date, 5);
    if (date > today) continue;
    put("credit_note", { date, customer: inv.customer, invoice: inv.id, reason: "Damaged in delivery", ...priced([{ item: products[0]!.id, quantity: Math.max(1, Math.round(c.qty[0] / 10)), price: products[0]!.price }]) }, "posted", date);
  }

  /* sales orders: some delivered, some still to go */
  const orderStates = ["confirmed", "confirmed", "in_production", "partly_delivered", "confirmed", "delivered", "closed"];
  orderStates.forEach((status, i) => {
    const date = addDays(today, -between(3, 25));
    const delivery = addDays(today, i === 0 ? -3 : between(-1, 21));
    const doc = priced(saleRows());
    const lines = doc.lines.map((l) => ({ ...l, delivered_qty: status === "partly_delivered" ? Math.round(l.quantity / 2) : status === "delivered" || status === "closed" ? l.quantity : 0 }));
    put("sales_order", { date, customer: pick(customers).id, delivery_date: delivery, warehouse, ...doc, lines }, status, date);
  });

  /* counter sales for the last three weeks */
  if (on("pos_sale")) {
    const shift = put("pos_shift", { terminal: "Counter 1", opened_at: `${today}T02:30:00.000Z`, opening_float: 500_000 }, "open", today, false);
    for (let back = 20; back >= 0; back--) {
      const date = addDays(today, -back);
      const count = back === 0 ? between(6, 12) : between(18, 40);
      for (let k = 0; k < count; k++) {
        const p = pick(products.filter((x) => x.price < 1_000)) ?? products[0]!;
        const doc = priced([{ item: p.id, quantity: between(1, 6), price: p.price }]);
        const hour = 2 + Math.floor((k / count) * 11);
        put("pos_sale", { at: `${date}T${String(hour).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}:00.000Z`, shift, lines: doc.lines, total: doc.total, tender: rnd() < 0.62 ? "cash" : rnd() < 0.7 ? "card" : "qr" }, rnd() < 0.01 ? "refunded" : "completed", date);
      }
    }
  }

  /* buying: bills, payments, purchase orders, expenses */
  const bills: { id: string; vendor: string; date: string; total: number }[] = [];
  for (let back = 110; back >= 0; back -= between(4, 9)) {
    const date = addDays(today, -back);
    const v = pick(vendors);
    const m = pick(materials);
    const doc = priced([{ item: m.id, quantity: between(5, 40) * (c === PLASTICS ? 100 : 10), price: m.price }]);
    const id = put("bill", { date, vendor: v.id, vendor_invoice_no: `VI-${between(1000, 9999)}`, due_date: addDays(date, v.terms), ...doc, amount_due: doc.total }, "posted", date);
    if (id) bills.push({ id, vendor: v.id, date, total: doc.total });
  }
  for (const b of bills) {
    const age = daysBetween(b.date, today);
    if (age < 35 || rnd() < 0.15) continue;
    const date = addDays(b.date, between(25, Math.min(age, 45)));
    put("payment", { date, vendor: b.vendor, amount: b.total, method: "bank_transfer", paid_from: bank }, "posted", date);
  }
  ["issued", "issued", "partly_received", "received"].forEach((status, i) => {
    const date = addDays(today, -between(2, 20));
    const m = pick(materials);
    const doc = priced([{ item: m.id, quantity: between(10, 50) * (c === PLASTICS ? 100 : 10), price: m.price }]);
    const lines = doc.lines.map((l) => ({ ...l, received_qty: status === "partly_received" ? Math.round(l.quantity * 0.4) : status === "received" ? l.quantity : 0 }));
    put("purchase_order", { date, vendor: pick(vendors).id, expected_date: addDays(today, i === 0 ? -2 : between(1, 14)), warehouse, ...doc, lines }, status, date);
  });
  for (let back = 85; back >= 0; back -= between(5, 10)) {
    const date = addDays(today, -back);
    const a = pick(accounts);
    put("expense", { date, account: a.id, amount: Math.round(a.typical * (0.4 + rnd() * 0.5)) * 100, paid_from: rnd() < 0.5 ? cash : bank }, "posted", date);
  }

  /* production: recipes, orders and batches */
  if (on("production_order") && on("recipe")) {
    const recipes = products.map((p, i) => {
      const ops = machines.length ? [{ _line: "o1", seq: 10, name: c === PLASTICS ? "Moulding" : "Baking", machine: machines[i % machines.length], setup_minutes: c === PLASTICS ? 45 : 15, run_minutes: c === PLASTICS ? 95 : 40 }] : [];
      return { item: p.id, id: put("recipe", { code: `R-${c.products[i]![0]}`, name: c.products[i]![1], item: p.id, version: 1, output_quantity: c.batchSize / 4, expected_yield_pct: 100 - c.scrap, lines: [{ _line: "m1", item: materials[0]!.id, quantity: c === PLASTICS ? 30 : 40 }], operations: ops }, "active", today, false) };
    });
    const plans: [status: string, start: number, due: number][] = [["completed", -40, -30], ["completed", -28, -18], ["in_progress", -12, -3], ["in_progress", -6, 4], ["in_progress", -3, 6], ["scheduled", 1, 10], ["scheduled", 3, 14]];
    let made = 0;
    plans.forEach(([status, start, due], i) => {
      const r = recipes[i % recipes.length]!;
      const planned = c.batchSize * (status === "completed" ? 3 : 4);
      const order = put("production_order", { recipe: r.id, item: r.item, planned_quantity: planned, start_date: addDays(today, start), due_date: addDays(today, due), destination_warehouse: warehouse }, status, addDays(today, start));
      if (status === "scheduled") return;
      const batches = status === "completed" ? 3 : 1 + (i % 3);
      for (let b = 0; b < batches; b++) {
        const mfg = addDays(today, Math.min(-1, start + b * 3));
        const machine = machines.length ? machines[(i + b) % machines.length] : undefined;
        // One machine runs hotter, so scrap by machine has something to say.
        const scrapPct = c.scrap * (machine && machine === machines[1] ? 2 : 1) * (0.5 + rnd());
        const total = c.batchSize * (0.9 + rnd() * 0.2);
        const scrap = Math.round((total * scrapPct) / 100);
        const failed = ++made % 6 === 0;
        const bStatus = failed && rnd() < 0.5 ? "rejected" : b === batches - 1 && status === "in_progress" ? "qc_hold" : "released";
        const qc = c.checks.map((check, k) => ({ _line: `q${k}`, check, value: failed && k === made % c.checks.length ? "Out of limit" : "OK", passed: !(failed && k === made % c.checks.length) }));
        put("batch", { production_order: order, machine, planned_quantity: c.batchSize, output_quantity: Math.round(total - scrap), scrap_quantity: scrap, mfg_date: mfg, qc_results: qc }, bStatus, mfg);
      }
    });
  }
  if (on("ncr")) put("ncr", { source: "batch", item: products[0]!.id, quantity: 120, description: "Short shots on cavity 3" }, "open", addDays(today, -4));

  await store.write(tenant, async (tx) => {
    for (const r of out) tx.put(r);
  });
  return out.length;
}
