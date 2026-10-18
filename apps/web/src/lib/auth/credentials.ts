import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { adminAuth, adminDb } from "./admin";

/**
 * Credentials authentication: sign up and sign in with a username/email and password.
 * Passwords are checked against a salted scrypt hash in Firestore (`credentials/{uid}`).
 *
 * Each user is an authentic Firebase user, signed in through a custom token
 * that the server exchanges for a Firebase ID token. This ensures all workspaces,
 * security rules, Firestore claims, and session cookies work identically
 * whether the person uses Google or username/password.
 */

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function hashPassword(password: string, salt = randomBytes(16)): Promise<string> {
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function matchesPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Per-identifier throttle: 10 failures locks out guessing for 10 minutes. */
const failures = new Map<string, { n: number; until: number }>();
function guardThrottle(identifier: string) {
  const f = failures.get(identifier);
  if (f && f.until > Date.now()) {
    throw new AuthError("Too many unsuccessful attempts. Please wait a few minutes and try again.", 429);
  }
}
function registerFailure(identifier: string): never {
  const f = failures.get(identifier) ?? { n: 0, until: 0 };
  f.n++;
  if (f.n >= 10) {
    f.until = Date.now() + 10 * 60_000;
    f.n = 0;
  }
  failures.set(identifier, f);
  throw new AuthError("Incorrect username, email, or password.", 401);
}

import { normaliseEmail, normaliseUsername } from "./policy";
export { normaliseEmail, normaliseUsername };

const sha = (str: string) => createHash("sha256").update(str).digest("hex");
const docId = (str: string) => sha(str).slice(0, 40);

export interface SignUpParams {
  /** Optional: made from the email when left out, so signing up needs only an email and password. */
  username?: string;
  email: string;
  password: string;
  name?: string;
}

export interface SignInParams {
  identifier: string; // username or email
  password: string;
}

/** Exchanges a custom token for a genuine Firebase ID token. */
export async function idTokenFor(uid: string): Promise<string> {
  const custom = await adminAuth().createCustomToken(uid);
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new AuthError("Sign-in is not available right now. Please try again shortly.", 503);

  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });

  const body = (await r.json().catch(() => ({}))) as { idToken?: string; error?: { message?: string } };
  if (!r.ok || !body.idToken) {
    console.warn("auth: custom token exchange failed", body.error?.message);
    throw new AuthError("Sign-in is not available right now.", 503);
  }
  return body.idToken;
}

/** A readable name from an email until the person sets one: "kamal.perera@x.lk" becomes "Kamal Perera". */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.split(/[._-]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") || local;
}

/** An unused username made from the email, with a few digits added if it's taken. */
async function freeUsername(email: string): Promise<string> {
  const base = (normaliseUsername(email.split("@")[0] ?? "").replace(/[^a-z0-9._-]/g, "").slice(0, 24) || "user").padEnd(2, "0");
  const db = adminDb();
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}${Math.floor(100 + Math.random() * 9900)}`;
    if (!(await db.collection("credentialIndex").doc(`user_${candidate}`).get()).exists) return candidate;
  }
  return `${base}${Date.now().toString(36).slice(-6)}`;
}

/**
 * Register a new user with an email and password (a username is optional).
 */
export async function signUpCredentials({ username, email, password, name }: SignUpParams): Promise<{ uid: string; stamp: string }> {
  const cleanEmail = normaliseEmail(email);
  const displayName = name?.trim() || nameFromEmail(cleanEmail);

  // Validate email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new AuthError("Please provide a valid email address.");
  }

  // Validate password
  if (password.length < 8) {
    throw new AuthError("Password must be at least 8 characters long.");
  }

  const db = adminDb();
  const emailIndexRef = db.collection("credentialIndex").doc(`email_${docId(cleanEmail)}`);
  // The email checks run together (each is a round trip); the username is only worked out for a new account.
  const [emailIndexSnap, legacyTestSnap] = await Promise.all([emailIndexRef.get(), db.collection("testAccounts").doc(docId(cleanEmail)).get()]);
  if (legacyTestSnap.exists) {
    throw new AuthError("An account with this email already exists. Please sign in instead.");
  }
  if (emailIndexSnap.exists) {
    const existing = String(emailIndexSnap.data()?.uid ?? "");
    const confirmed = await adminAuth()
      .getUser(existing)
      .then((u) => u.emailVerified)
      .catch(() => true);
    if (confirmed) throw new AuthError("An account with this email already exists. Please sign in instead.");
    // Never confirmed, so nobody has shown they own the address: the new password replaces the pending one,
    // and the new stamp makes links sent for the old password stop working.
    const stamp = randomBytes(9).toString("base64url");
    await db.collection("credentials").doc(existing).update({ password: await hashPassword(password), confirmStamp: stamp, updatedAt: new Date().toISOString() });
    return { uid: existing, stamp };
  }

  // A username they chose is checked; one made from the email is already known to be free.
  const cleanUsername = username?.trim() ? normaliseUsername(username) : await freeUsername(cleanEmail);
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(cleanUsername)) {
    throw new AuthError("Username must be between 2 and 32 characters and only contain letters, numbers, dots, hyphens, or underscores.");
  }
  const userIndexRef = db.collection("credentialIndex").doc(`user_${cleanUsername}`);
  if (username?.trim() && (await userIndexRef.get()).exists) {
    throw new AuthError(`The username "${cleanUsername}" is already taken. Please choose another.`);
  }

  const uid = `usr_${sha(`uid:${cleanEmail}`).slice(0, 24)}`;

  // Provision real Firebase user
  try {
    await adminAuth().createUser({ uid, displayName, email: cleanEmail });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      throw new AuthError("This email already has an account through Google. Use Continue with Google to sign in.");
    }
    if (code !== "auth/uid-already-exists") {
      console.error("signUpCredentials: createUser error", e);
      throw new AuthError("Could not create user account. Please try again.");
    }
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  // Ties confirmation links to this password: changing it (signing up again) makes old links stop working.
  const stamp = randomBytes(9).toString("base64url");

  // Write credential and index documents atomically in a batch
  const batch = db.batch();
  const credRef = db.collection("credentials").doc(uid);
  batch.set(credRef, {
    uid,
    username: cleanUsername,
    email: cleanEmail,
    name: displayName,
    password: passwordHash,
    confirmStamp: stamp,
    createdAt: now,
  });
  batch.set(userIndexRef, { uid, username: cleanUsername, email: cleanEmail });
  batch.set(emailIndexRef, { uid, username: cleanUsername, email: cleanEmail });
  await batch.commit();
  return { uid, stamp };
}

/**
 * Sign in with either a username or an email address, plus password.
 */
export async function signInCredentials({ identifier, password }: SignInParams): Promise<{ uid: string; idToken: string; confirmed: boolean }> {
  const cleanId = identifier.trim().toLowerCase();
  guardThrottle(cleanId);

  const db = adminDb();
  let uid: string | null = null;
  let storedPasswordHash: string | null = null;
  let confirmedFlag = false;

  // Every lookup that doesn't depend on another runs at once: each one is a round trip to the database.
  // An email's account id is derived from the email, so its password record can be read alongside the index.
  const guess = cleanId.includes("@") ? `usr_${sha(`uid:${cleanId}`).slice(0, 24)}` : null;
  const [indexSnap, testSnap, guessSnap] = await Promise.all([
    db.collection("credentialIndex").doc(cleanId.includes("@") ? `email_${docId(cleanId)}` : `user_${cleanId}`).get(),
    db.collection("testAccounts").doc(docId(cleanId)).get(),
    guess ? db.collection("credentials").doc(guess).get() : Promise.resolve(null),
  ]);
  uid = (indexSnap.exists && indexSnap.data()?.uid) || null;

  if (uid) {
    const credSnap = guessSnap && uid === guess ? guessSnap : await db.collection("credentials").doc(uid).get();
    if (credSnap.exists) {
      storedPasswordHash = credSnap.data()?.password ?? null;
      confirmedFlag = credSnap.data()?.confirmed === true;
    }
  }

  // Legacy test accounts, by exact email, or (only while test login is on) by a short name like "claude".
  if (!storedPasswordHash) {
    if (testSnap.exists) {
      const data = testSnap.data() as { uid: string; password: string };
      uid = data.uid;
      storedPasswordHash = data.password;
    } else if (process.env.SW_TEST_LOGIN === "1") {
      // Check if identifier matches test accounts by username prefix (e.g. "claude", "sales", "sandy")
      const allTest = await db.collection("testAccounts").limit(20).get();
      for (const doc of allTest.docs) {
        const d = doc.data() as { uid: string; password: string; email: string; name?: string };
        const userPart = d.email.split("@")[0]?.toLowerCase();
        const firstPart = userPart?.split(".")[0];
        if (userPart === cleanId || firstPart === cleanId || d.name?.toLowerCase() === cleanId) {
          uid = d.uid;
          storedPasswordHash = d.password;
          break;
        }
      }
    }
  }

  // If still not found or password doesn't match
  if (!uid || !storedPasswordHash || !(await matchesPassword(password, storedPasswordHash))) {
    registerFailure(cleanId);
  }

  failures.delete(cleanId);
  // Test accounts and accounts marked confirmed skip the extra check; others ask Firebase, alongside the token exchange.
  const [idToken, confirmed] = await Promise.all([
    idTokenFor(uid),
    confirmedFlag || uid.startsWith("test_")
      ? Promise.resolve(true)
      : adminAuth()
          .getUser(uid)
          .then((u) => u.emailVerified)
          .catch(() => false),
  ]);
  return { uid, idToken, confirmed };
}
