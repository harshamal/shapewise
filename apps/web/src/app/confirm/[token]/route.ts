import { NextResponse, type NextRequest } from "next/server";
import { markConfirmed, readConfirmation, uidConfirmed } from "@/lib/auth/confirm";
import { idTokenFor } from "@/lib/auth/credentials";
import { withSession } from "@/lib/auth/issue-session";

export const runtime = "nodejs";

/**
 * Where the confirmation email's link lands: confirms the address, signs the
 * person in, and starts their setup. Once used it only confirms, so an old
 * email can't be used to sign in later.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const who = await readConfirmation(token);
  const go = (path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin));
  if (!who) return go("/sign-in?reason=link_expired");
  if (await uidConfirmed(who.uid)) return go("/sign-in?reason=already_confirmed");
  await markConfirmed(who.uid);
  return withSession(go("/start"), await idTokenFor(who.uid));
}
