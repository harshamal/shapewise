"use server";

import { z } from "zod";
import { BusinessProfile, LlmError, OPENING, createLlm, designBlueprint, interviewTurn, profileReady, type Message } from "@shapewise/ai";
import { Blueprint, PRESET_BY_KEY, presetBlueprint, validateBlueprint } from "@shapewise/blueprint";
import { WorkspaceIdTaken, createTenant, suggestWorkspaceId, workspaceIdProblem } from "@shapewise/db";
import { adminAuth, adminDb } from "@/lib/auth/admin";
import { withMembership } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";
import { summarise, type BlueprintSummary } from "@/lib/blueprint-summary";

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
  return { ok: true, id };
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

/* ------------------------------------------------------------- AI interview */

const ChatMessage = z.union([z.object({ role: z.literal("user"), text: z.string().max(4000) }), z.object({ role: z.literal("assistant"), text: z.string().max(4000) })]);
const InterviewInput = z.object({ history: z.array(ChatMessage).max(60), profile: BusinessProfile, message: z.string().min(1).max(4000) });

export interface InterviewResult {
  ok: boolean;
  history?: Message[];
  profile?: BusinessProfile;
  reply?: string;
  ready?: boolean;
  message?: string;
}

export async function interviewStep(input: unknown): Promise<InterviewResult> {
  if (!(await getSession())) return { ok: false, message: "Please sign in first." };
  const parsed = InterviewInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That message couldn't be sent. Reload and try again." };
  try {
    const llm = createLlm();
    const history = parsed.data.history.length ? parsed.data.history : [{ role: "assistant" as const, text: OPENING }];
    const r = await interviewTurn(llm, { history, profile: parsed.data.profile }, parsed.data.message);
    return { ok: true, history: r.history, profile: r.profile, reply: r.reply, ready: r.ready };
  } catch (e) {
    return { ok: false, message: e instanceof LlmError ? e.message : "Something went wrong talking to the AI. Try again." };
  }
}

/* --------------------------------------------------------------- AI design */

export interface DesignResult {
  ok: boolean;
  message?: string;
  blueprint?: Blueprint;
  summary?: BlueprintSummary;
  suggestedId?: string;
  assumptions?: string[];
  notes?: string[];
  removed?: string[];
}

export async function designSetup(profileInput: unknown): Promise<DesignResult> {
  if (!(await getSession())) return { ok: false, message: "Please sign in first." };
  const parsed = BusinessProfile.safeParse(profileInput);
  if (!parsed.success) return { ok: false, message: "The interview answers couldn't be read. Start again." };
  if (!profileReady(parsed.data)) return { ok: false, message: "Tell me a bit more first: the business name, what you sell, who buys, and whether you make things." };
  try {
    const r = await designBlueprint(createLlm(), parsed.data);
    console.info(`start: designed blueprint (first pass ${r.firstPassValid ? "valid" : "invalid"}, ${r.repairRounds} repairs, ${r.removed.length} removed)`);
    return {
      ok: true,
      blueprint: r.blueprint,
      summary: summarise(r.blueprint),
      suggestedId: suggestWorkspaceId(r.blueprint.business.name),
      assumptions: r.plan.assumptions,
      notes: r.notes,
      removed: r.removed,
    };
  } catch (e) {
    return { ok: false, message: e instanceof LlmError ? e.message : "Something went wrong designing the setup. Try again." };
  }
}

/** Creates the workspace from a designed blueprint (validated again on the server). */
export async function createFromDesign(input: { blueprint: unknown; id: string }): Promise<CreateResult> {
  const parsed = Blueprint.safeParse(input.blueprint);
  if (!parsed.success) return { ok: false, message: "That setup isn't valid. Please design it again." };
  return finishCreate(parsed.data.business.name, String(input.id ?? "").trim().toLowerCase(), parsed.data);
}
