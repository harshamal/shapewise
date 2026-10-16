import Link from "next/link";
import { redirect } from "next/navigation";
import { titleOf, type CField, type CTarget } from "@shapewise/runtime";
import { StatusPill, type Tone } from "@shapewise/ui";
import { ApprovalsInbox } from "@/components/approvals-inbox";
import { WorkspaceShell } from "@/components/workspace-shell";
import { formatValue, isNumeric } from "@/lib/format";
import { canCreate, listRecords, refTitles, targetFor } from "@/lib/records";
import { loadWorkspace, shellProps, type Workspace } from "@/lib/workspace";

const MAX_COLUMNS = 6;

export default async function SubmodulePage({ params }: { params: Promise<{ tenant: string; module: string; submodule: string }> }) {
  const { tenant, module, submodule } = await params;
  const ws = await loadWorkspace(tenant);
  // Settings live in the popup; old links open it on the right section.
  if (module === "settings") redirect(`${ws.base}?settings=${encodeURIComponent(submodule)}` as never);
  const { nav, t } = targetFor(ws, module, submodule);
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
      {t ? (
        <RecordList ws={ws} t={t} here={here} />
      ) : submodule === "approvals" ? (
        <ApprovalsInbox ws={ws} />
      ) : submodule === "audit_log" ? (
        <AuditLog ws={ws} />
      ) : (
        <div className="rounded-sw border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium">{nav.label}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
            {nav.kind === "report" ? "This report reads from the ledger and stock, which arrive with the engines." : "A purpose-built screen that arrives with its engine."}
          </p>
        </div>
      )}
    </WorkspaceShell>
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
