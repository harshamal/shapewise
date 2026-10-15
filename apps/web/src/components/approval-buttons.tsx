"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@shapewise/ui";
import { decideApproval } from "@/app/w/[tenant]/actions";

export function ApprovalButtons({ tenant, approvalId }: { tenant: string; approvalId: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: "approve" | "reject") =>
    start(async () => {
      const note = decision === "reject" ? (prompt("Reason for rejecting (optional)") ?? undefined) : undefined;
      const r = await decideApproval(tenant, approvalId, decision, note);
      if (!r.ok) setError(r.message ?? "Couldn't record the decision.");
      router.refresh();
    });

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-sm text-danger-fg">{error}</span>}
      <Button size="sm" variant="primary" disabled={busy} onClick={() => decide("approve")}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("reject")}>
        Reject
      </Button>
    </div>
  );
}
