import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { Blueprint, navigation } from "@shapewise/blueprint";
import { bakery, plasticsFactory } from "@shapewise/blueprint/fixtures";
import { FirestoreStore, loadBlueprint, memberRole } from "@shapewise/db";
import { MemoryStore, compile, createExecutor, type Actor, type Command, type CommandResult, type Compiled, type Store } from "@shapewise/runtime";
import { seedDemoRecords } from "@shapewise/runtime/reports";
import { adminDb } from "./auth/admin";
import { getSession } from "./auth/session";
import { PUBLIC_TENANTS, roleIn } from "./auth/policy";
import { settingsData } from "./settings-data";

const DEMOS = { demo: plasticsFactory, bakery } as const;

/**
 * Demo workspaces live in memory (open to anyone, reset when the server
 * restarts, never touching the database). Real workspaces live in Firestore.
 */
const g = globalThis as typeof globalThis & { __swStore?: MemoryStore; __swBlueprints?: Map<string, Blueprint>; __swFirestore?: FirestoreStore; __swDemoData?: Map<string, Promise<unknown>> };
const memoryStore = (g.__swStore ??= new MemoryStore());
const demoBlueprints = (g.__swBlueprints ??= new Map<string, Blueprint>());
const demoData = (g.__swDemoData ??= new Map());
const firestoreStore = () => (g.__swFirestore ??= new FirestoreStore(adminDb()));

export const isDemo = (tenant: string) => tenant in DEMOS;

/** A demo starts with a few months of sample trading, written once per server start. */
function withDemoData(tenant: string, compiled: Compiled) {
  let p = demoData.get(tenant);
  if (!p) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: compiled.bp.business.timezone }).format(new Date());
    demoData.set(tenant, (p = seedDemoRecords(memoryStore, tenant, compiled, today).catch((e) => console.error("demo: sample data failed", e))));
  }
  return p;
}

/** A changed demo blueprint, kept in memory until restart. */
export function setDemoBlueprint(tenant: string, bp: Blueprint) {
  demoBlueprints.set(tenant, bp);
}

const parsedDemos = new Map<string, Blueprint>();
function demoBlueprint(tenant: keyof typeof DEMOS): Blueprint {
  const changed = demoBlueprints.get(tenant);
  if (changed) return changed;
  let bp = parsedDemos.get(tenant);
  if (!bp) parsedDemos.set(tenant, (bp = Blueprint.parse(DEMOS[tenant])));
  return bp;
}

/**
 * Loads a workspace for the person asking, or sends them to sign in.
 * Membership of real workspaces is read from tenants/{tid}/members, so it
 * takes effect at once (sign-in token claims can lag behind).
 */
export const loadWorkspace = cache(async (tenant: string) => {
  const session = await getSessionSafe();
  const next = encodeURIComponent(`/w/${tenant}`);

  let bp: Blueprint;
  let role: string | null;
  let store: Store;
  if (isDemo(tenant)) {
    bp = demoBlueprint(tenant as keyof typeof DEMOS);
    role = roleIn(session, tenant);
    store = memoryStore;
  } else {
    if (!session) redirect(`/sign-in?next=${next}` as never);
    const db = adminDb();
    const loaded = await loadBlueprint(db, tenant).catch(() => null);
    if (!loaded) notFound();
    role = await memberRole(db, tenant, session.uid);
    if (!role) redirect(`/sign-in?next=${next}&reason=not_member` as never);
    bp = loaded.bp;
    store = firestoreStore();
  }

  const compiled = compile(bp);
  if (isDemo(tenant)) await withDemoData(tenant, compiled);
  // Visitors to the public demos act as the owner, so every screen can be tried.
  const roleKey = role ?? bp.roles.find((r) => r.owner)!.key;
  const actor: Actor = session
    ? { kind: "user", id: session.uid, roleKey, channel: "web", displayName: session.name ?? session.email }
    : { kind: "user", id: "visitor", roleKey, channel: "web", displayName: "Demo visitor" };
  return {
    tenant,
    demo: isDemo(tenant),
    bp,
    compiled,
    actor,
    store,
    // Only what this role may open: every page finds itself through these, so this also guards direct links.
    sections: viewable(navigation(bp), compiled, roleKey),
    base: `/w/${tenant}`,
    viewer: session ? { name: `${session.name ?? session.email ?? "Signed in"}${session.test ? " (test)" : ""}`, role } : null,
  };
});

export type Workspace = Awaited<ReturnType<typeof loadWorkspace>>;

/** What every page hands the workspace frame. */
export function shellProps(ws: Workspace) {
  return { base: ws.base, workspaceName: ws.bp.business.name, viewer: ws.viewer, sections: ws.sections.filter((s) => s.key !== "admin"), settings: settingsData(ws) };
}

/** Run a command as the person using this workspace. The only way the web app writes records. */
export async function executeIn(ws: Workspace, command: Command): Promise<CommandResult> {
  const execute = createExecutor({ store: ws.store, blueprint: async () => ws.compiled });
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

export { PUBLIC_TENANTS };

/** Navigation limited to the screens a role can view; modules and sections left empty disappear. */
function viewable(sections: ReturnType<typeof navigation>, compiled: ReturnType<typeof compile>, roleKey: string) {
  const keyOf = (s: { key: string; entity?: string }) => (s.entity ? (compiled.bp.entities.find((e) => e.id === s.entity)?.key ?? s.key) : s.key);
  return sections
    .map((sec) => ({ ...sec, modules: sec.modules.map((m) => ({ ...m, submodules: m.submodules.filter((s) => compiled.can(roleKey, keyOf(s), "view")) })).filter((m) => m.submodules.length) }))
    .filter((sec) => sec.modules.length);
}
