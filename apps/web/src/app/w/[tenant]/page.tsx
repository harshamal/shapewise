import { EXTENSION_BY_KEY, MODULES, type Widget } from "@shapewise/blueprint";
import { StatusPill } from "@shapewise/ui";
import { WorkspaceShell } from "@/components/workspace-shell";
import { loadWorkspace } from "@/lib/workspace";

const METRIC_LABELS: Record<string, string> = {
  sales_this_month: "Sales this month",
  receivables_overdue: "Overdue from customers",
  payables_due: "Bills due",
  cash_position: "Cash and bank",
  orders_due_this_week: "Orders due this week",
  top_products: "Top products",
  top_customers: "Top customers",
  stock_value: "Stock value",
  stock_below_reorder: "Items below reorder level",
  lots_expiring: "Lots expiring soon",
  jobs_in_progress: "Production orders in progress",
  jobs_late: "Production orders late",
  yield_pct: "Yield",
  scrap_pct: "Scrap rate",
  scrap_pct_by_machine: "Scrap by machine",
  qc_failures: "QC failures",
  open_ncrs: "Open NCRs",
  capacity_load: "Machine load",
  pending_approvals: "Waiting for approval",
};

const widgetLabel = (w: Widget) => w.label ?? (w.source.kind === "builtin" ? METRIC_LABELS[w.source.metric] : "Metric");

export default async function Overview({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const { bp, sections, base, viewer } = await loadWorkspace(tenant);
  const modules = MODULES.filter((m) => !m.core && bp.modules.some((c) => c.key === m.key && c.enabled)).map((m) => m.label);

  return (
    <WorkspaceShell base={base} workspaceName={bp.business.name} viewer={viewer} sections={sections} title="Overview">
      <section aria-labelledby="metrics" className="grid gap-px overflow-hidden rounded-sw border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="metrics" className="sr-only">Key figures</h2>
        {bp.dashboard.map((w) => (
          <div key={w.id} className={`bg-surface p-4 ${w.size === "md" ? "sm:col-span-2" : w.size === "lg" ? "sm:col-span-2 lg:col-span-4" : ""}`}>
            <p className="text-sm text-ink-muted">{widgetLabel(w)}</p>
            <p className="tabular mt-1 text-2xl font-medium">—</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="shape" className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 id="shape" className="mb-3 text-sm font-medium">How this workspace is set up</h2>
          <dl className="divide-y rounded-sw border bg-surface text-sm">
            <Row label="Industry">{bp.business.industry ?? "—"}</Row>
            <Row label="Modules">{modules.join(", ")}</Row>
            <Row label="Roles">{bp.roles.map((r) => r.label).join(", ")}</Row>
            <Row label="Custom">
              {bp.customFields.length} custom fields, {bp.entities.length} custom record type{bp.entities.length === 1 ? "" : "s"}, {bp.rules.length} rules, {bp.approvals.length} approval rules
            </Row>
          </dl>
        </div>
        <div>
          <h2 className="mb-3 text-sm font-medium">Extensions on</h2>
          <ul className="flex flex-wrap gap-1.5">
            {bp.extensions.map((k) => (
              <li key={k}>
                <StatusPill tone="info">{EXTENSION_BY_KEY[k].name}</StatusPill>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </WorkspaceShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-4 px-4 py-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
