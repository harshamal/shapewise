"use server";

import { revalidatePath } from "next/cache";
import type { Command, CommandResult } from "@shapewise/runtime";
import { z } from "zod";
import { OverlayOp, applyOps } from "@shapewise/blueprint";
import { executeIn, loadWorkspace, setBlueprint, store } from "@/lib/workspace";

/**
 * Server actions behind every record screen. Each one reloads the workspace,
 * so the role always comes from the session, never from the browser, and
 * then runs one command through the pipeline.
 */

export interface ActionResult {
  ok: boolean;
  pending?: boolean;
  recordId?: string;
  message?: string;
  warnings?: string[];
  issues?: { path: (string | number)[]; message: string }[];
}

async function run(tenant: string, command: Command): Promise<ActionResult> {
  const ws = await loadWorkspace(tenant);
  const r: CommandResult = await executeIn(ws, command);
  revalidatePath(`/w/${tenant}`, "layout");
  if (r.status === "ok") return { ok: true, recordId: r.recordId, warnings: r.warnings.map((w) => w.message) };
  if (r.status === "pending_approval") return { ok: true, pending: true, message: `Sent for approval. ${r.reason}` };
  return { ok: false, message: r.error.message, issues: r.error.issues };
}

export async function saveRecord(tenant: string, target: string, id: string | null, version: number | null, values: Record<string, unknown>) {
  return id
    ? run(tenant, { type: "record.update", target, recordId: id, patch: values, expectedVersion: version ?? undefined })
    : run(tenant, { type: "record.create", target, data: values });
}

export async function runRecordAction(tenant: string, target: string, id: string, action: string, version: number) {
  return run(tenant, { type: "record.action", target, recordId: id, action, expectedVersion: version });
}

export async function convertRecord(tenant: string, from: string, id: string, to: string) {
  return run(tenant, { type: "record.convert", from: from as never, recordId: id, to: to as never });
}

export async function deleteRecord(tenant: string, target: string, id: string) {
  return run(tenant, { type: "record.delete", target, recordId: id });
}

/**
 * Settings changes: applied to the workspace blueprint as overlay ops and
 * validated as a whole. Only roles with manage rights on settings may do it.
 */
export async function changeSettings(tenant: string, ops: OverlayOp[]): Promise<ActionResult> {
  const ws = await loadWorkspace(tenant);
  if (!ws.compiled.can(ws.actor.roleKey, "extensions", "manage")) return { ok: false, message: "Your role can't change settings." };
  const parsed = z.array(OverlayOp).max(50).safeParse(ops);
  if (!parsed.success) return { ok: false, message: "That change isn't valid." };
  const r = applyOps(ws.bp, parsed.data);
  if (!r.ok) return { ok: false, message: r.issues[0]?.message ?? "That change isn't allowed.", issues: r.issues.map((i) => ({ path: i.path, message: i.message })) };
  setBlueprint(tenant, r.blueprint);
  await store.write(tenant, async (tx) => {
    tx.audit({
      id: `aud_${crypto.randomUUID()}`,
      at: new Date().toISOString(),
      commandId: crypto.randomUUID(),
      actor: { id: ws.actor.id, name: ws.actor.displayName, kind: ws.actor.kind, channel: "web", roleKey: ws.actor.roleKey },
      target: "blueprint",
      action: "settings",
      summary: `Settings: ${r.summary.join("; ")} (version ${r.blueprint.version})`,
    });
  });
  revalidatePath(`/w/${tenant}`, "layout");
  return { ok: true, message: r.summary.join("; ") };
}

export async function decideApproval(tenant: string, approvalId: string, decision: "approve" | "reject", note?: string) {
  return run(tenant, { type: "approval.decide", approvalId, decision, note: note || undefined });
}
