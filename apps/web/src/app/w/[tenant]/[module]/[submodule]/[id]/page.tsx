import Link from "next/link";
import { notFound } from "next/navigation";
import { titleOf, type CList } from "@shapewise/runtime";
import { StatusPill, type Tone } from "@shapewise/ui";
import { DocumentButtons } from "@/components/document-buttons";
import { RecordActions } from "@/components/record-actions";
import { WorkspaceShell } from "@/components/workspace-shell";
import { formatValue, isNumeric, type RefTitles } from "@/lib/format";
import { abilities, getRecord, refTitles, spec, targetFor } from "@/lib/records";
import { loadWorkspace, shellProps } from "@/lib/workspace";

export default async function RecordDetail({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; module: string; submodule: string; id: string }>;
  searchParams: Promise<{ note?: string }>;
}) {
  const { tenant, module, submodule, id } = await params;
  const { note } = await searchParams;
  const ws = await loadWorkspace(tenant);
  const { t } = targetFor(ws, module, submodule);
  if (!t) notFound();
  const rec = await getRecord(ws, t, id);
  const refs = await refTitles(ws, t, [rec]);
  const can = abilities(ws, t, rec);
  const here = `${ws.base}/${module}/${submodule}`;
  const ctx = { currency: ws.bp.business.currency, refs, me: ws.actor.id };
  const state = t.states.find((s) => s.key === rec.status);
  const history = await ws.store.listAudit(tenant, { recordId: id, limit: 20 });
  const shown = t.fields.filter((f) => f.key !== "number" && f.type !== "lines" && (f.key !== "currency" || ws.bp.extensions.includes("multi_currency")));
  const hrefOf = (target: string) => {
    const x = ws.compiled.targets.get(target)!;
    return `${ws.base}/${x.module}/${x.submodule}`;
  };

  return (
    <WorkspaceShell {...shellProps(ws)} title={t.labelPlural}>
      <div className="space-y-6">
        <header className="space-y-4">
          <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
            <Link href={here as never} className="hover:text-ink">
              {t.labelPlural}
            </Link>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl tracking-tight">{titleOf(t, rec)}</h2>
            {state && <StatusPill tone={state.tone as Tone}>{state.label}</StatusPill>}
            {typeof rec.data.payment_status === "string" && (
              <StatusPill tone={rec.data.payment_status === "paid" ? "success" : rec.data.payment_status === "overdue" ? "danger" : "neutral"}>
                {formatValue({ type: "select", options: [{ value: "unpaid", label: "Unpaid" }, { value: "partly_paid", label: "Partly paid" }, { value: "paid", label: "Paid" }, { value: "overdue", label: "Overdue" }] }, rec.data.payment_status, ctx)}
              </StatusPill>
            )}
            {rec.pendingApproval && <StatusPill tone="warning">Awaiting approval</StatusPill>}
          </div>
          {note && <p className="rounded-sw bg-info-bg px-3 py-2 text-sm text-info-fg">{note}</p>}
          {rec.pendingApproval && (
            <p className="rounded-sw bg-warning-bg px-3 py-2 text-sm text-warning-fg">
              A change to this record is waiting for approval.{" "}
              <Link href={`${ws.base}/governance/approvals` as never} className="underline underline-offset-4">
                Open approvals
              </Link>
            </p>
          )}
          <RecordActions
            tenant={tenant}
            target={t.target}
            id={rec.id}
            version={rec.version}
            actions={can.actions.map((a) => ({ key: a.key, label: a.label }))}
            converts={can.convert.map((c) => ({ ...c, href: hrefOf(c.to) }))}
            editHref={can.edit ? `${here}/${id}/edit` : undefined}
            canDelete={can.remove}
            listHref={here}
          />
          {t.printable && <DocumentButtons tenant={tenant} target={t.target} id={rec.id} label={t.label} />}
        </header>

        <section aria-label="Details" className="rounded-sw border bg-surface">
          <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((f) => {
              const v = rec.data[f.key];
              const text = formatValue(spec(f), v, ctx);
              const link = f.type === "ref" && typeof v === "string" && f.to && ws.compiled.targets.has(f.to) ? `${hrefOf(f.to)}/${v}` : undefined;
              return (
                <div key={f.key} className={f.type === "longtext" ? "sm:col-span-2 lg:col-span-3" : ""}>
                  <dt className="text-xs text-ink-muted">
                    {f.label}
                    {f.custom && <span className="sr-only"> (custom field)</span>}
                  </dt>
                  <dd className={`mt-0.5 text-sm ${isNumeric(f.type) ? "tabular" : ""} ${text === "—" ? "text-ink-faint" : ""} whitespace-pre-wrap`}>
                    {link ? (
                      <Link href={link as never} className="text-accent hover:underline">
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>

        {[t.lines, ...t.children]
          .filter((l): l is CList => Boolean(l))
          .map((l) => (
            <ListTable key={l.key} list={l} rows={(rec.data[l.key] as Record<string, unknown>[] | undefined) ?? []} ctx={ctx} totals={l === t.lines ? rec.data : undefined} />
          ))}

        {history.length > 0 && (
          <section aria-labelledby="history">
            <h2 id="history" className="mb-2 text-sm font-medium">
              History
            </h2>
            <ol className="divide-y rounded-sw border bg-surface text-sm">
              {history.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-3 px-4 py-2">
                  <span className="tabular w-36 shrink-0 text-ink-muted">{formatValue({ type: "datetime" }, e.at, ctx)}</span>
                  <span className="flex-1">{e.summary}</span>
                  <span className="text-ink-muted">{e.actor.name ?? e.actor.id}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}

function ListTable({ list, rows, ctx, totals }: { list: CList; rows: Record<string, unknown>[]; ctx: { currency: string; refs: RefTitles; me: string }; totals?: Record<string, unknown> }) {
  const cols = list.fields;
  const money = (k: string) => (typeof totals?.[k] === "number" ? formatValue({ type: "money" }, totals[k], ctx) : undefined);
  const footer = [
    ["Sub total", money("sub_total")],
    ["Tax", money("tax_total")],
    ["Total", money("total")],
  ].filter((x): x is [string, string] => Boolean(x[1]));

  return (
    <section aria-labelledby={`l-${list.key}`}>
      <h2 id={`l-${list.key}`} className="mb-2 text-sm font-medium">
        {list.label}
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-sw border bg-surface px-4 py-6 text-center text-sm text-ink-muted">None.</p>
      ) : (
        <div className="overflow-x-auto rounded-sw border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-ink-muted">
                {cols.map((f) => (
                  <th key={f.key} scope="col" className={`h-9 px-4 font-medium whitespace-nowrap ${isNumeric(f.type) ? "text-right" : ""}`}>
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={String(r._line ?? i)} className="border-b last:border-0">
                  {cols.map((f) => (
                    <td key={f.key} className={`px-4 py-2 ${isNumeric(f.type) ? "tabular text-right whitespace-nowrap" : ""}`}>
                      {formatValue(spec(f), r[f.key], ctx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {footer.length > 0 && (
              <tfoot>
                {footer.map(([label, value], i) => (
                  <tr key={label} className={i === 0 ? "border-t" : ""}>
                    <td colSpan={cols.length - 1} className="px-4 py-1.5 text-right text-ink-muted">
                      {label}
                    </td>
                    <td className={`tabular px-4 py-1.5 text-right whitespace-nowrap ${label === "Total" ? "font-medium" : ""}`}>{value}</td>
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}
