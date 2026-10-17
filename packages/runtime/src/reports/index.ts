import { REPORTS, REPORT_BY_KEY, checkExpr, evaluate, type ReportDef, type ReportKey, type Widget } from "@shapewise/blueprint";
import type { Compiled, CTarget } from "../compile";
import { fromMinor } from "../data";
import type { Store, StoredRecord } from "../store";
import { loadSnapshot, periodOf, viewableModules, visibleReports, type Headline, type PeriodKey, type ReportImpl, type ReportResult, type RunContext, type Snapshot, type Unit } from "./engine";
import { capacity, lateJobs, productionStatus, qcFailures, scrapByMachine, scrapRate, yieldReport } from "./production";
import { agedPayables, expenseSummary, openPurchaseOrders, purchasesByVendor } from "./purchases";
import { agedReceivables, dailyTakings, openOrders, salesByCustomer, salesByItem, salesBySalesperson, salesSummary, salesTrend } from "./sales";

export * from "./engine";
export { saleLines, openDocuments, ageBucket, AGE_BUCKETS } from "./sales";
export { seedDemoRecords } from "./demo";

/** Reports computed from documents. Stock and ledger reports wait for their engines. */
export const RECORD_REPORTS: Partial<Record<ReportKey, ReportImpl>> = {
  sales_summary: salesSummary,
  sales_by_customer: salesByCustomer,
  sales_by_item: salesByItem,
  sales_by_salesperson: salesBySalesperson,
  sales_trend: salesTrend,
  open_orders: openOrders,
  aged_receivables: agedReceivables,
  daily_takings: dailyTakings,
  purchases_by_vendor: purchasesByVendor,
  aged_payables: agedPayables,
  open_purchase_orders: openPurchaseOrders,
  expense_summary: expenseSummary,
  production_status: productionStatus,
  late_jobs: lateJobs,
  yield: yieldReport,
  scrap_by_machine: scrapByMachine,
  qc_failures: qcFailures,
  capacity,
};

/** Record types a set of reports reads. */
export function readsOf(keys: Iterable<string>): string[] {
  return [...new Set([...keys].flatMap((k) => RECORD_REPORTS[k as ReportKey]?.reads ?? []))];
}

/** Runs one report over a snapshot that holds what it reads. */
export function runReport(s: Snapshot, key: ReportKey, ctx: RunContext): ReportResult {
  const def = REPORT_BY_KEY.get(key)!;
  const base = { key, label: def.label, asks: def.asks };
  const impl = RECORD_REPORTS[key];
  if (!impl) return { ...base, state: "waiting", engine: def.source === "stock" ? "stock" : "ledger" };
  const range = impl.period ? periodOf(ctx.period ?? impl.period, ctx.today) : undefined;
  return { ...base, state: "ready", period: range, ...impl.run(s, { ...ctx, range }) };
}

/** Whether a report reads a date range the person can change. */
export const hasPeriod = (key: string) => Boolean(RECORD_REPORTS[key as ReportKey]?.period);

/** Loads what the reports read, then runs them. */
export async function runReports(opts: { store: Store; tenant: string; compiled: Compiled; keys: readonly ReportKey[]; ctx: RunContext }): Promise<ReportResult[]> {
  const s = await loadSnapshot(opts.store, opts.tenant, opts.compiled, readsOf(opts.keys));
  return opts.keys.map((k) => runReport(s, k, opts.ctx));
}

/**
 * Reports a role may see: its module must be open to the role, and so must
 * every document the report reads. Seeing sales orders (to plan production)
 * doesn't show what customers owe, because that reads invoices.
 */
export function reportsFor(compiled: Compiled, roleKey: string) {
  const owner = compiled.bp.roles.find((r) => r.key === roleKey)?.owner;
  return visibleReports(compiled, roleKey, REPORTS).filter(({ def }) => {
    if (owner) return true;
    const reads = RECORD_REPORTS[def.key as ReportKey]?.reads ?? [];
    return reads.every((target) => {
      const t = compiled.targets.get(target);
      // Lists like customers and items are context; documents decide access.
      if (!t || !t.numbering) return true;
      return compiled.can(roleKey, t.submodule, "view");
    });
  });
}

/* --------------------------------------------------------------- dashboard */

export type TileValue =
  | ({ state: "ready" } & Headline)
  | { state: "waiting"; engine: "stock" | "ledger" };

const METRIC_REPORT = new Map<string, ReportDef>(REPORTS.filter((r): r is (typeof REPORTS)[number] & { metric: string } => "metric" in r).map((r) => [r.metric, r]));
/** Tiles that aren't a report's headline: the module they belong to and the records they read. */
const EXTRA_METRICS: Record<string, { module?: string; reads: string[] }> = {
  scrap_pct: { module: "production", reads: ["batch", "production_order", "item", "resource"] },
  open_ncrs: { module: "production", reads: ["ncr"] },
  pending_approvals: { reads: [] },
};

/**
 * Values for the dashboard tiles this role may see, by widget id. Tiles for
 * reports the role can't see are left out; stock and ledger tiles say which
 * engine they wait for.
 */
export async function dashboardTiles(opts: { store: Store; tenant: string; compiled: Compiled; roleKey: string; widgets: readonly Widget[]; ctx: RunContext }): Promise<Map<string, TileValue>> {
  const { compiled, roleKey, ctx } = opts;
  const bp = compiled.bp;
  const roleId = bp.roles.find((r) => r.key === roleKey)?.id;
  const visible = new Set(reportsFor(compiled, roleKey).map((r) => r.def.key));
  const modules = viewableModules(compiled, roleKey);
  const shown = opts.widgets.filter((w) => {
    if (w.roles?.length && (!roleId || !w.roles.includes(roleId))) return false;
    if (w.source.kind === "aggregate") {
      const t = compiled.targets.get(w.source.target);
      return Boolean(t && compiled.can(roleKey, t.submodule, "view"));
    }
    const def = METRIC_REPORT.get(w.source.metric);
    if (def) return visible.has(def.key);
    const extra = EXTRA_METRICS[w.source.metric];
    return !extra?.module || modules.has(extra.module);
  });

  const reads = new Set<string>();
  for (const w of shown) {
    if (w.source.kind === "aggregate") {
      const t = compiled.targets.get(w.source.target)!;
      reads.add(t.target);
      for (const f of t.fields) if (f.type === "ref" && f.to) reads.add(f.to);
      continue;
    }
    const def = METRIC_REPORT.get(w.source.metric);
    for (const r of def ? readsOf([def.key]) : (EXTRA_METRICS[w.source.metric]?.reads ?? [])) reads.add(r);
  }
  const s = await loadSnapshot(opts.store, opts.tenant, compiled, reads);
  const approvals = shown.some((w) => w.source.kind === "builtin" && w.source.metric === "pending_approvals") ? (await opts.store.listApprovals(opts.tenant, "pending")).length : 0;

  const out = new Map<string, TileValue>();
  for (const w of shown) {
    if (w.source.kind === "aggregate") {
      out.set(w.id, { state: "ready", ...aggregate(s, compiled, w.source, ctx) });
      continue;
    }
    const metric = w.source.metric;
    const def = METRIC_REPORT.get(metric);
    if (def) {
      const r = runReport(s, def.key as ReportKey, ctx);
      out.set(w.id, r.state === "waiting" ? r : { state: "ready", ...(r.headline ?? { label: def.label, value: null, unit: "count" }) });
    } else if (metric === "scrap_pct") out.set(w.id, { state: "ready", label: "Scrap rate", value: scrapRate(s, periodOf("month", ctx.today)), unit: "percent" });
    else if (metric === "open_ncrs") out.set(w.id, { state: "ready", label: "Open NCRs", value: s.list("ncr").filter((n) => n.status === "open").length, unit: "count" });
    else if (metric === "pending_approvals") out.set(w.id, { state: "ready", label: "Waiting for approval", value: approvals, unit: "count" });
  }
  return out;
}

/* ------------------------------------------------- business-defined tiles */

type AggregateSource = Extract<Widget["source"], { kind: "aggregate" }>;
const DATE_KEYS = ["date", "mfg_date", "at", "start_date", "opened_at"];

/** Count, sum or average of a record type over a period, filtered by a Shapewise expression. */
export function aggregate(s: Snapshot, compiled: Compiled, src: AggregateSource, ctx: RunContext): Headline {
  const t = compiled.targets.get(src.target)!;
  const field = src.field ? t.fields.find((f) => f.key === src.field || f.id === src.field) : undefined;
  const unit: Unit = src.agg === "count" ? "count" : field?.type === "money" ? "money" : field?.type === "percent" ? "percent" : "quantity";
  const label = `${src.agg === "count" ? "Number of" : src.agg === "sum" ? "Total" : "Average"} ${t.labelPlural.toLowerCase()}`;
  let filter: ReturnType<typeof checkExpr>["ast"];
  if (src.filter) {
    const r = checkExpr(src.filter, { target: t.target, fields: (x) => compiled.resolved.exprFields(x), vars: { $user: { t: "user" } } }, "boolean");
    if (r.problems.length) return { label, value: null, unit };
    filter = r.ast;
  }
  const dateField = t.fields.find((f) => DATE_KEYS.includes(f.key) && (f.type === "date" || f.type === "datetime"));
  const range = src.period === "all" ? undefined : periodOf(src.period === "quarter" ? "quarter" : src.period === "year" ? "year" : src.period === "week" ? "week" : src.period === "today" ? "today" : "month", ctx.today);
  const dated = (r: StoredRecord) => {
    const v = dateField ? r.data[dateField.key] : r.createdAt;
    return typeof v === "string" ? (v.length > 10 ? (new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timezone }).format(Date.parse(v))) : v) : undefined;
  };
  const now = new Date().toISOString();
  const rows = s.list(t.target).filter((r) => {
    if (range) {
      const d = dated(r);
      if (!d || d < range.from || d > range.to) return false;
    }
    return !filter || evaluate(filter, { today: ctx.today, now, get: (parts) => (parts[0] === "$user" ? null : read(s, compiled, t, r, parts)) }) === true;
  });
  if (src.agg === "count") return { label, value: rows.length, unit };
  const nums = rows.map((r) => r.data[field?.key ?? ""]).filter((v): v is number => typeof v === "number");
  if (!nums.length) return { label, value: src.agg === "sum" ? 0 : null, unit };
  const total = nums.reduce((a, b) => a + b, 0);
  return { label, value: src.agg === "sum" ? total : Math.round(total / nums.length), unit };
}

/** A value for expressions: money in major units, one level of references followed. */
function read(s: Snapshot, compiled: Compiled, t: CTarget, r: StoredRecord, parts: readonly string[]): unknown {
  const [head, ...rest] = parts;
  if (!head || head === "id") return r.id;
  if (head === "status") return r.status ?? null;
  if (head === "number") return r.number ?? null;
  if (head === "created_at") return r.createdAt;
  const f = t.fields.find((x) => x.key === head || x.id === head);
  const v = f ? r.data[f.key] : undefined;
  if (rest.length) {
    const rt = f?.type === "ref" && f.to ? compiled.targets.get(f.to) : undefined;
    const ref = rt ? s.get(rt.target, v) : undefined;
    return rt && ref ? read(s, compiled, rt, ref, rest) : null;
  }
  return f?.type === "money" && typeof v === "number" ? fromMinor(v) : (v ?? null);
}

export type { PeriodKey };
