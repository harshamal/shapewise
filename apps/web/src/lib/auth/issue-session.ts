import "server-only";
import { NextResponse } from "next/server";
import { adminAuth } from "./admin";
import { SESSION_COOKIE, SESSION_DAYS } from "./policy";

/** Turns a fresh Firebase ID token into the httpOnly session cookie the server trusts. */
export async function sessionResponse(idToken: string): Promise<NextResponse> {
  const expiresIn = SESSION_DAYS * 24 * 60 * 60 * 1000;
  const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: expiresIn / 1000,
  });
  return res;
}
