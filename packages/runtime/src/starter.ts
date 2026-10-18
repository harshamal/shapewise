import { chartOf, type Blueprint } from "@shapewise/blueprint";
import type { Command, CommandResult } from "./commands";
import type { StoredRecord } from "./store";

/**
 * The records a new workspace needs before its first document can be
 * finished: the chart of accounts from its template, stores to keep stock
 * in, a cash and a bank account to take and make payments, and the tax
 * rates its registrations call for. Created through the pipeline like any
 * other record, so they're audited and validated. Safe to run again: what
 * already exists (by code or name) is left alone, so it can fill in an
 * existing workspace too.
 */

export interface StarterDeps {
  run: (command: Command) => Promise<CommandResult>;
  list: (target: string) => Promise<StoredRecord[]>;
}

export interface StarterReport {
  created: Record<string, number>;
  problems: string[];
}

const on = (bp: Blueprint, module: string) => bp.modules.some((m) => m.key === module && m.enabled);

export async function seedStarterRecords(bp: Blueprint, deps: StarterDeps): Promise<StarterReport> {
  const report: StarterReport = { created: {}, problems: [] };
  const make = async (target: string, data: Record<string, unknown>, label: string): Promise<string | undefined> => {
    const r = await deps.run({ type: "record.create", target, data });
    if (r.status === "ok") {
      report.created[target] = (report.created[target] ?? 0) + 1;
      return r.recordId;
    }
    report.problems.push(`${label}: ${r.status === "error" ? r.error.message : r.status}`);
    return undefined;
  };

  /* chart of accounts, parents before children */
  const existing = await deps.list("account");
  const byCode = new Map(existing.map((a) => [String(a.data.code), a.id]));
  for (const a of chartOf(bp)) {
    if (byCode.has(a.code)) continue;
    const id = await make("account", { code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? (a.role ? a.role : undefined), parent: a.parent ? byCode.get(a.parent) : undefined }, `Account ${a.code}`);
    if (id) byCode.set(a.code, id);
  }

  /* stores */
  if (on(bp, "inventory")) {
    const have = new Set((await deps.list("warehouse")).map((w) => String(w.data.code)));
    const wanted = bp.seed.warehouses.length
      ? bp.seed.warehouses
      : on(bp, "production")
        ? [
            { code: "RM", name: "Raw materials", kind: "raw_material" as const },
            { code: "FG", name: "Finished goods", kind: "finished_goods" as const },
          ]
        : [{ code: "MAIN", name: "Main store", kind: "general" as const }];
    for (const w of wanted) if (!have.has(w.code)) await make("warehouse", { code: w.code, name: w.name, kind: w.kind }, `Store ${w.code}`);
  }

  /* cash and bank */
  const banks = new Set((await deps.list("bank_account")).map((b) => String(b.data.name)));
  for (const b of [
    { name: "Cash in hand", kind: "cash" },
    { name: "Main bank account", kind: "bank" },
  ])
    if (!banks.has(b.name)) await make("bank_account", b, b.name);

  /* tax rates */
  const rates = new Set((await deps.list("tax_code")).map((t) => String(t.data.name)));
  for (const c of bp.seed.taxCodes) if (!rates.has(c.name)) await make("tax_code", { name: c.name, rate: c.rate, kind: c.kind, ...(c.tax ? { tax: c.tax } : {}) }, c.name);

  return report;
}
