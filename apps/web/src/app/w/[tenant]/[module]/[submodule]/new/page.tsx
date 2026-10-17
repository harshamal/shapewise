import { notFound } from "next/navigation";
import { RecordForm } from "@/components/record-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { businessToday, canCreate, formSpec, formValues, refOptions, targetFor } from "@/lib/records";
import { loadWorkspace, shellProps } from "@/lib/workspace";
import { convertWithValues, saveRecord } from "../../../actions";
import { previewConversion, titleOf } from "@shapewise/runtime";

export default async function NewRecord({ params, searchParams }: { params: Promise<{ tenant: string; module: string; submodule: string }>; searchParams: Promise<{ from?: string; id?: string }> }) {
  const { tenant, module, submodule } = await params;
  const { from, id } = await searchParams;
  const ws = await loadWorkspace(tenant);
  const { t } = targetFor(ws, module, submodule);
  if (!t || !canCreate(ws, t)) notFound();
  const here = `${ws.base}/${module}/${submodule}`;
  // Converting: start from what carries across from the source document.
  const source = from && id ? ws.compiled.targets.get(from) : undefined;
  const preview = source && id ? await previewConversion({ store: ws.store, blueprint: async () => ws.compiled }, ws.tenant, ws.actor, source.target, id, t.target) : undefined;
  const sourceRec = source && id && preview?.ok ? await ws.store.read(ws.tenant, (tx) => tx.get(source.target, id)) : undefined;
  const initial = preview?.ok ? formValues(t, { data: preview.data } as never) : formValues(t);
  // Sensible defaults: today's date on documents.
  if ("date" in initial.header && !initial.header.date) initial.header.date = businessToday(ws);

  return (
    <WorkspaceShell {...shellProps(ws)} title={`New ${t.label.toLowerCase()}`}>
      {source && sourceRec && (
        <p className="mb-6 rounded-sw border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          Made from {source.label.toLowerCase()} <span className="font-medium">{titleOf(source, sourceRec)}</span>. Everything that carries across is filled in; add what's missing and save.
        </p>
      )}
      {preview && !preview.ok && <p className="mb-6 rounded-sw bg-danger-bg px-4 py-3 text-sm text-danger-fg">{preview.message}</p>}
      <RecordForm
        spec={formSpec(ws, t)}
        initial={initial}
        options={await refOptions(ws, t)}
        me={{ id: ws.actor.id, name: ws.actor.displayName ?? "Me" }}
        currency={ws.bp.business.currency}
        submitLabel={t.initial === "draft" ? "Save draft" : `Save ${t.label.toLowerCase()}`}
        cancelHref={here}
        detailBase={here}
        save={source && id && preview?.ok ? convertWithValues.bind(null, tenant, source.target, id, t.target, null, null) : saveRecord.bind(null, tenant, t.target, null, null)}
      />
    </WorkspaceShell>
  );
}
