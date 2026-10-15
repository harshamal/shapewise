import "server-only";
import { applicationDefault, cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/**
 * firebase-admin, server only. On App Hosting it uses the service's own
 * identity; in local dev set FIREBASE_SERVICE_ACCOUNT to a service account
 * key JSON (Firebase console › Project settings › Service accounts).
 */
export function adminApp(): App {
  if (getApps().length) return getApp();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  return initializeApp({ projectId, credential: json ? cert(JSON.parse(json)) : applicationDefault() });
}

export const adminAuth = () => getAuth(adminApp());
export const adminDb = () => getFirestore(adminApp());
