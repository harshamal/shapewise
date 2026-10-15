import { notFound } from "next/navigation";
import { CORE_RECORDS, findNav, type Blueprint, type FieldType } from "@shapewise/blueprint";
import { Button, StatusPill, type Tone } from "@shapewise/ui";
import { WorkspaceShell } from "@/components/workspace-shell";
import { loadWorkspace } from "@/lib/workspace";

interface Column {
  key: string;
  label: string;
  type: FieldType;
}

export default async function SubmodulePage({ params }: { params: Promise<{ tenant: string; module: string; submodule: string }> }) {
  const { tenant, module, submodule } = await params;
  const { bp, sections, base, viewer } = await loadWorkspace(tenant);
  const found = findNav(sections, module, submodule);
  if (!found?.submodule) notFound();
  const { submodule: sub } = found;

  const shape = sub.record ? coreShape(bp, sub.record) : sub.entity ? customShape(bp, sub.entity) : undefined;

  return (
    <WorkspaceShell
      base={base}
      workspaceName={bp.business.name}
      viewer={viewer}
      sections={sections}
      title={sub.label}
      actions={shape?.creatable ? <Button variant="primary" size="sm">New {shape.singular.toLowerCase()}</Button> : undefined}
    >
      {shape ? (
        <>
          {shape.states.length > 1 && (
            <ul className="mb-4 flex flex-wrap items-center gap-1.5" aria-label="Statuses">
              {shape.states.map((s) => (
                <li key={s.key}>
                  <StatusPill tone={s.tone}>{s.label}</StatusPill>
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto rounded-sw border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-ink-muted">
                  {shape.columns.map((c) => (
                    <th key={c.key} scope="col" className={`h-9 px-4 font-medium whitespace-nowrap ${NUMERIC.has(c.type) ? "text-right" : ""}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={shape.columns.length} className="px-4 py-12 text-center text-ink-muted">
                    No {sub.label.toLowerCase()} yet.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {shape.customCount > 0 && (
            <p className="mt-3 text-xs text-ink-muted">
              Includes {shape.customCount} custom field{shape.customCount === 1 ? "" : "s"} from this business&apos;s blueprint.
            </p>
          )}
        </>
      ) : (
        <div className="rounded-sw border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium">{sub.label}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
            {sub.kind === "report" ? "This report reads from the ledger and stock rollups." : sub.kind === "settings" ? "Settings for this area." : "A purpose-built screen."} It arrives with the
            runtime build step.
          </p>
        </div>
      )}
    </WorkspaceShell>
  );
}

const NUMERIC = new Set<FieldType>(["integer", "decimal", "money", "quantity", "percent"]);
const MAX_COLUMNS = 7;

function coreShape(bp: Blueprint, record: keyof typeof CORE_RECORDS) {
  const rec = CORE_RECORDS[record];
  const custom = bp.customFields.filter((c) => c.target === record && c.part === "header");
  const view = bp.views.find((v) => v.target === record && v.type === "table" && v.columns?.length);
  const all: Column[] = [
    ...rec.fields
      .filter((f) => f.type !== "longtext" && f.type !== "file" && (f.key !== "currency" || bp.extensions.includes("multi_currency")))
      .map((f) => ({ key: f.key, label: f.label, type: f.type })),
    ...custom.map((c) => ({ key: c.field.key, label: c.field.label, type: c.field.type })),
  ];
  const columns = view?.columns ? view.columns.map((k) => all.find((c) => c.key === k)).filter((c): c is Column => Boolean(c)) : pick(all, custom.map((c) => c.field.key));
  return {
    singular: rec.label,
    creatable: Boolean(rec.lifecycle?.initial === "draft" || !rec.lifecycle || rec.lifecycle.states[0]?.key === "active"),
    states: (rec.lifecycle?.states ?? []).filter((s) => s.key !== "archived").map((s) => ({ key: s.key, label: s.label, tone: s.tone as Tone })),
    columns,
    customCount: columns.filter((c) => custom.some((x) => x.field.key === c.key)).length,
  };
}

function customShape(bp: Blueprint, entityId: string) {
  const e = bp.entities.find((x) => x.id === entityId)!;
  const columns: Column[] = e.fields
    .filter((f) => f.type !== "lines" && f.type !== "longtext")
    .slice(0, MAX_COLUMNS)
    .map((f) => ({ key: f.key, label: f.label, type: f.type === "computed" ? f.resultType : f.type }));
  return {
    singular: e.label,
    creatable: true,
    states: (e.workflow?.states ?? []).map((s) => ({ key: s.key, label: s.label, tone: s.tone as Tone })),
    columns,
    customCount: 0,
  };
}

/** The first few core columns, always keeping the business's own fields visible. */
function pick(all: Column[], customKeys: string[]): Column[] {
  const custom = all.filter((c) => customKeys.includes(c.key)).slice(0, 3);
  const core = all.filter((c) => !customKeys.includes(c.key)).slice(0, MAX_COLUMNS - custom.length);
  return [...core, ...custom];
}
