import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Share links for documents: the link itself is the permission, signed so it
 * can't be altered to open another record, and expiring after 30 days.
 */

export interface ShareClaim {
  tenant: string;
  target: string;
  id: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

const DAYS = 30;

function secret(): string {
  const s = process.env.SW_SHARE_SECRET;
  if (s && s.length >= 16) return s;
  // Local dev without the secret: derive one from the service account, never a constant.
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (sa) return createHmac("sha256", "sw-share").update(sa).digest("base64url");
  throw new Error("Shared links aren't set up: SW_SHARE_SECRET is missing.");
}

const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url").slice(0, 32);

export function shareToken(tenant: string, target: string, id: string, now = Date.now()): string {
  const claim: ShareClaim = { tenant, target, id, exp: Math.floor(now / 1000) + DAYS * 86400 };
  const body = Buffer.from(JSON.stringify([claim.tenant, claim.target, claim.id, claim.exp])).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The claim in a token, or null when it was altered or has expired. */
export function readShareToken(token: string, now = Date.now()): ShareClaim | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || body.length > 600) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const [tenant, target, id, exp] = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as [string, string, string, number];
    if (typeof exp !== "number" || exp * 1000 < now) return null;
    return { tenant, target, id, exp };
  } catch {
    return null;
  }
}
