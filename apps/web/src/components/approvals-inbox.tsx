import { StatusPill } from "@shapewise/ui";
import { formatValue } from "@/lib/format";
import type { Workspace } from "@/lib/workspace";
import { ApprovalButtons } from "./approval-buttons";

/** Governance › Approvals: everything waiting for a decision, then recent decisions. */
export async function ApprovalsInbox({ ws }: { ws: Workspace }) {
  const all = await ws.store.listApprovals(ws.tenant);
  const pending = all.filter((a) => a.status === "pending");
  const done = all.filter((a) => a.status !== "pending").slice(0, 20);
  const role = ws.bp.roles.find((r) => r.key === ws.actor.roleKey);

  return (
    <div className="space-y-8">
      <section aria-labelledby="waiting">
        <h2 id="waiting" className="mb-3 text-sm font-medium">
          Waiting for a decision
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-sw border bg-surface px-6 py-10 text-center text-sm text-ink-muted">Nothing is waiting for approval.</p>
        ) : (
          <ul className="divide-y rounded-sw border bg-surface">
            {pending.map((a) => {
              const stage = a.stages[a.stageIndex]!;
              const mayDecide = Boolean(role?.owner || (role && stage.roles.includes(role.id)));
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-4 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.summary}</p>
                    <p className="text-ink-muted">
                      {a.label} · stage {a.stageIndex + 1} of {a.stages.length}: {stage.name} · asked by {a.requestedByName ?? a.requestedBy} via {a.envelope.actor.channel}
                    </p>
                  </div>
                  {mayDecide ? <ApprovalButtons tenant={ws.tenant} approvalId={a.id} /> : <span className="text-ink-muted">Waiting for {stage.name}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {done.length > 0 && (
        <section aria-labelledby="decided">
          <h2 id="decided" className="mb-3 text-sm font-medium">
            Recently decided
          </h2>
          <ul className="divide-y rounded-sw border bg-surface text-sm">
            {done.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <StatusPill tone={a.status === "approved" ? "success" : "danger"}>{a.status === "approved" ? "Approved" : "Rejected"}</StatusPill>
                <span className="flex-1">{a.summary}</span>
                <span className="text-ink-muted">{formatValue({ type: "datetime" }, a.decisions.at(-1)?.at, { currency: "" })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
