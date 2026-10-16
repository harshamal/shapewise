/**
 * Integration test against live Firestore. Off by default; run with
 *   SW_FIRESTORE_IT=1 pnpm --filter @shapewise/db test
 * It reads credentials from apps/web/.env.local, works inside a throwaway
 * workspace, and deletes everything it created at the end.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cert, deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { Blueprint, applyOps } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import { compile, createExecutor, type Command, type CommandResult } from "@shapewise/runtime";
import { BlueprintConflict, FirestoreStore, WorkspaceIdTaken, createTenant, loadBlueprint, memberRole, saveBlueprint, tenantPaths, userPath, userWorkspaces } from "../src";

const run = process.env.SW_FIRESTORE_IT === "1";
const TID = `it-${Date.now().toString(36)}`;
const UID = `it-owner-${Date.now().toString(36)}`;

let app: App;
let db: Firestore;
let store: FirestoreStore;
let execute: ReturnType<typeof createExecutor>;
const bp = Blueprint.parse(plasticsFactory);
let n = 0;

const owner = { kind: "user", id: UID, roleKey: "owner", channel: "web", displayName: "IT owner" } as const;
const send = (command: Command, extra: object = {}): Promise<CommandResult> =>
  execute({ id: crypto.randomUUID(), tenantId: TID, actor: owner, command, issuedAt: new Date().toISOString(), ...extra, ...(n++ ? {} : {}) });
const okId = async (p: Promise<CommandResult>) => {
  const r = await p;
  if (r.status !== "ok") throw new Error(JSON.stringify(r));
  return r.recordId!;
};

describe.skipIf(!run)("Firestore store (live)", () => {
  beforeAll(async () => {
    const envPath = fileURLToPath(new URL("../../../apps/web/.env.local", import.meta.url));
    const env = Object.fromEntries(
      readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
    app = initializeApp({ projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT!)) }, `it-${TID}`);
    db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true, preferRest: true });
    store = new FirestoreStore(db);
    await createTenant(db, TID, bp, { uid: UID, email: "it@example.com", name: "IT owner" });
    execute = createExecutor({ store, blueprint: async () => compile((await loadBlueprint(db, TID))!.bp) });
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await db.recursiveDelete(db.doc(tenantPaths(TID).tenant));
    await db.doc(userPath(UID)).delete();
    await deleteApp(app);
  }, 60_000);

  it("creates the workspace with its owner and refuses a taken address", async () => {
    expect(await memberRole(db, TID, UID)).toBe("owner");
    expect(await userWorkspaces(db, UID)).toEqual([{ id: TID, name: "Demo Plastics", roleKey: "owner" }]);
    await expect(createTenant(db, TID, bp, { uid: UID })).rejects.toBeInstanceOf(WorkspaceIdTaken);
  });

  it("runs documents end to end: totals, numbering, conversion, audit", async () => {
    const customer = await okId(send({ type: "record.create", target: "customer", data: { name: "Perera Stores" } }));
    const item = await okId(send({ type: "record.create", target: "item", data: { name: "500 ml container", type: "goods" } }));
    const so = await okId(send({ type: "record.create", target: "sales_order", data: { customer, date: "2026-10-16", lines: [{ item, quantity: 2000, unit_price: 49.75 }] } }));
    const saved = await store.read(TID, (tx) => tx.get("sales_order", so));
    expect(saved?.data).toMatchObject({ total: 9_950_000 });

    expect(await send({ type: "record.action", target: "sales_order", recordId: so, action: "confirm" })).toMatchObject({ status: "ok", effects: { number: "SO-2026-00001" } });
    const inv = await okId(send({ type: "record.convert", from: "sales_order", recordId: so, to: "invoice" }));
    expect((await store.read(TID, (tx) => tx.get("invoice", inv)))?.data).toMatchObject({ sales_order: so, total: 9_950_000 });

    const del = await send({ type: "record.delete", target: "customer", recordId: customer });
    expect(del.status === "error" && del.error.message).toMatch(/is used on/);

    const history = await store.listAudit(TID, { recordId: so });
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(["create", "confirm", "convert"]));
  }, 60_000);

  it("parks large orders for approval and carries them out when approved", async () => {
    const [customer] = (await store.read(TID, (tx) => tx.list("customer"))).map((r) => r.id);
    const [item] = (await store.read(TID, (tx) => tx.list("item"))).map((r) => r.id);
    const so = await okId(send({ type: "record.create", target: "sales_order", data: { customer, date: "2026-10-16", lines: [{ item, quantity: 100_000, unit_price: 60 }] } }));
    const held = await send({ type: "record.action", target: "sales_order", recordId: so, action: "confirm" });
    expect(held.status).toBe("pending_approval");
    const id = held.status === "pending_approval" ? held.approvalId : "";
    expect((await store.listApprovals(TID, "pending")).map((a) => a.id)).toContain(id);
    const done = await send({ type: "approval.decide", approvalId: id, decision: "approve" });
    expect(done).toMatchObject({ status: "ok", effects: { status: "confirmed", number: "SO-2026-00002" } });
  }, 60_000);

  it("returns the same result for a repeated idempotency key", async () => {
    const a = await send({ type: "record.create", target: "customer", data: { name: "Once" } }, { idempotencyKey: "it-import-row-1" });
    const b = await send({ type: "record.create", target: "customer", data: { name: "Once" } }, { idempotencyKey: "it-import-row-1" });
    expect(b).toEqual(a);
    const named = (await store.read(TID, (tx) => tx.list("customer"))).filter((r) => r.data.name === "Once");
    expect(named).toHaveLength(1);
  }, 60_000);

  it("versions blueprints and refuses a stale save", async () => {
    const current = (await loadBlueprint(db, TID))!.bp;
    const r = applyOps(current, [{ op: "set_extension", key: "price_lists", enabled: true }]);
    if (!r.ok) throw new Error("apply failed");
    await saveBlueprint(db, TID, r.blueprint, UID, "Switched on price lists");
    expect((await loadBlueprint(db, TID))!.bp.version).toBe(2);
    await expect(saveBlueprint(db, TID, r.blueprint, UID, "again")).rejects.toBeInstanceOf(BlueprintConflict);
  }, 60_000);
});
