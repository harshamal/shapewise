import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/auth/admin";
import { sessionResponse } from "@/lib/auth/issue-session";
import { RECENT_SIGN_IN_SECONDS, SESSION_COOKIE, sameOrigin } from "@/lib/auth/policy";

/**
 * Exchanges a fresh Firebase ID token for an httpOnly session cookie, so
 * server components can trust who is signed in without client JavaScript.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let idToken: unknown;
  try {
    ({ idToken } = await req.json());
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  if (typeof idToken !== "string" || idToken.length > 4096) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  try {
    const decoded = await adminAuth().verifyIdToken(idToken, true);
    // Only a recent sign-in may mint a long-lived session.
    if (Date.now() / 1000 - decoded.auth_time > RECENT_SIGN_IN_SECONDS) {
      return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    }
    return await sessionResponse(idToken);
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code.startsWith("auth/")) {
      // Never log the token; the code and message say why it was refused.
      console.warn(`session: token refused (${code}): ${(e as Error).message}`);
      return NextResponse.json({ error: "Sign-in could not be verified" }, { status: 401 });
    }
    console.error("session: could not create session cookie", e);
    return NextResponse.json({ error: "Sign-in is not available right now" }, { status: 503 });
  }
}

/** Signs out: clears the cookie and revokes refresh tokens on every device. */
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  if (cookie) {
    try {
      const { sub } = await adminAuth().verifySessionCookie(cookie);
      await adminAuth().revokeRefreshTokens(sub);
    } catch {
      // Already invalid; clearing the cookie is enough.
    }
  }
  return res;
}
