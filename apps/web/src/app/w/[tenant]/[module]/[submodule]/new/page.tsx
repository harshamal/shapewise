import { notFound } from "next/navigation";
import { RecordForm } from "@/components/record-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { businessToday, canCreate, formSpec, formValues, refOptions, targetFor } from "@/lib/records";
import { loadWorkspace, shellProps } from "@/lib/workspace";
import { saveRecord } from "../../../actions";

export default async function NewRecord({ params }: { params: Promise<{ tenant: string; module: string; submodule: string }> }) {
  const { tenant, module, submodule } = await params;
  const ws = await loadWorkspace(tenant);
  const { t } = targetFor(ws, module, submodule);
  if (!t || !canCreate(ws, t)) notFound();
  const here = `${ws.base}/${module}/${submodule}`;
  const initial = formValues(t);
  // Sensible defaults: today's date on documents.
  if ("date" in initial.header && !initial.header.date) initial.header.date = businessToday(ws);

  return (
    <WorkspaceShell {...shellProps(ws)} title={`New ${t.label.toLowerCase()}`}>
      <RecordForm
        spec={formSpec(ws, t)}
        initial={initial}
        options={await refOptions(ws, t)}
        me={{ id: ws.actor.id, name: ws.actor.displayName ?? "Me" }}
        currency={ws.bp.business.currency}
        submitLabel={t.initial === "draft" ? "Save draft" : `Save ${t.label.toLowerCase()}`}
        cancelHref={here}
        detailBase={here}
        save={saveRecord.bind(null, tenant, t.target, null, null)}
      />
    </WorkspaceShell>
  );
}
