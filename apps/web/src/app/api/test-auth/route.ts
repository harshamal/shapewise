import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sessionResponse } from "@/lib/auth/issue-session";
import { sameOrigin } from "@/lib/auth/policy";
import { TestAuthError, idTokenFor, signInTest, signUpTest, testLoginEnabled } from "@/lib/auth/test-accounts";

export const runtime = "nodejs";

const Input = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("signin"), email: z.email().max(200), password: z.string().min(1).max(200) }),
  z.object({ mode: z.literal("signup"), email: z.email().max(200), password: z.string().min(8).max(200), name: z.string().trim().min(2).max(80) }),
]);

/** Test account sign-up and sign-in (SW_TEST_LOGIN=1 only). Answers with the same session cookie as Google sign-in. */
export async function POST(req: NextRequest) {
  if (!testLoginEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const signup = (parsed.error.issues[0]?.path[0] as string | undefined) === "password";
    return NextResponse.json({ error: signup ? "Use a password of at least 8 characters." : "Enter a valid email, a password, and for a new account your name." }, { status: 400 });
  }
  try {
    const d = parsed.data;
    const uid = d.mode === "signup" ? await signUpTest(d.email, d.password, d.name) : await signInTest(d.email, d.password);
    return await sessionResponse(await idTokenFor(uid));
  } catch (e) {
    if (e instanceof TestAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("test-auth: failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Sign-in is not available right now." }, { status: 503 });
  }
}
