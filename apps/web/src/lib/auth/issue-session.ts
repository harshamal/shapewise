import "server-only";
import { NextResponse } from "next/server";
import { adminAuth } from "./admin";
import { SESSION_COOKIE, SESSION_DAYS } from "./policy";

/** Puts the httpOnly session cookie the server trusts, made from a fresh Firebase ID token, on a response. */
export async function withSession<T extends NextResponse>(res: T, idToken: string): Promise<T> {
  const expiresIn = SESSION_DAYS * 24 * 60 * 60 * 1000;
  const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn });
  res.cookies.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: expiresIn / 1000,
  });
  return res;
}

/** Turns a fresh Firebase ID token into the session cookie, as a JSON response. */
export async function sessionResponse(idToken: string): Promise<NextResponse> {
  return withSession(NextResponse.json({ ok: true }), idToken);
}
