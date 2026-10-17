/**
 * Test helper: gives a test account a role in a workspace (local testing only).
 *   tsx scripts/add-member.ts <workspace-id> <email> <roleKey>
 * Prints the workspace's roles when no role is given.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadBlueprint, tenantPaths } from "../src";

const envPath = fileURLToPath(new URL("../../../apps/web/.env.local", import.meta.url));
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
}
const db = getFirestore(initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)) }));
db.settings({ preferRest: true });
const [tid, email, roleKey] = process.argv.slice(2);
const loaded = await loadBlueprint(db, tid!);
if (!loaded) throw new Error(`No workspace ${tid}`);
if (!roleKey) {
  console.log(loaded.bp.roles.map((r) => `${r.key} (${r.label})`).join("\n"));
  process.exit(0);
}
if (!loaded.bp.roles.some((r) => r.key === roleKey)) throw new Error(`No role ${roleKey}`);
const e = email!.trim().toLowerCase();
const uid = `test_${createHash("sha256").update(`uid:${e}`).digest("hex").slice(0, 24)}`;
const now = new Date().toISOString();
await db.doc(tenantPaths(tid!).doc("members", uid)).set({ uid, roleKey, email: e, name: null, joinedAt: now });
await db.doc(`users/${uid}`).set({ tenants: { [tid!]: { name: loaded.bp.business.name, roleKey } }, updatedAt: now }, { merge: true });
console.log(`${e} is now ${roleKey} in ${tid}`);
