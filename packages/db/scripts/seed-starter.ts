/**
 * Fills in the starter records (chart of accounts, stores, cash and bank,
 * tax rates) for a workspace created before workspaces got them. Safe to run
 * again; what exists is left alone. Writes as the workspace owner.
 *   tsx scripts/seed-starter.ts <workspace-id>
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { compile, createExecutor, seedStarterRecords, type Command } from "@shapewise/runtime";
import { FirestoreStore, loadBlueprint } from "../src";

const envPath = fileURLToPath(new URL("../../../apps/web/.env.local", import.meta.url));
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
}
const db = getFirestore(initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)) }));
db.settings({ preferRest: true, ignoreUndefinedProperties: true });
const tid = process.argv[2]!;
const loaded = await loadBlueprint(db, tid);
if (!loaded) throw new Error(`No workspace ${tid}`);
const compiled = compile(loaded.bp);
const store = new FirestoreStore(db);
const exec = createExecutor({ store, blueprint: async () => compiled });
const owner = loaded.bp.roles.find((r) => r.owner)!.key;
const report = await seedStarterRecords(loaded.bp, {
  run: (command: Command) => exec({ id: crypto.randomUUID(), tenantId: tid, actor: { kind: "user", id: "system", roleKey: owner, channel: "import", displayName: "Setup" }, command, issuedAt: new Date().toISOString() }),
  list: (target) => store.read(tid, (tx) => tx.list(target)),
});
console.log("created", report.created, report.problems.length ? `problems: ${report.problems.join("; ")}` : "");
