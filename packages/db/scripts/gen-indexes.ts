import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildIndexes } from "../src/indexes";

const out = fileURLToPath(new URL("../../../firestore.indexes.json", import.meta.url));
const spec = buildIndexes();
writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");
console.log(`Wrote ${spec.indexes.length} composite indexes and ${spec.fieldOverrides.length} field overrides to ${out}`);
