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
  username: string;
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
  if (!key) throw new AuthError("Firebase is not configured on this server.", 503);

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

/**
 * Register a new user with username, email, and password.
 */
export async function signUpCredentials({ username, email, password, name }: SignUpParams): Promise<{ uid: string; idToken: string }> {
  const cleanUsername = normaliseUsername(username);
  const cleanEmail = normaliseEmail(email);
  const displayName = (name && name.trim().length > 0) ? name.trim() : username.trim();

  // Validate username
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(cleanUsername)) {
    throw new AuthError("Username must be between 2 and 32 characters and only contain letters, numbers, dots, hyphens, or underscores.");
  }

  // Validate email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new AuthError("Please provide a valid email address.");
  }

  // Validate password
  if (password.length < 8) {
    throw new AuthError("Password must be at least 8 characters long.");
  }

  const db = adminDb();

  // Check username uniqueness
  const userIndexRef = db.collection("credentialIndex").doc(`user_${cleanUsername}`);
  const userIndexSnap = await userIndexRef.get();
  if (userIndexSnap.exists) {
    throw new AuthError(`The username "${cleanUsername}" is already taken. Please choose another.`);
  }

  // Check email uniqueness in credential index
  const emailIndexRef = db.collection("credentialIndex").doc(`email_${docId(cleanEmail)}`);
  const emailIndexSnap = await emailIndexRef.get();
  if (emailIndexSnap.exists) {
    throw new AuthError("An account with this email already exists. Please sign in instead.");
  }

  // Check legacy test accounts
  const legacyTestSnap = await db.collection("testAccounts").doc(docId(cleanEmail)).get();
  if (legacyTestSnap.exists) {
    throw new AuthError("An account with this email already exists. Please sign in instead.");
  }

  const uid = `usr_${sha(`uid:${cleanEmail}`).slice(0, 24)}`;

  // Provision real Firebase user
  try {
    await adminAuth().createUser({ uid, displayName, email: cleanEmail });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      throw new AuthError("An account with this email already exists in Firebase. Please sign in instead.");
    }
    if (code !== "auth/uid-already-exists") {
      console.error("signUpCredentials: createUser error", e);
      throw new AuthError("Could not create user account. Please try again.");
    }
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  // Write credential and index documents atomically in a batch
  const batch = db.batch();
  const credRef = db.collection("credentials").doc(uid);
  batch.set(credRef, {
    uid,
    username: cleanUsername,
    email: cleanEmail,
    name: displayName,
    password: passwordHash,
    createdAt: now,
  });
  batch.set(userIndexRef, { uid, username: cleanUsername, email: cleanEmail });
  batch.set(emailIndexRef, { uid, username: cleanUsername, email: cleanEmail });
  await batch.commit();

  const idToken = await idTokenFor(uid);
  return { uid, idToken };
}

/**
 * Sign in with either a username or an email address, plus password.
 */
export async function signInCredentials({ identifier, password }: SignInParams): Promise<{ uid: string; idToken: string }> {
  const cleanId = identifier.trim().toLowerCase();
  guardThrottle(cleanId);

  const db = adminDb();
  let uid: string | null = null;
  let storedPasswordHash: string | null = null;

  // 1. Try resolving identifier as username or email from credentialIndex
  if (cleanId.includes("@")) {
    const emailIndexSnap = await db.collection("credentialIndex").doc(`email_${docId(cleanId)}`).get();
    if (emailIndexSnap.exists) {
      uid = emailIndexSnap.data()?.uid ?? null;
    }
  } else {
    const userIndexSnap = await db.collection("credentialIndex").doc(`user_${cleanId}`).get();
    if (userIndexSnap.exists) {
      uid = userIndexSnap.data()?.uid ?? null;
    }
  }

  // 2. If found in credentials collection
  if (uid) {
    const credSnap = await db.collection("credentials").doc(uid).get();
    if (credSnap.exists) {
      storedPasswordHash = credSnap.data()?.password ?? null;
    }
  }

  // 3. Fallback: Check legacy test accounts (if cleanId is an email or matches a known test account)
  if (!storedPasswordHash) {
    // Try exact email doc
    const testSnap = await db.collection("testAccounts").doc(docId(cleanId)).get();
    if (testSnap.exists) {
      const data = testSnap.data() as { uid: string; password: string };
      uid = data.uid;
      storedPasswordHash = data.password;
    } else {
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
  const idToken = await idTokenFor(uid);
  return { uid, idToken };
}
