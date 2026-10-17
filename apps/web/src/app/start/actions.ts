"use server";

import { Blueprint, PRESET_BY_KEY, presetBlueprint, validateBlueprint } from "@shapewise/blueprint";
import { WorkspaceIdTaken, createTenant, suggestWorkspaceId, workspaceIdProblem } from "@shapewise/db";
import { adminAuth, adminDb } from "@/lib/auth/admin";
import { withMembership } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";
import { seedStarterRecords } from "@shapewise/runtime";
import { executeIn, loadWorkspace } from "@/lib/workspace";

export interface CreateResult {
  ok: boolean;
  id?: string;
  message?: string;
  field?: "name" | "id" | "preset";
}

/** The one place a workspace gets created: validates everything again, then makes the person its owner. */
async function finishCreate(name: string, id: string, bp: Blueprint): Promise<CreateResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Please sign in first." };
  const problem = workspaceIdProblem(id);
  if (problem) return { ok: false, field: "id", message: problem };
  const checked = validateBlueprint({ ...bp, version: 1, business: { ...bp.business, name } });
  if (!checked.ok || !checked.blueprint) {
    console.error("start: blueprint failed validation at creation", checked.issues.slice(0, 3));
    return { ok: false, message: "That setup isn't valid. Please start again." };
  }
  try {
    await createTenant(adminDb(), id, checked.blueprint, { uid: session.uid, email: session.email, name: session.name });
  } catch (e) {
    if (e instanceof WorkspaceIdTaken) return { ok: false, field: "id", message: e.message };
    throw e;
  }
  // Claims let Firestore security rules recognise the member; the server reads membership from Firestore.
  try {
    const user = await adminAuth().getUser(session.uid);
    await adminAuth().setCustomUserClaims(session.uid, withMembership(user.customClaims, id, checked.blueprint.roles.find((r) => r.owner)!.key));
  } catch (e) {
    console.warn("start: couldn't update sign-in claims; membership still recorded", e instanceof Error ? e.message : e);
  }
  await seedStarter(id, checked.blueprint);
  return { ok: true, id };
}

/**
 * What a new workspace needs before its first document can be finished:
 * chart of accounts, stores, cash and bank accounts, tax rates. Created
 * through the pipeline as the new owner. A failure here leaves a working
 * workspace; anything missing can be added by hand.
 */
async function seedStarter(id: string, bp: Blueprint) {
  try {
    const ws = await loadWorkspace(id);
    const r = await seedStarterRecords(bp, { run: (command) => executeIn(ws, command), list: (target) => ws.store.read(ws.tenant, (tx) => tx.list(target)) });
    if (r.problems.length) console.warn(`start: some starter records weren't created: ${r.problems.slice(0, 3).join("; ")}`);
  } catch (e) {
    console.warn("start: couldn't create starter records", e instanceof Error ? e.message : e);
  }
}

/** Template path: a workspace from an industry preset. */
export async function createWorkspace(input: { name: string; id: string; preset: string }): Promise<CreateResult> {
  const name = String(input.name ?? "").trim();
  const id = String(input.id ?? "").trim().toLowerCase();
  if (name.length < 2 || name.length > 120) return { ok: false, field: "name", message: "Give the business a name of 2 to 120 characters." };
  if (!PRESET_BY_KEY.has(input.preset)) return { ok: false, field: "preset", message: "Choose what kind of business this is." };
  const bp = validateBlueprint(presetBlueprint(input.preset, { name, currency: "LKR", locale: "en-LK", timezone: "Asia/Colombo" }));
  if (!bp.blueprint) return { ok: false, message: "That setup couldn't be prepared. Please try another kind of business." };
  return finishCreate(name, id, bp.blueprint);
}

/** Creates the workspace from a designed blueprint (validated again on the server). */
export async function createFromDesign(input: { blueprint: unknown; id: string }): Promise<CreateResult> {
  const parsed = Blueprint.safeParse(input.blueprint);
  if (!parsed.success) return { ok: false, message: "That setup isn't valid. Please design it again." };
  return finishCreate(parsed.data.business.name, String(input.id ?? "").trim().toLowerCase(), parsed.data);
}
