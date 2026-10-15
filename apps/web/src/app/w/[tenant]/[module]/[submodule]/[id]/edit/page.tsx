import { notFound } from "next/navigation";
import { titleOf } from "@shapewise/runtime";
import { RecordForm } from "@/components/record-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { abilities, formSpec, formValues, getRecord, refOptions, targetFor } from "@/lib/records";
import { loadWorkspace, shellProps } from "@/lib/workspace";
import { saveRecord } from "../../../../actions";

export default async function EditRecord({ params }: { params: Promise<{ tenant: string; module: string; submodule: string; id: string }> }) {
  const { tenant, module, submodule, id } = await params;
  const ws = await loadWorkspace(tenant);
  const { t } = targetFor(ws, module, submodule);
  if (!t) notFound();
  const rec = await getRecord(ws, t, id);
  if (!abilities(ws, t, rec).edit) notFound();
  const here = `${ws.base}/${module}/${submodule}`;

  return (
    <WorkspaceShell {...shellProps(ws)} title={`Edit ${titleOf(t, rec)}`}>
      <RecordForm
        spec={formSpec(ws, t)}
        initial={formValues(t, rec)}
        options={await refOptions(ws, t)}
        me={{ id: ws.actor.id, name: ws.actor.displayName ?? "Me" }}
        currency={ws.bp.business.currency}
        submitLabel="Save changes"
        cancelHref={`${here}/${id}`}
        detailBase={here}
        save={saveRecord.bind(null, tenant, t.target, id, rec.version)}
      />
    </WorkspaceShell>
  );
}
