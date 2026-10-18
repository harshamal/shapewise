import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sessionResponse } from "@/lib/auth/issue-session";
import { sameOrigin } from "@/lib/auth/policy";
import { AuthError, signInCredentials, signUpCredentials } from "@/lib/auth/credentials";

export const runtime = "nodejs";

const AuthInput = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("signin"),
    identifier: z.string().trim().min(1, "Please enter your username or email.").max(200),
    password: z.string().min(1, "Please enter your password.").max(200),
  }),
  z.object({
    mode: z.literal("signup"),
    username: z
      .string()
      .trim()
      .min(2, "Username must be at least 2 characters.")
      .max(32, "Username cannot exceed 32 characters.")
      .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, dots, hyphens, and underscores."),
    email: z.string().trim().email("Please provide a valid email address.").max(200),
    name: z.string().trim().max(80).optional(),
    password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  }),
]);

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
    const firstIssue = parsed.error.issues[0];
    const message = firstIssue?.message ?? "Invalid input parameters.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const data = parsed.data;
    if (data.mode === "signup") {
      const { idToken } = await signUpCredentials({
        username: data.username,
        email: data.email,
        name: data.name,
        password: data.password,
      });
      return await sessionResponse(idToken);
    } else {
      const { idToken } = await signInCredentials({
        identifier: data.identifier,
        password: data.password,
      });
      return await sessionResponse(idToken);
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("api/auth/credentials error:", err);
    return NextResponse.json({ error: "Authentication is temporarily unavailable. Please try again." }, { status: 500 });
  }
}
