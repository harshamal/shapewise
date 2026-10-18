import { REPORT_BY_KEY, navigation, reportAvailable, taxFlags, taxesOf, type BusinessTaxes, type ReportDef, type ReportKey, type ReportSetting } from "@shapewise/blueprint";
import type { Compiled } from "../compile";
import { titleOf } from "../data";
import { ENGINE_TARGETS } from "../engines/context";
import type { Store, StoredRecord } from "../store";

/**
 * The live report engine: reports that read documents (invoices, bills,
 * batches) rather than the ledger or stock engines. Each report is a pure
 * function over a snapshot of the records it reads, so the same code runs on
 * the in-memory demo store, Firestore and test fixtures.
 *
 * Money stays in minor units, as stored; screens format it in the business
 * currency.
 */

export type Unit = "money" | "count" | "percent" | "quantity" | "hours";

export interface ReportColumn {
  key: string;
  label: string;
  type: "text" | "date" | Unit;
}

export type ReportRow = Record<string, string | number | null>;

export interface Headline {
  label: string;
  value: number | null;
  unit: Unit;
  /** A name to show with the number, e.g. the top customer. */
  text?: string;
  /** A few runners up, for wider dashboard tiles. */
  items?: { label: string; value: number }[];
}

export interface Chart {
  type: "bar" | "line";
  unit: Unit;
  points: { label: string; value: number }[];
}

export const PERIODS = ["today", "week", "month", "last_month", "quarter", "year"] as const;
export type PeriodKey = (typeof PERIODS)[number];

export interface Period {
  key: PeriodKey;
  label: string;
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  to: string;
}

export interface ReportBody {
  /** The report's name for this business, when it differs from the catalogue's ("GST summary"). */
  label?: string;
  headline?: Headline;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow;
  chart?: Chart;
  /** What the numbers count, in one plain sentence. */
  note?: string;
  /** Shown when there are no rows. */
  empty: string;
}

export type ReportResult =
  | ({ key: ReportKey; label: string; asks: string; state: "ready"; period?: Period } & ReportBody)
  | { key: ReportKey; label: string; asks: string; state: "waiting"; engine: "stock" | "ledger" };

export interface RunContext {
  /** Today in the business's timezone. */
  today: string;
  timezone: string;
  period?: PeriodKey;
}

export interface ReportImpl {
  /** Record types the report reads, including the ones it shows names from. */
  reads: readonly string[];
  /** Set for reports over a date range; the range the report opens with. */
  period?: PeriodKey;
  run(s: Snapshot, ctx: RunContext & { range?: Period }): ReportBody;
}

/* ----------------------------------------------------------------- snapshot */

/** The records a set of reports reads, loaded once. */
export interface Snapshot {
  list(target: string): StoredRecord[];
  get(target: string, id: unknown): StoredRecord | undefined;
  /** Display name of a referenced record, or "" when there is no reference. */
  title(target: string, id: unknown): string;
  /** The business's taxes, so tax reports use its own names (GST, sales tax). */
  taxes?: BusinessTaxes;
}

export function snapshotOf(compiled: Compiled, records: Record<string, StoredRecord[]>): Snapshot {
  const byId = new Map<string, Map<string, StoredRecord>>();
  for (const [target, recs] of Object.entries(records)) byId.set(target, new Map(recs.map((r) => [r.id, r])));
  return {
    list: (target) => records[target] ?? [],
    get: (target, id) => (typeof id === "string" ? byId.get(target)?.get(id) : undefined),
    taxes: taxesOf(compiled.bp),
    title(target, id) {
      if (typeof id !== "string" || !id) return "";
      const t = compiled.targets.get(target);
      const rec = byId.get(target)?.get(id);
      if (!rec) return "Unknown";
      return t ? titleOf(t, rec) : (str(rec.data.name) ?? rec.number ?? "Unknown");
    },
  };
}

/** Reads every listed record type that is switched on in this workspace, and the engine records asked for. */
export async function loadSnapshot(store: Store, tenant: string, compiled: Compiled, targets: Iterable<string>): Promise<Snapshot> {
  const wanted = [...new Set(targets)].filter((t) => compiled.targets.has(t) || (ENGINE_TARGETS as readonly string[]).includes(t));
  const records: Record<string, StoredRecord[]> = {};
  // All record types at once: on Firestore each list is a round trip, and a report can read a dozen.
  await store.read(tenant, async (tx) => {
    const lists = await Promise.all(wanted.map((t) => tx.list(t)));
    wanted.forEach((t, i) => (records[t] = lists[i]!));
  });
  return snapshotOf(compiled, records);
}

/* ------------------------------------------------------------------- dates */

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export function addMonths(d: string, n: number): string {
  const [y, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1 + n];
  const dt = new Date(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1));
  return iso(dt.getTime());
}
const monthEnd = (d: string) => addDays(addMonths(monthStart(d), 1), -1);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
export const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** The business date of a timestamp. */
export function businessDate(at: unknown, timezone: string): string | undefined {
  if (typeof at !== "string") return undefined;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return undefined;
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: "Today",
  week: "Last 7 days",
  month: "This month",
  last_month: "Last month",
  quarter: "Last 90 days",
  year: "This year",
};

export function periodOf(key: PeriodKey, today: string): Period {
  const p = (from: string, to: string): Period => ({ key, label: PERIOD_LABEL[key], from, to });
  switch (key) {
    case "today":
      return p(today, today);
    case "week":
      return p(addDays(today, -6), today);
    case "month":
      return p(monthStart(today), today);
    case "last_month":
      return p(addMonths(today, -1), monthEnd(addMonths(today, -1)));
    case "quarter":
      return p(addDays(today, -89), today);
    case "year":
      return p(`${today.slice(0, 4)}-01-01`, today);
  }
}

/** The stretch to compare a period with: the same days a month (or year) earlier, or the stretch just before. */
export function previousPeriod(p: Period): { from: string; to: string } {
  if (p.key === "month") {
    const from = addMonths(p.from, -1);
    const to = addDays(from, daysBetween(p.from, p.to));
    return { from, to: to > monthEnd(from) ? monthEnd(from) : to };
  }
  if (p.key === "last_month") return { from: addMonths(p.from, -1), to: monthEnd(addMonths(p.from, -1)) };
  if (p.key === "year") return { from: `${Number(p.from.slice(0, 4)) - 1}-01-01`, to: `${Number(p.to.slice(0, 4)) - 1}${p.to.slice(4)}` };
  const len = daysBetween(p.from, p.to) + 1;
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

export const within = (d: string | undefined, r: { from: string; to: string }) => d !== undefined && d >= r.from && d <= r.to;

/* --------------------------------------------------------------- helpers */

export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
export const lines = (r: StoredRecord, key = "lines") => (Array.isArray(r.data[key]) ? (r.data[key] as Record<string, unknown>[]) : []);
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
export const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/** Sum rows into groups, largest first. */
export function groupSum<T>(xs: readonly T[], key: (x: T) => string, value: (x: T) => number) {
  const out = new Map<string, { label: string; value: number; count: number }>();
  for (const x of xs) {
    const k = key(x);
    const g = out.get(k) ?? { label: k, value: 0, count: 0 };
    g.value += value(x);
    g.count++;
    out.set(k, g);
  }
  return [...out.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export function topPoints(groups: readonly { label: string; value: number }[], n = 10) {
  const top = groups.slice(0, n).map((g) => ({ label: g.label, value: g.value }));
  const rest = groups.slice(n).reduce((s, g) => s + g.value, 0);
  return rest ? [...top, { label: "Everyone else", value: rest }] : top;
}

/* -------------------------------------------------------------- visibility */

export interface VisibleReport {
  def: ReportDef;
  /** Where the business placed it, if it chose. */
  setting?: ReportSetting;
}

/** Modules the role can open: at least one of their screens is visible to it. */
export function viewableModules(compiled: Compiled, roleKey: string): Set<string> {
  const out = new Set<string>();
  for (const s of navigation(compiled.bp)) for (const m of s.modules) if (m.submodules.some((sub) => compiled.can(roleKey, sub.key, "view"))) out.add(m.key);
  return out;
}

/** Every report this workspace can run that this role may see, the business's own picks first. */
export function visibleReports(compiled: Compiled, roleKey: string, all: readonly ReportDef[]): VisibleReport[] {
  const bp = compiled.bp;
  const enabled = new Set(navigation(bp).flatMap((s) => s.modules.map((m) => m.key)));
  const ctx = { modules: enabled, extensions: new Set<string>(bp.extensions), tax: taxFlags(bp) };
  const canSee = viewableModules(compiled, roleKey);
  const roleId = bp.roles.find((r) => r.key === roleKey)?.id;
  const owner = bp.roles.find((r) => r.key === roleKey)?.owner;
  const settings = new Map(bp.reports.map((r) => [r.key as string, r]));
  const out: VisibleReport[] = [];
  for (const def of all) {
    if (!reportAvailable(def, ctx)) continue;
    const setting = settings.get(def.key);
    if (!owner && !canSee.has(def.module)) continue;
    if (setting?.roles?.length && !owner && (!roleId || !setting.roles.includes(roleId))) continue;
    out.push({ def, setting });
  }
  return out.sort((a, b) => Number(Boolean(b.setting)) - Number(Boolean(a.setting)));
}

export function reportDef(key: string): ReportDef | undefined {
  return REPORT_BY_KEY.get(key);
}
