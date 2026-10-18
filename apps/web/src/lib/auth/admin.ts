import "server-only";
import admin from "firebase-admin";
import type { App } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";

/**
 * firebase-admin, server only. On App Hosting it uses the service's own
 * identity; in local dev set FIREBASE_SERVICE_ACCOUNT to a service account
 * key JSON (Firebase console › Project settings › Service accounts).
 */
export function adminApp(): App {
  if (admin.apps.length && admin.apps[0]) return admin.apps[0];
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  return admin.initializeApp({
    projectId,
    credential: json ? admin.credential.cert(JSON.parse(json)) : admin.credential.applicationDefault(),
  });
}

export const adminAuth = () => admin.auth(adminApp());

const g = globalThis as typeof globalThis & { __swDb?: Firestore };

/**
 * Firestore, configured once per process (settings can only be set before
 * first use, and hot reload re-runs this module). REST transport avoids
 * gRPC certificate problems behind HTTPS-inspecting antivirus.
 */
export function adminDb(): Firestore {
  if (!g.__swDb) {
    g.__swDb = admin.firestore(adminApp());
    g.__swDb.settings({ ignoreUndefinedProperties: true, preferRest: true });
  }
  return g.__swDb;
}
