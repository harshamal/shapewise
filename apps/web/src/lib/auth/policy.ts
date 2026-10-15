/**
 * Pure auth rules, shared by the session route, the sign-in page and
 * workspace loading. No SDKs here, so it is unit tested directly.
 */

/** Firebase App Hosting (like Hosting) only forwards a cookie named __session. */
export const SESSION_COOKIE = "__session";
export const SESSION_DAYS = 5;
/** A session can only be created from a sign-in this recent. */
export const RECENT_SIGN_IN_SECONDS = 5 * 60;

/** Workspaces anyone can open without signing in (judges, demo). */
export const PUBLIC_TENANTS: ReadonlySet<string> = new Set(["demo", "bakery"]);

/** Tenant memberships carried in the ID token: { "<tid>": "<roleKey>" }. */
export type TenantClaims = Readonly<Record<string, string>>;

/** Firebase custom claims are limited to 1000 bytes; keep well under it. */
export const MAX_CLAIMS_BYTES = 900;

export class ClaimsTooLarge extends Error {
  constructor() {
    super("This account belongs to too many workspaces to fit in its sign-in token.");
    this.name = "ClaimsTooLarge";
  }
}

const TENANT_ID = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const ROLE_KEY = /^[a-z][a-z0-9_]{0,47}$/;

/** Add, change or (role = null) remove a tenant membership in the custom claims. */
export function withMembership(existing: Record<string, unknown> | undefined, tid: string, role: string | null): Record<string, unknown> {
  if (!TENANT_ID.test(tid)) throw new Error(`Invalid workspace id "${tid}".`);
  if (role !== null && !ROLE_KEY.test(role)) throw new Error(`Invalid role "${role}".`);
  const tenants = { ...((existing?.tenants as Record<string, string> | undefined) ?? {}) };
  if (role === null) delete tenants[tid];
  else tenants[tid] = role;
  const next = { ...existing, tenants };
  if (JSON.stringify(next).length > MAX_CLAIMS_BYTES) throw new ClaimsTooLarge();
  return next;
}

/** Role in a workspace, or null if the person isn't a member. */
export function roleIn(claims: { tenants?: unknown } | null | undefined, tid: string): string | null {
  const tenants = claims?.tenants;
  if (!tenants || typeof tenants !== "object") return null;
  const role = (tenants as Record<string, unknown>)[tid];
  return typeof role === "string" ? role : null;
}

export type Access = { ok: true; role: string | null } | { ok: false; reason: "sign_in" | "not_member" };

/** Who may open a workspace. Public demos are open to everyone, read as a guest. */
export function workspaceAccess(tid: string, session: { tenants?: unknown } | null): Access {
  if (session) {
    const role = roleIn(session, tid);
    if (role) return { ok: true, role };
  }
  if (PUBLIC_TENANTS.has(tid)) return { ok: true, role: null };
  return session ? { ok: false, reason: "not_member" } : { ok: false, reason: "sign_in" };
}

/** Only same-site paths are allowed after sign-in, never another origin. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return fallback;
  return next;
}

/**
 * CSRF guard for cookie-setting routes: the request must come from this site.
 * Browsers always send Origin on POST/DELETE fetches.
 */
export function sameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
