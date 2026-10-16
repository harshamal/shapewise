"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LlmError, createLlm, runAssistant, type Message, type Proposal } from "@shapewise/ai";
import type { Command } from "@shapewise/runtime";
import { businessToday } from "@/lib/records";
import { executeIn, loadWorkspace } from "@/lib/workspace";
import type { ActionResult } from "./actions";

export interface AskResult {
  ok: boolean;
  message?: string;
  reply?: string;
  history?: Message[];
  proposals?: Proposal[];
  toolsUsed?: { name: string; args: unknown; ok: boolean }[];
}

/**
 * One question to the workspace assistant. The history comes from the
 * browser; it can only ever affect this person's own conversation, because
 * every read goes through their role and every change is a proposal that the
 * pipeline checks again when they confirm.
 */
export async function askAssistant(tenant: string, history: unknown, question: string): Promise<AskResult> {
  const ws = await loadWorkspace(tenant);
  const h = z.array(z.unknown()).max(80).safeParse(history);
  const q = z.string().trim().min(1).max(4000).safeParse(question);
  if (!h.success || !q.success) return { ok: false, message: "That question couldn't be sent." };
  try {
    const r = await runAssistant(
      createLlm(),
      { compiled: ws.compiled, store: ws.store, tenant, roleKey: ws.actor.roleKey, today: businessToday(ws), now: new Date().toISOString() },
      h.data as Message[],
      q.data,
    );
    return { ok: true, reply: r.reply, history: r.messages, proposals: r.proposals, toolsUsed: r.toolsUsed };
  } catch (e) {
    return { ok: false, message: e instanceof LlmError ? e.message : "The assistant couldn't answer just now. Try again." };
  }
}

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
