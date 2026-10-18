import "server-only";
import { JOURNAL, type StoredLine } from "@shapewise/runtime";
import { addMonths, loadSnapshot, type Snapshot } from "@shapewise/runtime/reports";
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
export async function ledgerSnapshot(ws: Workspace, extra: string[] = []): Promise<Snapshot> {
  const first = await loadSnapshot(ws.store, ws.tenant, ws.compiled, [JOURNAL]);
  const sources = new Set(first.list(JOURNAL).map((e) => String(e.data.source_target)));
  return loadSnapshot(ws.store, ws.tenant, ws.compiled, [JOURNAL, "account", ...sources, ...extra]);
}

export type { StoredLine };
