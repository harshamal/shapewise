import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { loadBlueprint, navFor } from "@/lib/workspace";

export default async function EntityList({ params }: { params: Promise<{ tenant: string; entity: string }> }) {
  const { tenant, entity: key } = await params;
  const bp = await loadBlueprint(tenant);
  const entity = bp.entities.find((e) => e.key === key);
  if (!entity) notFound();

  // Columns: the title field plus the first few simple fields, until views are wired up.
  const columns = entity.fields.filter((f) => f.type !== "lines" && f.type !== "longtext").slice(0, 5);

  return (
    <WorkspaceShell workspaceName={bp.business.name} nav={navFor(tenant, bp)} title={entity.labelPlural}>
      <div className="overflow-x-auto rounded-sw border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-ink-muted">
              {columns.map((f) => (
                <th key={f.id} scope="col" className="h-9 px-4 font-medium">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-ink-muted">
                No {entity.labelPlural.toLowerCase()} yet.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </WorkspaceShell>
  );
}
