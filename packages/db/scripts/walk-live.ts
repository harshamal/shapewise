/**
 * Walks every document of a real workspace's blueprint, in memory only:
 * reads the blueprint from Firestore, writes nothing.
 *   tsx scripts/walk-live.ts <workspace-id>
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadBlueprint } from "../src";
import { walk } from "../../runtime/test/walk";

const envPath = fileURLToPath(new URL("../../../apps/web/.env.local", import.meta.url));
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
}
const app = initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)) });
const db = getFirestore(app);
db.settings({ preferRest: true });
const id = process.argv[2] ?? "galle-bakehouse";
const loaded = await loadBlueprint(db, id);
if (!loaded) throw new Error(`No workspace ${id}`);
const results = await walk(loaded.bp);
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.label.padEnd(26)} ${r.steps.join(" > ")}${r.problem ? `\n     ${r.problem}` : ""}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} documents flow end to end`);
