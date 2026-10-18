import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/auth/admin";
import { sessionResponse } from "@/lib/auth/issue-session";
import { sameOrigin } from "@/lib/auth/policy";
import { AuthError, signInCredentials, signUpCredentials } from "@/lib/auth/credentials";
import { sendConfirmation, uidConfirmed } from "@/lib/auth/confirm";
import { adminAuth } from "@/lib/auth/admin";

export const runtime = "nodejs";

const AuthInput = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("signin"),
    identifier: z.string().trim().min(1, "Please enter your email.").max(200),
    password: z.string().min(1, "Please enter your password.").max(200),
  }),
  z.object({
    mode: z.literal("signup"),
    username: z
      .string()
      .trim()
      .min(2, "Username must be at least 2 characters.")
      .max(32, "Username cannot exceed 32 characters.")
      .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, dots, hyphens, and underscores.")
      .optional(),
    email: z.string().trim().email("Please provide a valid email address.").max(200),
    name: z.string().trim().max(80).optional(),
    password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  }),
  z.object({ mode: z.literal("resend"), email: z.string().trim().email("Please provide a valid email address.").max(200) }),
]);

/**
 * Password accounts. Signing up creates the account and emails a
 * confirmation link; nobody is signed in until that link is opened. Signing
 * in refuses accounts whose email isn't confirmed yet.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = AuthInput.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid input parameters.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const origin = req.nextUrl.origin;
  try {
    const data = parsed.data;
    if (data.mode === "signup") {
      const { uid, stamp } = await signUpCredentials({ username: data.username, email: data.email, name: data.name, password: data.password });
      const sent = await sendConfirmation(uid, data.email.trim().toLowerCase(), origin, stamp);
      return NextResponse.json({ ok: true, confirm: true, email: data.email.trim().toLowerCase(), sent: sent.ok, message: sent.message });
    }
    if (data.mode === "resend") {
      // Same answer whether or not the account exists, so this can't be used to find out who has one.
      const email = data.email.toLowerCase();
      const ix = await adminDb().collection("credentialIndex").doc(`email_${createHash("sha256").update(email).digest("hex").slice(0, 40)}`).get();
      const uid = ix.data()?.uid as string | undefined;
      if (uid && !(await uidConfirmed(uid))) {
        const r = await sendConfirmation(uid, email, origin);
        if (!r.ok) return NextResponse.json({ error: r.message }, { status: 429 });
      }
      return NextResponse.json({ ok: true, message: `If ${email} has an account waiting for confirmation, a new link is on its way.` });
    }
    const { uid, idToken, confirmed } = await signInCredentials({ identifier: data.identifier, password: data.password });
    if (!confirmed) {
      const email = (await adminAuth().getUser(uid)).email;
      return NextResponse.json({ error: `Confirm your email first. Open the link we sent to ${email ?? "your inbox"}.`, unconfirmed: true, email }, { status: 403 });
    }
    return await sessionResponse(idToken);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("api/auth/credentials error:", err);
    return NextResponse.json({ error: "Sign-in is temporarily unavailable. Please try again." }, { status: 500 });
  }
}
