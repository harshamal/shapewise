import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "./admin";
import { SESSION_COOKIE, withMembership, type TenantClaims } from "./policy";

export interface Session {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  tenants: TenantClaims;
  /** Signed in with a test account (SW_TEST_LOGIN), not Google. */
  test?: boolean;
}

/**
 * The signed-in person for this request, or null. Verifies the session cookie
 * (including revocation) once per request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const t = await adminAuth().verifySessionCookie(cookie, true);
    return {
      uid: t.uid,
      email: t.email,
      name: typeof t.name === "string" ? t.name : undefined,
      picture: typeof t.picture === "string" ? t.picture : undefined,
      tenants: (t.tenants as TenantClaims | undefined) ?? {},
      test: t.test === true || undefined,
    };
  } catch {
    // Expired, revoked or tampered: treat as signed out.
    return null;
  }
});

/**
 * Grant, change or remove someone's role in a workspace. Updates the custom
 * claims (what security rules and the server read) and the members document
 * (what the UI lists) together. Takes effect at the person's next token refresh.
 */
export async function setMembership(uid: string, tid: string, roleKey: string | null): Promise<void> {
  const auth = adminAuth();
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, withMembership(user.customClaims, tid, roleKey));
  const ref = adminDb().doc(`tenants/${tid}/members/${uid}`);
  if (roleKey === null) await ref.delete();
  else await ref.set({ roleKey, email: user.email ?? null, name: user.displayName ?? null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
