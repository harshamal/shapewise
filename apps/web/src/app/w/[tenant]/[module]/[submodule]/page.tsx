import Link from "next/link";
import { redirect } from "next/navigation";
import { titleOf, type CField, type CTarget } from "@shapewise/runtime";
import { REPORT_CATEGORIES, REPORT_CATEGORY_LABEL, type ReportKey } from "@shapewise/blueprint";
import { PERIOD_LABEL, RECORD_REPORTS, hasPeriod, type PeriodKey } from "@shapewise/runtime/reports";
import { StatusPill, type Tone } from "@shapewise/ui";
import { ApprovalsInbox } from "@/components/approvals-inbox";
import { ReportCard, ReportView } from "@/components/report-view";
import { WorkspaceShell } from "@/components/workspace-shell";
import { formatValue, isNumeric } from "@/lib/format";
import { canCreate, listRecords, refTitles, targetFor } from "@/lib/records";
import { ANALYTICS_MODULE, asPeriod, reportsHref, runFor, visibleReports } from "@/lib/reports";
import { ChangeStudio } from "@/components/change-studio";
import { PosTerminal } from "@/components/pos-terminal";
import { Screen, hasScreen } from "@/components/screens";
import { loadWorkspace, shellProps, type Workspace } from "@/lib/workspace";

const MAX_COLUMNS = 6;

export default async function SubmodulePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; module: string; submodule: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant, module, submodule } = await params;
  const raw = await searchParams;
  const query = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const ws = await loadWorkspace(tenant);
  // Settings live in the popup; old links open it on the right section.
  if (module === "settings") redirect(`${ws.base}?settings=${encodeURIComponent(submodule)}` as never);
  const { nav, t, module: mod } = targetFor(ws, module, submodule);
  // A module opens on its first screen; reports the business placed on the module show there.
  const landing = mod.submodules[0]?.key === submodule;
  const here = `${ws.base}/${module}/${submodule}`;

  return (
    <WorkspaceShell
      {...shellProps(ws)}
      title={nav.label}
      actions={
        t && canCreate(ws, t) ? (
          <Link href={`${here}/new` as never} className="inline-flex h-8 items-center rounded-sw bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover">
            New {t.label.toLowerCase()}
          </Link>
        ) : undefined
      }
    >
      {landing && <ModuleReports ws={ws} module={module} />}
      {t ? (
        <RecordList ws={ws} t={t} here={here} />
      ) : submodule === "approvals" ? (
        <ApprovalsInbox ws={ws} />
      ) : hasScreen(submodule) ? (
        <Screen submodule={submodule} ws={ws} q={query} here={here} />
      ) : submodule === "pos_terminal" ? (
        <PosTerminal tenant={tenant} />
      ) : submodule === "change_studio" ? (
        <ChangeStudio tenant={tenant} />
      ) : submodule === "audit_log" ? (
        <AuditLog ws={ws} />
      ) : nav.kind === "report" && (submodule === "reports" || ANALYTICS_MODULE[submodule]) ? (
        <ReportsScreen ws={ws} here={here} only={ANALYTICS_MODULE[submodule]} pick={query.r} period={asPeriod(query.p)} />
      ) : (
        <div className="rounded-sw border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium">{nav.label}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
            {nav.kind === "report" ? "This report starts with the accounting engine, which posts every document to the ledger." : "A purpose-built screen that arrives with its engine."}
          </p>
        </div>
      )}
    </WorkspaceShell>
  );
}

/* ---------------------------------------------------------------- reports */

async function ReportsScreen({ ws, here, only, pick, period }: { ws: Workspace; here: string; only?: string; pick?: string; period?: PeriodKey }) {
  const all = visibleReports(ws).filter((r) => !only || r.def.module === only);
  if (!all.length) return <p className="rounded-sw border bg-surface px-6 py-12 text-center text-sm text-ink-muted">There are no reports here that your role can see.</p>;
  const chosen = all.find((r) => r.def.key === pick) ?? all[0]!;
  const [result] = await runFor(ws, [chosen.def.key as ReportKey], period);
  const href = (key: string, p?: string) => `${here}?r=${key}${p ? `&p=${p}` : ""}`;
  const periods = hasPeriod(chosen.def.key) ? (["week", "month", "last_month", "quarter", "year"] as const).map((k) => ({ key: k, label: PERIOD_LABEL[k], href: href(chosen.def.key, k) })) : undefined;
  const groups = REPORT_CATEGORIES.map((c) => ({ c, items: all.filter((r) => r.def.category === c) })).filter((g) => g.items.length);

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <nav aria-label="Reports" className="space-y-4 text-sm">
        {groups.map(({ c, items }) => (
          <div key={c}>
            {groups.length > 1 && <p className="mb-1 px-2 text-xs font-medium text-ink-faint">{REPORT_CATEGORY_LABEL[c]}</p>}
            <ul>
              {items.map((r) => (
                <li key={r.def.key}>
                  <Link
                    href={href(r.def.key) as never}
                    aria-current={r.def.key === chosen.def.key ? "page" : undefined}
                    className={`flex items-center justify-between gap-2 rounded-sw px-2 py-1.5 ${r.def.key === chosen.def.key ? "bg-accent-soft text-ink" : "text-ink-muted hover:bg-surface-sunken hover:text-ink"}`}
                  >
                    <span className="truncate">{r.def.label}</span>
                    {!RECORD_REPORTS[r.def.key as ReportKey] && <span className="shrink-0 text-xs text-ink-faint">Soon</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="min-w-0">{result && <ReportView r={result} currency={ws.bp.business.currency} periods={periods} />}</div>
    </div>
  );
}

/** Reports the business placed on this module, as short cards above its first screen. */
async function ModuleReports({ ws, module }: { ws: Workspace; module: string }) {
  const placed = visibleReports(ws).filter((r) => r.def.module === module && r.setting?.places.includes("module"));
  if (!placed.length) return null;
  const results = await runFor(ws, placed.map((r) => r.def.key as ReportKey));
  const full = reportsHref(ws);
  return (
    <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {results.map((r) => (
        <ReportCard key={r.key} r={r} currency={ws.bp.business.currency} href={full ? `${full}?r=${r.key}` : undefined} />
      ))}
    </div>
  );
}

async function RecordList({ ws, t, here }: { ws: Workspace; t: CTarget; here: string }) {
  const rows = await listRecords(ws, t);
  const refs = await refTitles(ws, t, rows);
  const columns = pickColumns(ws, t);
  const ctx = { currency: ws.bp.business.currency, refs, me: ws.actor.id };

  if (rows.length === 0) {
    return (
      <div className="rounded-sw border bg-surface px-6 py-16 text-center">
        <p className="text-sm font-medium">No {t.labelPlural.toLowerCase()} yet</p>
        <p className="mt-1 text-sm text-ink-muted">{canCreateText(ws, t)}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-sw border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-ink-muted">
            <th scope="col" className="h-9 px-4 font-medium">
              {t.label}
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`h-9 px-4 font-medium whitespace-nowrap ${isNumeric(c.type) ? "text-right" : ""}`}>
                {c.label}
              </th>
            ))}
            {t.states.length > 1 && (
              <th scope="col" className="h-9 px-4 font-medium">
                Status
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const state = t.states.find((s) => s.key === r.status);
            return (
              <tr key={r.id} className="border-b last:border-0 hover:bg-surface-sunken">
                <td className="px-4 py-2.5">
                  <Link href={`${here}/${r.id}` as never} className="font-medium hover:underline">
                    {titleOf(t, r)}
                  </Link>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-2.5 whitespace-nowrap ${isNumeric(c.type) ? "tabular text-right" : ""}`}>
                    {formatValue(c, r.data[c.key], ctx)}
                  </td>
                ))}
                {t.states.length > 1 && (
                  <td className="px-4 py-2.5">
                    {state && <StatusPill tone={state.tone as Tone}>{state.label}</StatusPill>}
                    {r.pendingApproval && (
                      <span className="ml-1.5">
                        <StatusPill tone="warning">Awaiting approval</StatusPill>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function canCreateText(ws: Workspace, t: CTarget) {
  return canCreate(ws, t) ? `Use “New ${t.label.toLowerCase()}” to add the first one.` : "Your role can't add these.";
}

/** The business's default table view if it has one, else the first useful fields. */
function pickColumns(ws: Workspace, t: CTarget): CField[] {
  const view = ws.bp.views.find((v) => v.target === t.target && v.type === "table" && v.columns?.length && !v.filter);
  const usable = t.fields.filter((f) => f.key !== t.titleField && f.key !== "number" && !["longtext", "file", "image", "lines"].includes(f.type) && (f.key !== "currency" || ws.bp.extensions.includes("multi_currency")));
  if (view?.columns) return view.columns.map((k) => usable.find((f) => f.key === k || f.id === k)).filter((f): f is CField => Boolean(f));
  const custom = usable.filter((f) => f.custom).slice(0, 2);
  return [...usable.filter((f) => !f.custom).slice(0, MAX_COLUMNS - custom.length), ...custom];
}

async function AuditLog({ ws }: { ws: Workspace }) {
  const entries = await ws.store.listAudit(ws.tenant, { limit: 100 });
  if (!entries.length) return <p className="rounded-sw border bg-surface px-6 py-12 text-center text-sm text-ink-muted">Nothing has happened in this workspace yet.</p>;
  return (
    <ol className="divide-y rounded-sw border bg-surface text-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5">
          <span className="tabular w-36 shrink-0 text-ink-muted">{formatValue({ type: "datetime" }, e.at, { currency: "" })}</span>
          <span className="flex-1">{e.summary}</span>
          <span className="text-ink-muted">
            {e.actor.name ?? e.actor.id} · {e.actor.channel}
          </span>
        </li>
      ))}
    </ol>
  );
}
