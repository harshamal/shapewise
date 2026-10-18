"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LlmError, createLlm, draftChange, describeChange } from "@shapewise/ai";
import { compile } from "@shapewise/runtime";
import { BlueprintConflict } from "@shapewise/db";
import { changeStore } from "@/lib/change-store";
import { loadWorkspace } from "@/lib/workspace";

/**
 * The change studio. Anyone whose role can create system changes may draft
 * one; roles that can approve them (and the owner) apply it, everyone else
 * sends it for approval. Every applied change is a new setup version, and
 * undo goes back one version.
 */

export interface ChangeRow {
  id: string;
  status: "draft" | "pending" | "applied" | "rejected";
  request: string;
  summary: string;
  lines: string[];
  notes: string[];
  byName?: string | null;
  createdAt: string;
  mine: boolean;
}

export interface StudioView {
  canDraft: boolean;
  canApply: boolean;
  version: number;
  changes: ChangeRow[];
  history: { version: number; summary: string; createdAt: string }[];
}

async function context(tenant: string) {
  const ws = await loadWorkspace(tenant);
  const owner = ws.bp.roles.find((r) => r.key === ws.actor.roleKey)?.owner ?? false;
  return {
    ws,
    store: changeStore(tenant, ws.bp),
    canDraft: owner || ws.compiled.can(ws.actor.roleKey, "change_studio", "create"),
    canApply: owner || ws.compiled.can(ws.actor.roleKey, "change_studio", "approve"),
  };
}

export async function loadStudio(tenant: string): Promise<StudioView> {
  const { ws, store, canDraft, canApply } = await context(tenant);
  const [changes, history] = await Promise.all([store.list(), store.history()]);
  return {
    canDraft,
    canApply,
    version: ws.bp.version,
    changes: changes.filter((c) => c.status !== "draft" || c.by === ws.actor.id).map((c) => ({ id: c.id, status: c.status, request: c.request, summary: c.summary, lines: c.lines, notes: c.notes, byName: c.byName, createdAt: c.createdAt, mine: c.by === ws.actor.id })),
    history: history.map((h) => ({ version: h.version, summary: h.summary, createdAt: h.createdAt })),
  };
}

/** Plain words → a drafted change, checked against the live setup, saved as a draft to look over. */
export async function draftSystemChange(tenant: string, request: string): Promise<{ ok: boolean; message?: string; question?: string; change?: ChangeRow }> {
  const { ws, store, canDraft } = await context(tenant);
  if (!canDraft) return { ok: false, message: "Your role can't change the setup." };
  const text = z.string().trim().min(3).max(2000).safeParse(request);
  if (!text.success) return { ok: false, message: "Describe the change in a sentence or two." };
  try {
    const r = await draftChange(createLlm(), ws.bp, text.data);
    if (!r.ok) return r.question ? { ok: true, question: r.question } : { ok: false, message: r.message };
    const doc = { status: "draft" as const, request: text.data, summary: r.summary, lines: r.lines, notes: r.notes, baseVersion: ws.bp.version, body: r.blueprint, by: ws.actor.id, byName: ws.actor.displayName ?? null, createdAt: new Date().toISOString() };
    const id = await store.save(doc);
    return { ok: true, change: { id, status: "draft", request: doc.request, summary: doc.summary, lines: doc.lines, notes: doc.notes, byName: doc.byName, createdAt: doc.createdAt, mine: true } };
  } catch (e) {
    return { ok: false, message: e instanceof LlmError ? e.message : "The AI couldn't draft that just now. Try again." };
  }
}

/** Applies a drafted or pending change (approvers only), or sends a draft for approval. */
export async function decideChange(tenant: string, id: string, decision: "apply" | "submit" | "reject" | "discard"): Promise<{ ok: boolean; message?: string }> {
  const { ws, store, canApply } = await context(tenant);
  const c = await store.get(z.string().min(1).max(64).parse(id));
  if (!c) return { ok: false, message: "That change doesn't exist." };
  const now = new Date().toISOString();
  if (decision === "discard") {
    if (c.by !== ws.actor.id || c.status !== "draft") return { ok: false, message: "Only your own drafts can be discarded." };
    await store.update(id, { status: "rejected", decidedBy: ws.actor.id, decidedAt: now });
    return { ok: true, message: "Discarded." };
  }
  if (decision === "submit") {
    if (c.by !== ws.actor.id || c.status !== "draft") return { ok: false, message: "Only your own drafts can be sent for approval." };
    await store.update(id, { status: "pending" });
    return { ok: true, message: "Sent for approval." };
  }
  if (!canApply) return { ok: false, message: "Your role can't approve setup changes." };
  if (c.status !== "draft" && c.status !== "pending") return { ok: false, message: `This change was already ${c.status}.` };
  if (decision === "reject") {
    await store.update(id, { status: "rejected", decidedBy: ws.actor.id, decidedAt: now });
    return { ok: true, message: "Rejected." };
  }
  // The setup must not have moved since the draft was made, or the draft would undo someone else's change.
  if (c.baseVersion !== ws.bp.version) return { ok: false, message: "The setup has changed since this was drafted. Draft it again so it builds on the latest setup." };
  try {
    compile(c.body);
  } catch {
    return { ok: false, message: "That change no longer fits the setup. Draft it again." };
  }
  const next = { ...c.body, version: ws.bp.version + 1 };
  try {
    await store.publish(next, ws.actor.id, c.summary);
  } catch (e) {
    if (e instanceof BlueprintConflict) return { ok: false, message: e.message };
    throw e;
  }
  await store.update(id, { status: "applied", decidedBy: ws.actor.id, decidedAt: now, appliedVersion: next.version });
  await audit(ws, `System change applied: ${c.summary} (version ${next.version})`);
  revalidatePath(`/w/${tenant}`, "layout");
  return { ok: true, message: `Applied. The setup is now version ${next.version}.` };
}

/** Goes back to the previous setup version, as a new version (nothing is lost). */
export async function undoLastChange(tenant: string): Promise<{ ok: boolean; message?: string; lines?: string[] }> {
  const { ws, store, canApply } = await context(tenant);
  if (!canApply) return { ok: false, message: "Your role can't change the setup." };
  const history = await store.history();
  const previous = history.find((h) => h.version < ws.bp.version);
  if (!previous) return { ok: false, message: "There's no earlier version to go back to." };
  const body = await store.version(previous.version);
  if (!body) return { ok: false, message: "That earlier version couldn't be read." };
  const next = { ...body, version: ws.bp.version + 1 };
  const lines = describeChange(ws.bp, next);
  try {
    await store.publish(next, ws.actor.id, `Back to version ${previous.version}`);
  } catch (e) {
    if (e instanceof BlueprintConflict) return { ok: false, message: e.message };
    throw e;
  }
  await audit(ws, `Setup returned to version ${previous.version} (now version ${next.version})`);
  revalidatePath(`/w/${tenant}`, "layout");
  return { ok: true, message: `Back to how it was at version ${previous.version}.`, lines };
}

async function audit(ws: Awaited<ReturnType<typeof loadWorkspace>>, summary: string) {
  await ws.store.write(ws.tenant, async (tx) => {
    tx.audit({ id: `aud_${crypto.randomUUID()}`, at: new Date().toISOString(), commandId: crypto.randomUUID(), actor: { id: ws.actor.id, name: ws.actor.displayName, kind: ws.actor.kind, channel: "web", roleKey: ws.actor.roleKey }, target: "blueprint", action: "change", summary });
  });
}
