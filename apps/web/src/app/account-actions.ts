"use server";

import { headers } from "next/headers";
import { emailConfirmed, sendConfirmation } from "@/lib/auth/confirm";
import { getSession } from "@/lib/auth/session";

/** Sends the signed-in person a new email confirmation link. */
export async function resendConfirmation(): Promise<{ ok: boolean; message: string }> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Please sign in first." };
  if (await emailConfirmed(session)) return { ok: true, message: "Your email is already confirmed." };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  if (!session.email) return { ok: false, message: "This account has no email address." };
  return sendConfirmation(session.uid, session.email, origin);
}

/** Whether the email is confirmed now, for the banner's "I've confirmed it" check. */
export async function checkConfirmed(): Promise<boolean> {
  const session = await getSession();
  return session ? emailConfirmed(session) : false;
}
