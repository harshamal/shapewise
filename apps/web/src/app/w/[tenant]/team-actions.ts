"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { TeamError, createInvite, listInvites, listMembers, revokeInvite, setMemberRole } from "@shapewise/db";
import { adminAuth, adminDb } from "@/lib/auth/admin";
import { withMembership } from "@/lib/auth/policy";
import { loadWorkspace } from "@/lib/workspace";

/**
 * Team and users: who's in the workspace, invitations, roles. Only roles that
 * may manage Team and users can change anything; everyone with access to the
 * screen can see the list.
 */

export interface TeamView {
  ok: boolean;
  message?: string;
  canManage?: boolean;
  me?: string;
  demo?: boolean;
  members?: { uid: string; name: string; email?: string; roleKey: string }[];
  invites?: { id: string; email: string; roleKey: string; expiresAt: string; invitedByName?: string | null }[];
  roles?: { key: string; label: string; owner: boolean }[];
}

async function context(tenant: string) {
  const ws = await loadWorkspace(tenant);
  const canManage = ws.compiled.can(ws.actor.roleKey, "users", "manage");
  return { ws, canManage, owners: ws.bp.roles.filter((r) => r.owner).map((r) => r.key) };
}

const fail = (e: unknown): { ok: false; message: string } => {
  if (e instanceof TeamError) return { ok: false, message: e.message };
  console.error("team: failed", e instanceof Error ? e.message : e);
  return { ok: false, message: "That didn't work. Try again." };
};

export async function loadTeam(tenant: string): Promise<TeamView> {
  const { ws, canManage } = await context(tenant);
  const roles = ws.bp.roles.map((r) => ({ key: r.key, label: r.label, owner: Boolean(r.owner) }));
  if (ws.demo) return { ok: true, demo: true, roles, members: [], invites: [], canManage: false };
  try {
    const db = adminDb();
    const [members, invites] = await Promise.all([listMembers(db, tenant), canManage ? listInvites(db, tenant) : Promise.resolve([])]);
    return {
      ok: true,
      canManage,
      me: ws.actor.id,
      roles,
      members: members.map((m) => ({ uid: m.uid, name: m.name || m.email || "Someone", email: m.email ?? undefined, roleKey: m.roleKey })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, roleKey: i.roleKey, expiresAt: i.expiresAt, invitedByName: i.invitedByName })),
    };
  } catch (e) {
    return fail(e);
  }
}

const InviteInput = z.object({ email: z.email().max(200), roleKey: z.string().min(1).max(40) });

/** Invites someone by email; returns the join link to share (shown once). */
export async function inviteMember(tenant: string, input: unknown): Promise<{ ok: boolean; message?: string; link?: string; email?: string }> {
  const { ws, canManage } = await context(tenant);
  if (ws.demo) return { ok: false, message: "The demo workspaces can't have members. Create your own workspace to invite people." };
  if (!canManage) return { ok: false, message: "Your role can't invite people." };
  const parsed = InviteInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a valid email and choose a role." };
  if (!ws.bp.roles.some((r) => r.key === parsed.data.roleKey)) return { ok: false, message: "Choose one of this workspace's roles." };
  try {
    const { token } = await createInvite(adminDb(), tenant, { email: parsed.data.email, roleKey: parsed.data.roleKey, invitedBy: ws.actor.id, invitedByName: ws.actor.displayName ?? null });
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    return { ok: true, link: `${origin}/join/${tenant}/${token}`, email: parsed.data.email.trim().toLowerCase() };
  } catch (e) {
    return fail(e);
  }
}

export async function withdrawInvite(tenant: string, id: string): Promise<{ ok: boolean; message?: string }> {
  const { ws, canManage } = await context(tenant);
  if (ws.demo || !canManage) return { ok: false, message: "Your role can't manage invitations." };
  try {
    await revokeInvite(adminDb(), tenant, z.string().regex(/^[a-f0-9]{40}$/).parse(id));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Changes someone's role, or removes them from the workspace (roleKey null). */
export async function changeMember(tenant: string, uid: string, roleKey: string | null): Promise<{ ok: boolean; message?: string }> {
  const { ws, canManage, owners } = await context(tenant);
  if (ws.demo || !canManage) return { ok: false, message: "Your role can't change the team." };
  if (roleKey !== null && !ws.bp.roles.some((r) => r.key === roleKey)) return { ok: false, message: "Choose one of this workspace's roles." };
  try {
    await setMemberRole(adminDb(), tenant, z.string().min(1).max(128).parse(uid), roleKey, owners, ws.bp.business.name);
    // Sign-in claims follow, so security rules see the change at the person's next token refresh.
    try {
      const user = await adminAuth().getUser(uid);
      await adminAuth().setCustomUserClaims(uid, withMembership(user.customClaims, tenant, roleKey));
    } catch (e) {
      console.warn("team: claims not updated", e instanceof Error ? e.message : e);
    }
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
