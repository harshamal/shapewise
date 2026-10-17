import { describe, expect, it } from "vitest";
import { Blueprint, presetBlueprint } from "@shapewise/blueprint";
import { MemoryStore, compile, createExecutor, seedStarterRecords, type Command } from "../src";

describe("starter records", () => {
  it("gives a new workspace its accounts, stores, cash and bank, and tax rates, once", async () => {
    const bp = Blueprint.parse({ ...presetBlueprint("food", { name: "Galle Bakehouse", currency: "LKR", locale: "en-LK", timezone: "Asia/Colombo" }), seed: { taxCodes: [{ name: "VAT 18%", rate: 18, kind: "vat" }] } });
    const c = compile(bp);
    const store = new MemoryStore();
    let n = 0;
    const exec = createExecutor({ store, blueprint: async () => c });
    const owner = bp.roles.find((r) => r.owner)!.key;
    const deps = {
      run: (command: Command) => exec({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, tenantId: "t", actor: { kind: "user", id: "u", roleKey: owner, channel: "web" }, command, issuedAt: new Date().toISOString() }),
      list: (target: string) => store.read("t", (tx) => tx.list(target)),
    };
    const first = await seedStarterRecords(bp, deps);
    expect(first.problems).toEqual([]);
    expect(first.created.account).toBeGreaterThan(20);
    expect(first.created).toMatchObject({ warehouse: 2, bank_account: 2, tax_code: 1 });
    const accounts = await deps.list("account");
    const cash = accounts.find((a) => a.data.code === "1110")!;
    expect(accounts.find((a) => a.id === cash.data.parent)?.data.code).toBe("1100");
    // Running again creates nothing new.
    expect((await seedStarterRecords(bp, deps)).created).toEqual({});
  });
});
