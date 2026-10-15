import "server-only";
import { notFound, redirect } from "next/navigation";
import { Blueprint, navigation } from "@shapewise/blueprint";
import { bakery, plasticsFactory } from "@shapewise/blueprint/fixtures";
import { MemoryStore, compile, createExecutor, type Actor, type Command, type CommandResult } from "@shapewise/runtime";
import { getSession } from "./auth/session";
import { workspaceAccess } from "./auth/policy";
import { settingsData } from "./settings-data";

const DEMOS = { demo: plasticsFactory, bakery } as const;

/**
 * Records live in an in-memory store for now (kept across hot reloads), so
 * everything works end to end before the Firestore store is plugged in.
 * Restarting the server clears it.
 */
const g = globalThis as typeof globalThis & { __swStore?: MemoryStore; __swBlueprints?: Map<string, Blueprint> };
export const store = (g.__swStore ??= new MemoryStore());

/** The live blueprint per workspace once it has been changed in settings; otherwise the demo's own. */
const blueprints = (g.__swBlueprints ??= new Map<string, Blueprint>());
export function setBlueprint(tenant: string, bp: Blueprint) {
  blueprints.set(tenant, bp);
}

/**
 * Loads a workspace for the signed-in person, or sends them to sign in.
 * Demo workspaces are open to everyone; visitors act as the owner there so
 * every screen can be tried. Real workspaces will read the cached blueprint
 * from tenants/{tid}/blueprints/{active}; until then only demos exist.
 */
export async function loadWorkspace(tenant: string) {
  const session = await getSessionSafe();
  const access = workspaceAccess(tenant, session);
  if (!access.ok) {
    const next = encodeURIComponent(`/w/${tenant}`);
    redirect(`/sign-in?next=${next}${access.reason === "not_member" ? "&reason=not_member" : ""}` as never);
  }
  const demo = DEMOS[tenant as keyof typeof DEMOS];
  if (!demo) notFound();
  const bp = blueprints.get(tenant) ?? parsed(tenant, demo);
  const compiled = compile(bp);
  const role = access.role ?? bp.roles.find((r) => r.owner)!.key;
  const actor: Actor = session
    ? { kind: "user", id: session.uid, roleKey: role, channel: "web", displayName: session.name ?? session.email }
    : { kind: "user", id: "visitor", roleKey: role, channel: "web", displayName: "Demo visitor" };
  return {
    tenant,
    bp,
    compiled,
    actor,
    sections: navigation(bp),
    base: `/w/${tenant}`,
    viewer: session ? { name: session.name ?? session.email ?? "Signed in", role: access.role } : null,
  };
}

export type Workspace = Awaited<ReturnType<typeof loadWorkspace>>;

/** Parse each demo once, so the compiled form stays cached across requests. */
const parsedDemos = new Map<string, Blueprint>();
function parsed(tenant: string, input: unknown): Blueprint {
  let bp = parsedDemos.get(tenant);
  if (!bp) parsedDemos.set(tenant, (bp = Blueprint.parse(input)));
  return bp;
}

/** What every page hands the workspace frame. */
export function shellProps(ws: Workspace) {
  return { base: ws.base, workspaceName: ws.bp.business.name, viewer: ws.viewer, sections: ws.sections.filter((s) => s.key !== "admin"), settings: settingsData(ws) };
}

/** Run a command as the person using this workspace. The only way the web app writes. */
export async function executeIn(ws: Workspace, command: Command): Promise<CommandResult> {
  const execute = createExecutor({ store, blueprint: async () => ws.compiled });
  return execute({ id: crypto.randomUUID(), tenantId: ws.tenant, actor: ws.actor, command, issuedAt: new Date().toISOString() });
}

/** Demos must open even when Auth isn't configured (judges, local dev without credentials). */
async function getSessionSafe() {
  try {
    return await getSession();
  } catch (e) {
    console.warn("auth: session check unavailable", e instanceof Error ? e.message : e);
    return null;
  }
}
