"use server";

import { Blueprint, PRESET_BY_KEY, presetBlueprint, validateBlueprint } from "@shapewise/blueprint";
import { WorkspaceIdTaken, createTenant, workspaceIdProblem } from "@shapewise/db";
import { adminAuth, adminDb } from "@/lib/auth/admin";
import { withMembership } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";

export interface CreateResult {
  ok: boolean;
  id?: string;
  message?: string;
  field?: "name" | "id" | "preset";
}

/**
 * Creates a workspace from an industry preset and makes the signed-in person
 * its owner. The AI interview replaces the preset choice in onboarding.
 */
export async function createWorkspace(input: { name: string; id: string; preset: string }): Promise<CreateResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Please sign in first." };

  const name = String(input.name ?? "").trim();
  const id = String(input.id ?? "").trim().toLowerCase();
  if (name.length < 2 || name.length > 120) return { ok: false, field: "name", message: "Give the business a name of 2 to 120 characters." };
  const problem = workspaceIdProblem(id);
  if (problem) return { ok: false, field: "id", message: problem };
  if (!PRESET_BY_KEY.has(input.preset)) return { ok: false, field: "preset", message: "Choose what kind of business this is." };

  const draft = presetBlueprint(input.preset, { name, currency: "LKR", locale: "en-LK", timezone: "Asia/Colombo" });
  const checked = validateBlueprint(draft);
  if (!checked.ok || !checked.blueprint) {
    console.error("start: preset produced an invalid blueprint", input.preset, checked.issues.slice(0, 3));
    return { ok: false, message: "That setup couldn't be prepared. Please try another kind of business." };
  }
  const bp: Blueprint = checked.blueprint;

  try {
    await createTenant(adminDb(), id, bp, { uid: session.uid, email: session.email, name: session.name });
  } catch (e) {
    if (e instanceof WorkspaceIdTaken) return { ok: false, field: "id", message: e.message };
    throw e;
  }

  // Claims let Firestore security rules recognise the member; the server reads membership from Firestore.
  try {
    const user = await adminAuth().getUser(session.uid);
    await adminAuth().setCustomUserClaims(session.uid, withMembership(user.customClaims, id, bp.roles.find((r) => r.owner)!.key));
  } catch (e) {
    console.warn("start: couldn't update sign-in claims; membership still recorded", e instanceof Error ? e.message : e);
  }
  return { ok: true, id };
}
