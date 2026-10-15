import "server-only";
import { notFound, redirect } from "next/navigation";
import { Blueprint, navigation } from "@shapewise/blueprint";
import { bakery, plasticsFactory } from "@shapewise/blueprint/fixtures";
import { getSession } from "./auth/session";
import { workspaceAccess } from "./auth/policy";

const DEMOS = { demo: plasticsFactory, bakery } as const;

/**
 * Loads a workspace for the signed-in person, or sends them to sign in.
 * Demo workspaces are open to everyone. Real workspaces will read the cached
 * blueprint from tenants/{tid}/blueprints/{active}; until then only demos exist.
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
  const bp = Blueprint.parse(demo);
  return {
    bp,
    sections: navigation(bp),
    base: `/w/${tenant}`,
    viewer: session ? { name: session.name ?? session.email ?? "Signed in", role: access.role } : null,
  };
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
