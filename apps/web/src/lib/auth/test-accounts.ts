import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { adminAuth, adminDb } from "./admin";

/**
 * Test accounts: sign up and sign in with an email and password, for
 * trying the whole system without Google accounts. Only on when
 * SW_TEST_LOGIN=1.
 *
 * The password never leaves this server: it is checked against a salted
 * scrypt hash in Firestore (testAccounts/{email}). A test account is a real
 * Firebase user (uid "test_..."), signed in through a custom token the
 * server exchanges for an ID token, so sessions, workspaces, roles and
 * security rules work exactly as they do for Google sign-in.
 */

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const testLoginEnabled = () => process.env.SW_TEST_LOGIN === "1";

const COLLECTION = "testAccounts";
const docId = (email: string) => createHash("sha256").update(email).digest("hex").slice(0, 40);
export const testUid = (email: string) => `test_${createHash("sha256").update(`uid:${email}`).digest("hex").slice(0, 24)}`;

export class TestAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function hash(password: string, salt = randomBytes(16)): Promise<string> {
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function matches(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Simple per-email throttle against guessing: 10 failures lock the account for 10 minutes. */
const failures = new Map<string, { n: number; until: number }>();
function guard(email: string) {
  const f = failures.get(email);
  if (f && f.until > Date.now()) throw new TestAuthError("Too many tries. Wait a few minutes and try again.", 429);
}
function fail(email: string): never {
  const f = failures.get(email) ?? { n: 0, until: 0 };
  f.n++;
  if (f.n >= 10) (f.until = Date.now() + 10 * 60_000), (f.n = 0);
  failures.set(email, f);
  throw new TestAuthError("That email and password don't match.", 401);
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function signUpTest(emailIn: string, password: string, name: string): Promise<string> {
  const email = normaliseEmail(emailIn);
  const ref = adminDb().collection(COLLECTION).doc(docId(email));
  if ((await ref.get()).exists) throw new TestAuthError("There's already a test account with that email. Sign in instead.", 409);
  const uid = testUid(email);
  try {
    await adminAuth().createUser({ uid, displayName: name, email });
  } catch (e) {
    const code = (e as { code?: string }).code;
    // The email belongs to a Google account: keep the test user separate, without the email on it.
    if (code === "auth/email-already-exists") await adminAuth().createUser({ uid, displayName: name });
    else if (code !== "auth/uid-already-exists") throw e;
  }
  await ref.set({ email, uid, name, password: await hash(password), createdAt: new Date().toISOString() });
  return uid;
}

export async function signInTest(emailIn: string, password: string): Promise<string> {
  const email = normaliseEmail(emailIn);
  guard(email);
  const snap = await adminDb().collection(COLLECTION).doc(docId(email)).get();
  if (!snap.exists) fail(email);
  const data = snap.data() as { uid: string; password: string };
  if (!(await matches(password, data.password))) fail(email);
  failures.delete(email);
  return data.uid;
}

/** A fresh ID token for a test user, via a custom token; the password is not part of it. */
export async function idTokenFor(uid: string): Promise<string> {
  const custom = await adminAuth().createCustomToken(uid, { test: true });
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new TestAuthError("Sign-in is not available right now.", 503);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const body = (await r.json().catch(() => ({}))) as { idToken?: string; error?: { message?: string } };
  if (!r.ok || !body.idToken) {
    console.warn("test-auth: custom token exchange failed", body.error?.message);
    throw new TestAuthError("Sign-in is not available right now.", 503);
  }
  return body.idToken;
}

/**
 * The quick-fill test accounts for the sign-in page, read from .env.local
 * (TEST_ACCOUNT_*, TEST_SALES_*, TEST_STORES_*). Only when test login is on,
 * so their passwords never reach a normal visitor's browser.
 */
export function quickTestAccounts(): { label: string; identifier: string; password: string }[] {
  if (!testLoginEnabled()) return [];
  const pick = (label: string, prefix: string) => {
    const identifier = process.env[`${prefix}_EMAIL`];
    const password = process.env[`${prefix}_PASSWORD`];
    return identifier && password ? [{ label, identifier, password }] : [];
  };
  return [...pick("Owner", "TEST_ACCOUNT"), ...pick("Sales", "TEST_SALES"), ...pick("Stores", "TEST_STORES")];
}
