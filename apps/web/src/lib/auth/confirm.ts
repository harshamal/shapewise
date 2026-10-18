import "server-only";
import { cache } from "react";
import { readSignedToken, signedToken } from "../documents/share";
import { sendEmail, simpleHtml } from "../email";
import { adminAuth, adminDb } from "./admin";
import type { Session } from "./session";

/**
 * Email confirmation for password accounts. A new account can't sign in
 * until its owner opens the link we email them (through Resend); opening it
 * confirms the address and signs them in. Google has already confirmed its
 * users' addresses, and test accounts use made-up ones, so both are exempt.
 */

const PURPOSE = "confirm-email";
const HOURS = 48;

/** Whether this person's email is confirmed, read live from their account. */
export const emailConfirmed = cache(async (session: Session): Promise<boolean> => {
  if (session.test || session.uid.startsWith("test_")) return true;
  if (!session.email) return false;
  return uidConfirmed(session.uid);
});

export async function uidConfirmed(uid: string): Promise<boolean> {
  if (uid.startsWith("test_")) return true;
  try {
    return (await adminAuth().getUser(uid)).emailVerified;
  } catch {
    return false;
  }
}

/** What a gated action says when the email isn't confirmed yet. */
export const confirmFirst = (email?: string) => `Confirm your email first: open the link we sent${email ? ` to ${email}` : ""}.`;

const lastSent = new Map<string, number>();

/** The current stamp on a password account; links carry it, so they stop working once the password is replaced. */
async function currentStamp(uid: string): Promise<string> {
  return String((await adminDb().doc(`credentials/${uid}`).get()).data()?.confirmStamp ?? "");
}

/** Emails a confirmation link. At most once a minute per account. */
export async function sendConfirmation(uid: string, email: string, origin: string, stamp?: string): Promise<{ ok: boolean; message: string }> {
  const last = lastSent.get(uid) ?? 0;
  if (Date.now() - last < 60_000) return { ok: false, message: "We just sent one. Give it a minute, and check your spam folder." };
  lastSent.set(uid, Date.now());
  const link = `${origin}/confirm/${signedToken(PURPOSE, [uid, email, stamp ?? (await currentStamp(uid))], HOURS)}`;
  const r = await sendEmail({
    to: email,
    subject: "Confirm your email for Shapewise",
    text: `Welcome to Shapewise.\n\nConfirm your email to finish creating your account:\n${link}\n\nThe link works for ${HOURS} hours. If you didn't sign up, you can ignore this email.`,
    html: simpleHtml({
      heading: "Confirm your email",
      lines: ["Welcome to Shapewise. Confirm this is your email address to finish creating your account and sign in."],
      button: { label: "Confirm my email", href: link },
      footer: `The link works for ${HOURS} hours. If you didn't sign up for Shapewise, you can ignore this email.`,
    }),
  });
  if (!r.ok) {
    lastSent.delete(uid);
    return { ok: false, message: r.message ?? "Couldn't send the email just now. Try again." };
  }
  return { ok: true, message: `We sent a link to ${email}. Open it to finish signing up.` };
}

/** The account a confirmation link is for, if the link is genuine, unexpired and still matches the account. */
export async function readConfirmation(token: string): Promise<{ uid: string; email: string } | null> {
  const parts = readSignedToken(PURPOSE, token);
  if (!parts) return null;
  const [uid, email, stamp] = parts as [string, string, string];
  try {
    const user = await adminAuth().getUser(uid);
    if ((user.email ?? "").toLowerCase() !== email.toLowerCase()) return null;
    if ((await currentStamp(uid)) !== stamp) return null;
    return { uid, email };
  } catch {
    return null;
  }
}

export async function markConfirmed(uid: string): Promise<void> {
  // Firebase holds the truth; the flag on the password record saves a lookup at every sign-in.
  await Promise.all([adminAuth().updateUser(uid, { emailVerified: true }), adminDb().doc(`credentials/${uid}`).set({ confirmed: true }, { merge: true })]);
}
