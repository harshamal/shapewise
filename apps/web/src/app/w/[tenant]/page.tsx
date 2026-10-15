import Link from "next/link";
import { Button, StatusPill } from "@shapewise/ui";
import { WorkspaceShell } from "@/components/workspace-shell";
import { loadBlueprint, navFor } from "@/lib/workspace";

export default async function Overview({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const bp = await loadBlueprint(tenant);
  const job = bp.entities.find((e) => e.binding === "production.job");

  return (
    <WorkspaceShell
      workspaceName={bp.business.name}
      nav={navFor(tenant, bp)}
      title="Overview"
      actions={<Button variant="primary" size="sm">New sales order</Button>}
    >
      <section aria-labelledby="metrics" className="grid gap-px overflow-hidden rounded-sw border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="metrics" className="sr-only">Key figures</h2>
        {[
          ["Sales this month", "—"],
          ["Jobs in progress", "—"],
          ["Jobs running late", "—"],
          ["Scrap rate", "—"],
        ].map(([label, value]) => (
          <div key={label} className="bg-surface p-4">
            <p className="text-sm text-ink-muted">{label}</p>
            <p className="tabular mt-1 text-2xl font-medium">{value}</p>
          </div>
        ))}
      </section>

      {job?.stages && (
        <section aria-labelledby="stages" className="mt-8">
          <h2 id="stages" className="mb-3 text-sm font-medium">
            {job.labelPlural} by stage
          </h2>
          <ul className="divide-y rounded-sw border bg-surface">
            {job.stages.map((stage, i) => (
              <li key={stage.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="tabular w-5 text-ink-faint">{i + 1}</span>
                <span className="flex-1">{stage.label}</span>
                {stage.qc?.length ? <StatusPill tone="info">{stage.qc.length} QC checks</StatusPill> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-sm text-ink-muted">
        Showing the demo blueprint for <span className="text-ink">{bp.business.name}</span>.{" "}
        <Link href="/" className="text-accent underline-offset-4 hover:underline">
          Back to home
        </Link>
      </p>
    </WorkspaceShell>
  );
}
