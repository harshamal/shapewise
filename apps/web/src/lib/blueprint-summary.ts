import {
  ACCOUNT_GROUPS,
  COUNTRY_BY_CODE,
  CORE_RECORDS,
  EXTENSION_BY_KEY,
  MODULES,
  POSTINGS,
  ROLE_LABEL,
  navigation,
  type Blueprint,
  type CoreRecordKey,
  type LedgerLine,
  type StockPlace,
} from "@shapewise/blueprint";

/**
 * A blueprint in plain words, for the onboarding review screen. Pure and
 * browser safe: the review recomputes it whenever the person switches a
 * screen on or off.
 */
export interface ScreenSummary {
  key: string;
  label: string;
  on: boolean;
  /** Screens that are part of their module (or come with a feature) can't be switched off on their own. */
  canHide: boolean;
  fields: { label: string; type: string; custom?: boolean; line?: boolean }[];
  /** Screens whose documents can wait for approval: the step that waits, and whether any rule is on. */
  approval?: { record: string; action: string; actionLabel: string; on: boolean };
}

export interface ModuleSummary {
  key: string;
  label: string;
  on: boolean;
  screens: ScreenSummary[];
}

export interface BlueprintSummary {
  name: string;
  industry?: string;
  modules: ModuleSummary[];
  extensions: string[];
  recordTypes: { label: string; fields: string[]; statuses: string[] }[];
  customFields: { record: string; label: string; where: string }[];
  roles: { label: string; description?: string }[];
  approvals: string[];
  rules: string[];
  machines: string[];
  country: string;
  currency: string;
  /** Tax rates that will be created, e.g. "VAT 18%". */
  taxCodes: string[];
}

const TYPE_LABEL: Record<string, string> = {
  text: "Text",
  longtext: "Notes",
  integer: "Number",
  decimal: "Number",
  money: "Amount",
  quantity: "Quantity",
  percent: "Percent",
  date: "Date",
  datetime: "Date and time",
  boolean: "Yes or no",
  select: "Choice",
  multiselect: "Choices",
  ref: "Link",
  user: "Person",
  phone: "Phone",
  email: "Email",
  url: "Link",
  file: "File",
  image: "Image",
  formula: "Worked out",
};

function screenFields(bp: Blueprint, record?: string, entity?: string): ScreenSummary["fields"] {
  if (entity) {
    const e = bp.entities.find((x) => x.id === entity);
    return e ? e.fields.map((f) => ({ label: f.label, type: TYPE_LABEL[f.type] ?? f.type, custom: true })) : [];
  }
  if (!record || !(record in CORE_RECORDS)) return [];
  const r = CORE_RECORDS[record as CoreRecordKey];
  const custom = bp.customFields.filter((c) => c.target === record);
  return [
    ...r.fields.filter((f) => !f.system).map((f) => ({ label: f.label, type: TYPE_LABEL[f.type] ?? f.type })),
    ...custom.filter((c) => c.part !== "line").map((c) => ({ label: c.field.label, type: TYPE_LABEL[c.field.type] ?? c.field.type, custom: true })),
    ...(r.lines?.fields ?? []).filter((f) => !f.system).map((f) => ({ label: f.label, type: TYPE_LABEL[f.type] ?? f.type, line: true })),
    ...custom.filter((c) => c.part === "line").map((c) => ({ label: c.field.label, type: TYPE_LABEL[c.field.type] ?? c.field.type, custom: true, line: true })),
  ];
}

/** The step a document waits at for approval (post, issue, confirm), never a void or cancel. */
export function approvalStep(bp: Blueprint, record?: string): ScreenSummary["approval"] {
  if (!record || !(record in CORE_RECORDS)) return undefined;
  const a = (CORE_RECORDS[record as CoreRecordKey].lifecycle?.actions ?? []).find((x) => x.approvable && x.permission !== "void");
  if (!a) return undefined;
  return { record, action: a.key, actionLabel: a.label, on: bp.approvals.some((p) => p.target === record && p.enabled) };
}

export function summarise(bp: Blueprint): BlueprintSummary {
  const recordLabel = (t: string) => (t in CORE_RECORDS ? CORE_RECORDS[t as CoreRecordKey].labelPlural : (bp.entities.find((e) => e.id === t)?.labelPlural ?? t));
  const roleLabel = (id: string) => bp.roles.find((r) => r.id === id)?.label ?? id;
  const nav = navigation(bp).flatMap((s) => s.modules);
  const money = (n: number) => (bp.business.currency === "LKR" ? `Rs ${n.toLocaleString("en-LK")}` : new Intl.NumberFormat(bp.business.locale, { style: "currency", currency: bp.business.currency, maximumFractionDigits: 0 }).format(n));
  const extOn = new Set<string>(bp.extensions);

  const modules = MODULES.filter((m) => !m.core && m.key !== "settings").map((m) => {
    const on = bp.modules.some((c) => c.key === m.key && c.enabled);
    const visible = nav.find((n) => n.key === m.key)?.submodules ?? [];
    const catalogue = m.submodules
      .filter((s) => !s.extension || extOn.has(s.extension))
      .map((s) => {
        const shown = visible.find((v) => v.key === s.key);
        return { key: s.key, label: shown?.label ?? s.label, on: Boolean(shown), canHide: !s.core && !s.extension, fields: screenFields(bp, s.record), approval: approvalStep(bp, s.record) };
      });
    // Record types made for this business sit in their module too.
    const custom = visible.filter((v) => v.entity).map((v) => ({ key: v.key, label: v.label, on: true, canHide: false, fields: screenFields(bp, undefined, v.entity) }));
    return { key: m.key, label: m.label, on, screens: [...catalogue, ...custom] };
  });

  return {
    name: bp.business.name,
    industry: bp.business.industry,
    modules,
    extensions: bp.extensions.map((k) => EXTENSION_BY_KEY[k].name),
    recordTypes: bp.entities.map((e) => ({ label: e.labelPlural, fields: e.fields.map((f) => f.label), statuses: e.workflow?.states.map((s) => s.label) ?? [] })),
    customFields: bp.customFields.map((c) => ({ record: recordLabel(c.target), label: c.field.label, where: c.part === "line" ? "on each line" : "" })),
    roles: bp.roles.map((r) => ({ label: r.label, description: r.description })),
    approvals: bp.approvals.map((a) => `${a.label}: ${a.stages.map((s) => `${s.roles.map(roleLabel).join(" or ")}${s.minAmount ? ` from ${money(s.minAmount)}` : ""}`).join(", then ")}`),
    rules: bp.rules.map((r) => r.label),
    machines: bp.seed.production.resources.map((r) => r.name),
    country: COUNTRY_BY_CODE.get(bp.business.country)?.name ?? bp.business.country,
    currency: bp.business.currency,
    taxCodes: bp.seed.taxCodes.map((t) => t.name),
  };
}

/* ------------------------------------------------------------------- flow */

export interface FlowNode {
  id: string;
  label: string;
  module: string;
  moduleLabel: string;
  /** What finishing this document moves: stock, the accounts, or both. */
  effects: ("stock" | "ledger")[];
  custom?: boolean;
  layer: number;
  row: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** "Convert to invoice", or "Linked" for a document that refers back. */
  label: string;
  kind: "convert" | "link";
}

/** Nodes in a row with labelled arcs between them: where stock or value goes, and which documents move it. */
export interface ArcFlow {
  nodes: { id: string; label: string; outside?: boolean }[];
  arcs: { from: string; to: string; documents: string[] }[];
  /** Documents that act within one place (a stock count, a transfer between stores). */
  within: { node: string; documents: string[] }[];
}

/** What one document action does, in words and in postings, for the table. */
export interface FlowEffect {
  document: string;
  module: string;
  action: string;
  says: string;
  stock: string[];
  debits: string[];
  credits: string[];
}

export interface FlowGraph {
  /** Documents in a lane per module, leading into each other. */
  nodes: FlowNode[];
  edges: FlowEdge[];
  lanes: { module: string; label: string; start: number; size: number }[];
  layers: number;
  rows: number;
  stock: ArcFlow;
  money: ArcFlow;
  effects: FlowEffect[];
}

const isDocument = (k: string) => k in CORE_RECORDS && Boolean(CORE_RECORDS[k as CoreRecordKey].numbering && CORE_RECORDS[k as CoreRecordKey].lifecycle);

/** Links the records don't spell out as conversions or references. */
const EXTRA_LINKS: readonly [CoreRecordKey, CoreRecordKey, string][] = [
  ["recurring_invoice", "invoice", "Raises on schedule"],
  ["recurring_bill", "bill", "Raises on schedule"],
  ["recurring_journal", "journal", "Raises on schedule"],
  ["recipe", "production_order", "Followed by"],
  ["pos_sale", "pos_shift", "Totals into"],
];

const STOCK_NAMES: Record<StockPlace | "incoming", string> = { raw: "Raw materials", wip: "Work in progress", finished: "Finished goods", goods: "Stock on hand", quarantine: "Quality hold", incoming: "Incoming checks" };

/** Where stock comes from or goes when it enters or leaves the business, by document. */
const OUTSIDE: Partial<Record<CoreRecordKey, "suppliers" | "customers" | "scrap">> = {
  goods_receipt: "suppliers",
  vendor_credit: "suppliers",
  delivery_note: "customers",
  credit_note: "customers",
  pos_sale: "customers",
  pos_shift: "customers",
  batch: "scrap",
  ncr: "scrap",
};

/**
 * How the setup hangs together, from the live blueprint: documents leading
 * into each other, how stock moves between stores, and how value moves
 * between accounts. Changes as screens are switched on and off.
 */
export function flowGraph(bp: Blueprint): FlowGraph {
  const nav = navigation(bp).flatMap((s) => s.modules);
  const where = new Map<string, { module: string; moduleLabel: string; label: string; custom?: boolean }>();
  for (const m of nav)
    for (const s of m.submodules) {
      if (s.record && !where.has(s.record)) where.set(s.record, { module: m.key, moduleLabel: m.label, label: s.label });
      if (s.entity) where.set(s.entity, { module: m.key, moduleLabel: m.label, label: s.label, custom: true });
    }
  const tax = bp.settings.tax;
  const makes = bp.modules.some((m) => m.key === "production" && m.enabled);

  /* documents and how they lead into each other */
  const edges: FlowEdge[] = [];
  const add = (from: string, to: string, label: string, kind: FlowEdge["kind"]) => {
    if (from === to || edges.some((e) => e.from === from && e.to === to)) return;
    edges.push({ from, to, label, kind });
  };
  for (const k of where.keys()) {
    if (!(k in CORE_RECORDS)) continue;
    for (const c of CORE_RECORDS[k as CoreRecordKey].convertsTo ?? []) if (where.has(c.to)) add(k, c.to, c.label, "convert");
  }
  for (const [from, to, label] of EXTRA_LINKS) if (where.has(from) && where.has(to)) add(from, to, label, "convert");
  for (const k of where.keys()) {
    const fields = k in CORE_RECORDS ? [...CORE_RECORDS[k as CoreRecordKey].fields, ...(CORE_RECORDS[k as CoreRecordKey].lines?.fields ?? [])] : (bp.entities.find((x) => x.id === k)?.fields ?? []);
    for (const f of fields as { type: string; to?: string }[]) if (f.type === "ref" && f.to && isDocument(f.to) && where.has(f.to)) add(f.to, k, "Linked", "link");
  }

  const docEffects = (k: string): FlowNode["effects"] => {
    if (!(k in CORE_RECORDS)) return [];
    const all = new Set((CORE_RECORDS[k as CoreRecordKey].lifecycle?.actions ?? []).flatMap((a) => a.effects ?? []));
    return (["stock", "ledger"] as const).filter((x) => all.has(x));
  };
  const connected = new Set(edges.flatMap((e) => [e.from, e.to]));
  // Documents that move stock or money belong on the map even with no links.
  for (const k of where.keys()) if (isDocument(k) && docEffects(k).length) connected.add(k);

  const out = new Map<string, string[]>();
  edges.forEach((e) => out.set(e.from, [...(out.get(e.from) ?? []), e.to]));
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (n: string, depth: number) => {
    if ((layer.get(n) ?? -1) >= depth) return;
    layer.set(n, depth);
    visiting.add(n);
    for (const to of out.get(n) ?? []) if (!visiting.has(to)) visit(to, depth + 1);
    visiting.delete(n);
  };
  const incoming = new Set(edges.map((e) => e.to));
  [...connected].filter((n) => !incoming.has(n)).forEach((n) => visit(n, 0));
  [...connected].filter((n) => !layer.has(n)).forEach((n) => visit(n, 0));
  const kept = edges.filter((e) => (layer.get(e.to) ?? 0) > (layer.get(e.from) ?? 0));

  const moduleOrder = (m: string) => MODULES.findIndex((x) => x.key === m);
  const laneKeys = [...new Set([...connected].map((n) => where.get(n)!.module))].sort((a, b) => moduleOrder(a) - moduleOrder(b));
  const nodes: FlowNode[] = [];
  const lanes: FlowGraph["lanes"] = [];
  let start = 0;
  for (const lane of laneKeys) {
    const members = [...connected].filter((n) => where.get(n)!.module === lane);
    const perLayer = new Map<number, string[]>();
    for (const n of members) perLayer.set(layer.get(n)!, [...(perLayer.get(layer.get(n)!) ?? []), n]);
    let size = 1;
    for (const [l, ids] of perLayer) {
      ids.sort((a, b) => where.get(a)!.label.localeCompare(where.get(b)!.label)).forEach((id, i) => nodes.push({ id, ...where.get(id)!, effects: docEffects(id), layer: l, row: start + i }));
      size = Math.max(size, ids.length);
    }
    lanes.push({ module: lane, label: where.get(members[0]!)!.moduleLabel, start, size });
    start += size;
  }

  /* stock and money, from the postings of the documents in use */
  const checks = where.has("inspection");
  type Place = StockPlace | "incoming";
  // Goods received wait at incoming checks when inspection is on; inspection releases them. Batches and NCRs use the quality hold.
  const placeFor = (record: CoreRecordKey, p: StockPlace): Place => {
    if (p === "quarantine") return record === "inspection" ? "incoming" : "quarantine";
    if (record === "goods_receipt" && checks) return "incoming";
    return makes ? p : "goods";
  };
  const label = (k: CoreRecordKey) => where.get(k)?.label ?? CORE_RECORDS[k].labelPlural;
  const applies = (l: LedgerLine) => !l.when || (l.when === "vat" ? tax.vatRegistered : tax.wht);
  const groupOf = (role: string) => ACCOUNT_GROUPS.find((g) => g.roles.includes(role as never));
  const roleName = (r: string) => ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r.replaceAll("_", " ");
  const stockArcs = new Map<string, Set<string>>();
  const stockWithin = new Map<string, Set<string>>();
  const moneyArcs = new Map<string, Set<string>>();
  const moneyWithin = new Map<string, Set<string>>();
  const put = (m: Map<string, Set<string>>, key: string, doc: string) => m.set(key, (m.get(key) ?? new Set()).add(doc));
  const effects: FlowEffect[] = [];

  for (const p of POSTINGS) {
    if (!where.has(p.record)) continue;
    const doc = label(p.record);
    const stockWords: string[] = [];
    for (const s of p.stock ?? []) {
      const place = (x: StockPlace) => placeFor(p.record, x);
      const from = place(s.place);
      const outside = OUTSIDE[p.record];
      const name = (x: Place) => (x === "goods" && makes ? "All stores" : STOCK_NAMES[x]);
      if (s.dir === "adjust" || (s.dir === "move" && place(s.to!) === from)) {
        put(stockWithin, from, doc);
        stockWords.push(s.dir === "adjust" ? `Corrects ${name(from).toLowerCase()}` : `Moves within ${name(from).toLowerCase()}`);
      } else if (s.dir === "move") {
        put(stockArcs, `${from}>${place(s.to!)}`, doc);
        stockWords.push(`${name(from)} to ${name(place(s.to!)).toLowerCase()}`);
      } else if (s.dir === "in") {
        put(stockArcs, `${outside ?? "suppliers"}>${from}`, doc);
        stockWords.push(`Into ${name(from).toLowerCase()}`);
      } else {
        put(stockArcs, `${from}>${outside ?? "customers"}`, doc);
        stockWords.push(`Out of ${name(from).toLowerCase()}`);
      }
    }
    const ledger = (p.ledger ?? []).filter(applies);
    const debits = ledger.filter((l) => l.side === "debit");
    const credits = ledger.filter((l) => l.side === "credit");
    // A posting is written as balanced parts (a credit note reverses the sale, then the cost); a debit after a credit starts the next part.
    // Value moves from each credited group to each debited group within a part.
    const parts: LedgerLine[][] = [];
    for (const l of ledger) {
      const cur = parts.at(-1);
      if (!cur || (l.side === "debit" && cur.some((x) => x.side === "credit"))) parts.push([l]);
      else cur.push(l);
    }
    for (const part of parts)
      for (const c of part.filter((l) => l.side === "credit"))
        for (const d of part.filter((l) => l.side === "debit")) {
          const a = groupOf(c.role)?.key;
          const b = groupOf(d.role)?.key;
          if (!a || !b) continue;
          if (a === b) put(moneyWithin, a, doc);
          else put(moneyArcs, `${a}>${b}`, doc);
        }
    if (p.record === "journal") put(moneyWithin, "other", doc);
    const action = CORE_RECORDS[p.record].lifecycle?.actions.find((a) => a.key === p.action)?.label ?? p.action;
    effects.push({ document: doc, module: where.get(p.record)!.moduleLabel, action, says: p.says, stock: stockWords, debits: debits.map((l) => roleName(l.role)), credits: credits.map((l) => roleName(l.role)) });
  }

  const arcs = (m: Map<string, Set<string>>) => [...m].map(([k, docs]) => ({ from: k.split(">")[0]!, to: k.split(">")[1]!, documents: [...docs] }));
  const within = (m: Map<string, Set<string>>) => [...m].map(([node, docs]) => ({ node, documents: [...docs] }));

  const stockIds = new Set([...stockArcs.keys()].flatMap((k) => k.split(">")).concat([...stockWithin.keys()]));
  // Left to right in the order goods travel. For makers, "all stores" (counts, transfers) sits at the end, apart from the line.
  const STOCK_ORDER: { id: string; label: string; outside?: boolean }[] = [
    { id: "suppliers", label: "Suppliers", outside: true },
    { id: "incoming", label: STOCK_NAMES.incoming },
    { id: "raw", label: STOCK_NAMES.raw },
    ...(makes ? [] : [{ id: "goods", label: STOCK_NAMES.goods }]),
    { id: "wip", label: STOCK_NAMES.wip },
    { id: "quarantine", label: STOCK_NAMES.quarantine },
    { id: "finished", label: STOCK_NAMES.finished },
    { id: "customers", label: "Customers", outside: true },
    { id: "scrap", label: "Scrap", outside: true },
    ...(makes ? [{ id: "goods", label: "All stores" }] : []),
  ];
  const moneyIds = new Set([...moneyArcs.keys()].flatMap((k) => k.split(">")).concat([...moneyWithin.keys()]));
  // Ordered so the common paths sit side by side: stock to cost of sales, sales to what customers owe, VAT beside both, bank between customers and suppliers.
  const MONEY_ORDER = ["stock", "trading", "receivables", "tax", "bank", "payables", "other"];

  return {
    nodes,
    edges: kept,
    lanes,
    layers: Math.max(0, ...nodes.map((n) => n.layer)) + 1,
    rows: start,
    stock: { nodes: STOCK_ORDER.filter((n) => stockIds.has(n.id)), arcs: arcs(stockArcs), within: within(stockWithin) },
    money: {
      nodes: MONEY_ORDER.filter((id) => moneyIds.has(id)).map((id) => ({ id, label: ACCOUNT_GROUPS.find((g) => g.key === id)!.label })),
      arcs: arcs(moneyArcs),
      within: within(moneyWithin),
    },
    effects,
  };
}
