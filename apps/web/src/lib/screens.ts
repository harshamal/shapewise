import "server-only";
import { JOURNAL, type StoredLine, type StoredRecord } from "@shapewise/runtime";
import { addMonths, snapshotOf, type Snapshot } from "@shapewise/runtime/reports";
import { businessToday } from "./records";
import type { Workspace } from "./workspace";

/** Helpers the purpose-built screens share: links, dates, and loading the books. */

export type Query = Record<string, string | undefined>;

/** Where a record opens, or undefined when this person can't open that screen. */
export function hrefFor(ws: Workspace, target: string, id?: string): string | undefined {
  const t = ws.compiled.targets.get(target);
  if (!t || !ws.compiled.can(ws.actor.roleKey, t.submodule, "view")) return undefined;
  if (!ws.sections.some((s) => s.modules.some((m) => m.key === t.module && m.submodules.some((x) => x.key === t.submodule)))) return undefined;
  return `${ws.base}/${t.module}/${t.submodule}${id ? `/${id}` : ""}`;
}

/** Where a screen (not a record type) is, if this person can open it. */
export function screenHref(ws: Workspace, submodule: string): string | undefined {
  for (const s of ws.sections) for (const m of s.modules) if (m.submodules.some((x) => x.key === submodule)) return `${ws.base}/${m.key}/${submodule}`;
  return undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const asDate = (v: string | undefined, fallback: string) => (v && DATE.test(v) ? v : fallback);

/** The first day of the financial year a date falls in. */
export function yearStart(ws: Workspace, day: string): string {
  const m = ws.bp.business.fiscalYearStartMonth;
  const start = `${day.slice(0, 4)}-${String(m).padStart(2, "0")}-01`;
  return start <= day ? start : addMonths(start, -12);
}

export function today(ws: Workspace) {
  return businessToday(ws);
}

/** The books, the chart of accounts, and every document an entry came from (for names and links). */
export function ledgerSnapshot(ws: Workspace, extra: string[] = []): Promise<Snapshot> {
  return journalSnapshot(ws, ["account", "customer", "vendor", ...extra]);
}

/**
 * The journal plus other record types, read once each: the journal and the
 * named types load together, then the document types the entries came from
 * (for names and links) load together in a second round. Each list is a
 * round trip, so nothing is read twice and nothing waits on anything it
 * doesn't need.
 */
export async function journalSnapshot(src: Pick<Workspace, "store" | "tenant" | "compiled">, targets: string[]): Promise<Snapshot> {
  const known = (t: string) => src.compiled.targets.has(t);
  const first = [...new Set(targets.filter(known))];
  const records: Record<string, StoredRecord[]> = {};
  await src.store.read(src.tenant, async (tx) => {
    const [journal, ...lists] = await Promise.all([tx.list(JOURNAL), ...first.map((t) => tx.list(t))]);
    records[JOURNAL] = journal!;
    first.forEach((t, i) => (records[t] = lists[i]!));
    const sources = [...new Set(journal!.map((e) => String(e.data.source_target)))].filter((t) => known(t) && !(t in records));
    const more = await Promise.all(sources.map((t) => tx.list(t)));
    sources.forEach((t, i) => (records[t] = more[i]!));
  });
  return snapshotOf(src.compiled, records);
}

export type { StoredLine };
