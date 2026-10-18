"use server";

import { TeamError, acceptInvite } from "@shapewise/db";
import { adminAuth, adminDb } from "@/lib/auth/admin";
import { withMembership } from "@/lib/auth/policy";
import { getSession } from "@/lib/auth/session";

/** Accepts an invitation as the signed-in person and returns where to go. */
export async function acceptJoin(tenant: string, token: string): Promise<{ ok: boolean; message?: string; href?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Please sign in first." };
  try {
    const db = adminDb();
    const name = String((await db.doc(`tenants/${tenant}`).get()).data()?.name ?? tenant);
    const roleKey = await acceptInvite(db, tenant, token, { uid: session.uid, email: session.email, name: session.name }, name);
    try {
      const user = await adminAuth().getUser(session.uid);
      await adminAuth().setCustomUserClaims(session.uid, withMembership(user.customClaims, tenant, roleKey));
    } catch (e) {
      console.warn("join: claims not updated; membership still recorded", e instanceof Error ? e.message : e);
    }
    return { ok: true, href: `/w/${tenant}` };
  } catch (e) {
    if (e instanceof TeamError) return { ok: false, message: e.message };
    console.error("join: failed", e instanceof Error ? e.message : e);
    return { ok: false, message: "Couldn't join just now. Try again." };
  }
}
