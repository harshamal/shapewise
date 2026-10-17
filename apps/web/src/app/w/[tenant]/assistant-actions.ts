"use server";

import { revalidatePath } from "next/cache";
import type { Proposal } from "@shapewise/ai";
import type { Command } from "@shapewise/runtime";
import { executeIn, loadWorkspace } from "@/lib/workspace";
import type { ActionResult } from "./actions";

/** Carry out a proposal the person confirmed, as them, through the command pipeline. */
export async function confirmProposal(tenant: string, p: Proposal): Promise<ActionResult> {
  const ws = await loadWorkspace(tenant);
  let command: Command;
  switch (p.kind) {
    case "create":
      command = { type: "record.create", target: p.record, data: p.data ?? {} };
      break;
    case "update":
      command = { type: "record.update", target: p.record, recordId: p.recordId ?? "", patch: p.data ?? {} };
      break;
    case "action":
      command = { type: "record.action", target: p.record, recordId: p.recordId ?? "", action: p.action ?? "", data: p.data };
      break;
    case "convert":
      command = { type: "record.convert", from: p.record as never, recordId: p.recordId ?? "", to: (p.to ?? "") as never, data: p.data };
      break;
  }
  const r = await executeIn({ ...ws, actor: { ...ws.actor, channel: "assistant" } }, command);
  revalidatePath(`/w/${tenant}`, "layout");
  if (r.status === "ok") return { ok: true, recordId: r.recordId, warnings: r.warnings.map((w) => w.message) };
  if (r.status === "pending_approval") return { ok: true, pending: true, message: `Sent for approval. ${r.reason}` };
  return { ok: false, message: r.error.message, issues: r.error.issues };
}
