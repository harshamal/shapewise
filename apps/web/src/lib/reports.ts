import "server-only";
import type { ReportKey } from "@shapewise/blueprint";
import { PERIODS, dashboardTiles, reportsFor, runReports, type PeriodKey } from "@shapewise/runtime/reports";
import { businessToday } from "./records";
import type { Workspace } from "./workspace";

/** Reports this person may see in this workspace, the business's own picks first. */
export function visibleReports(ws: Workspace) {
  return reportsFor(ws.compiled, ws.actor.roleKey);
}

const ctxOf = (ws: Workspace, period?: PeriodKey) => ({ today: businessToday(ws), timezone: ws.bp.business.timezone, period });

export function runFor(ws: Workspace, keys: readonly ReportKey[], period?: PeriodKey) {
  return runReports({ store: ws.store, tenant: ws.tenant, compiled: ws.compiled, keys, ctx: ctxOf(ws, period) });
}

export function tilesFor(ws: Workspace) {
  return dashboardTiles({ store: ws.store, tenant: ws.tenant, compiled: ws.compiled, roleKey: ws.actor.roleKey, widgets: ws.bp.dashboard, ctx: ctxOf(ws) });
}

export const asPeriod = (v: string | undefined): PeriodKey | undefined => (PERIODS as readonly string[]).includes(v ?? "") ? (v as PeriodKey) : undefined;

/** Report screens other than "All reports" show one module's reports. */
export const ANALYTICS_MODULE: Record<string, string> = {
  sales_analytics: "sales",
  pos_analytics: "pos",
  purchase_analytics: "purchases",
  inventory_analytics: "inventory",
  production_reports: "production",
};

/** Where the full Reports page is, if this person can open it. */
export function reportsHref(ws: Workspace): string | undefined {
  const m = ws.sections.flatMap((s) => s.modules).find((x) => x.key === "reports");
  return m?.submodules.some((s) => s.key === "reports") && ws.compiled.can(ws.actor.roleKey, "reports", "view") ? `${ws.base}/reports/reports` : undefined;
}
