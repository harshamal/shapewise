import { CHART_TEMPLATE_KEYS, chartAccounts, type SystemRole, type TemplateAccount } from "@shapewise/blueprint";
import type { StoredRecord } from "../store";
import { Cache, EngineRule, JOURNAL, engineRecord, num, type EngineCtx } from "./context";

/**
 * The accounting engine's books: system roles turned into real accounts,
 * balanced journal entries, and the balances kept on accounts, bank
 * accounts, customers and vendors.
 *
 * Postings name roles, not accounts. A role resolves to the account the
 * chart template gives it (by code), or a stand-in role's account when the
 * template has no such role (a trader keeps all stock in one inventory
 * account). When the account doesn't exist yet it is added from the
 * template, so a posting never fails for want of an account.
 */

const STAND_INS: Partial<Record<SystemRole, SystemRole[]>> = {
  inventory: ["inventory_fg", "inventory_raw"],
  inventory_raw: ["inventory"],
  inventory_wip: ["inventory"],
  inventory_fg: ["inventory"],
  scrap: ["stock_adjustment"],
  production_variance: ["stock_adjustment"],
  service_income: ["sales"],
};


const DEBIT_NORMAL = new Set(["asset", "expense"]);

export interface JournalLine {
  /** A role, resolved to an account when posted, or an account id. */
  role?: SystemRole;
  account?: string;
  debit?: number;
  credit?: number;
  /** The customer or vendor a receivable or payable line belongs to. */
  party?: { target: "customer" | "vendor"; id: string };
  bank_account?: string;
  memo?: string;
}

export interface StoredLine {
  account: string;
  debit: number;
  credit: number;
  role?: SystemRole;
  party?: { target: "customer" | "vendor"; id: string };
  bank_account?: string;
  memo?: string;
}

export interface EntrySource {
  date: string;
  target: string;
  id: string;
  number?: string;
  action: string;
  memo: string;
}

export class Books {
  constructor(
    private ctx: EngineCtx,
    private cache: Cache,
  ) {}

  /** The business's chart, with its country's tax accounts. */
  private get chart(): readonly TemplateAccount[] {
    return this.charts()[0]!;
  }

  /** The business's chart first, then the other templates for its country, where a missing role's account comes from. */
  private charts(): (readonly TemplateAccount[])[] {
    const bp = this.ctx.c.bp;
    const keys = [bp.settings.accounting.chartTemplate, ...CHART_TEMPLATE_KEYS.filter((k) => k !== bp.settings.accounting.chartTemplate)];
    return keys.map((k) => chartAccounts(k, bp.business.country, bp.settings.tax.custom));
  }

  /** The account a role posts to, added from the chart template when missing. */
  async accountFor(role: SystemRole): Promise<string> {
    const accounts = await this.cache.list("account");
    const byCode = (code: string) => accounts.find((a) => String(a.data.code) === code);
    let def: TemplateAccount | undefined;
    for (const r of [role, ...(STAND_INS[role] ?? [])]) {
      const d = this.chart.find((a) => a.role === r);
      if (!d) continue;
      const have = byCode(d.code);
      if (have) return have.id;
      def ??= d;
    }
    def ??= this.charts().map((c) => c.find((a) => a.role === role)).find(Boolean);
    if (!def) throw new EngineRule(`There's no account for ${role.replaceAll("_", " ")} in the chart of accounts. Add one first.`);
    const existing = byCode(def.code);
    if (existing) return existing.id;
    return this.addAccount(def, role);
  }

  private async addAccount(def: TemplateAccount, role: SystemRole): Promise<string> {
    const accounts = await this.cache.list("account");
    let parent: string | undefined;
    if (def.parent) {
      parent = accounts.find((a) => String(a.data.code) === def.parent)?.id;
      if (!parent) {
        const g = this.charts().flatMap((c) => c).find((a) => a.code === def.parent);
        if (g) parent = await this.addAccount(g, role);
      }
    }
    const rec = engineRecord(this.ctx, "account", this.ctx.newId("acc_"), { code: def.code, name: def.name, type: def.type, subtype: def.subtype ?? def.role, parent, balance: 0 }, parent ? [parent] : []);
    rec.status = "active";
    this.cache.put(rec);
    this.ctx.audit("account", rec.id, "create", `Added account ${def.code} ${def.name}, which the books needed`);
    return rec.id;
  }

  /** The ledger role for a bank or cash account record. */
  async roleOfBank(bankAccountId: unknown): Promise<SystemRole> {
    const b = await this.cache.get("bank_account", bankAccountId);
    return b?.data.kind === "cash" ? "cash" : "bank";
  }

  /** The business's main bank account, else any money account. */
  async defaultBank(kind: "bank" | "cash" = "bank"): Promise<StoredRecord | undefined> {
    const all = (await this.cache.list("bank_account")).filter((b) => b.status !== "archived");
    return all.find((b) => b.data.kind === kind) ?? all[0];
  }

  /**
   * Post one balanced entry. Zero lines are dropped, negative amounts move
   * to the other side, and an entry with nothing left isn't written.
   */
  async post(src: EntrySource, input: JournalLine[], reverses?: string): Promise<string | undefined> {
    const lines: StoredLine[] = [];
    for (const l of input) {
      const amount = num(l.debit) - num(l.credit);
      if (amount === 0) continue;
      if (!Number.isInteger(amount)) throw new Error(`journal: amounts must be whole minor units (${amount})`);
      const account = l.account ?? (await this.accountFor(l.role!));
      lines.push({ account, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, role: l.role, party: l.party, bank_account: l.bank_account, memo: l.memo });
    }
    if (!lines.length) return undefined;
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    if (dr !== cr) throw new Error(`journal: entry for ${src.target} ${src.id} doesn't balance (${dr} against ${cr})`);
    const id = this.ctx.newId("jnl_");
    this.cache.put(
      engineRecord(this.ctx, JOURNAL, id, {
        date: src.date,
        source_target: src.target,
        source_id: src.id,
        source_number: src.number ?? null,
        action: src.action,
        memo: src.memo,
        lines,
        total: dr,
        reverses: reverses ?? null,
      }),
    );
    await this.apply(lines, 1);
    return id;
  }

  /** The same entry with every line on the other side, dated today. */
  async reverse(entryId: string, src: EntrySource): Promise<string | undefined> {
    const e = await this.cache.get(JOURNAL, entryId);
    if (!e) return undefined;
    const lines = (e.data.lines as StoredLine[]).map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
    return this.post(src, lines, entryId);
  }

  /** Keep account, bank, customer and vendor balances current. */
  private async apply(lines: StoredLine[], sign: 1 | -1) {
    for (const l of lines) {
      const dr = (l.debit - l.credit) * sign;
      const acc = await this.cache.get("account", l.account);
      if (acc) {
        acc.data.balance = num(acc.data.balance) + (DEBIT_NORMAL.has(String(acc.data.type)) ? dr : -dr);
        this.cache.put(acc);
      }
      if (l.bank_account) {
        const b = await this.cache.get("bank_account", l.bank_account);
        if (b) {
          b.data.balance = num(b.data.balance) + dr;
          this.cache.put(b);
        }
      }
      if (l.party) {
        const p = await this.cache.get(l.party.target, l.party.id);
        if (p) {
          // What the customer owes you, or what you owe the vendor.
          p.data.balance = num(p.data.balance) + (l.party.target === "customer" ? dr : -dr);
          this.cache.put(p);
        }
      }
    }
  }
}
