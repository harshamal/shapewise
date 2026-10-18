"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BankRule, applyOps, type OverlayOp } from "@shapewise/blueprint";
import { BlueprintConflict, saveBlueprint } from "@shapewise/db";
import { titleOf } from "@shapewise/runtime";
import { adminDb } from "@/lib/auth/admin";
import { executeIn, loadWorkspace, setDemoBlueprint, type Workspace } from "@/lib/workspace";

/**
 * Money screens: bank rules (and applying them to a pasted bank statement)
 * and closing the books. Both change the setup, so they publish a new
 * setup version like any settings change, with an audit entry.
 */

type Result = { ok: boolean; message: string };

async function publish(ws: Workspace, ops: OverlayOp[], summary: string): Promise<Result> {
  const r = applyOps(ws.bp, ops);
  if (!r.ok) return { ok: false, message: r.issues[0]?.message ?? "That change isn't allowed." };
  if (ws.demo) setDemoBlueprint(ws.tenant, r.blueprint);
  else {
    try {
      await saveBlueprint(adminDb(), ws.tenant, r.blueprint, ws.actor.id, summary);
    } catch (e) {
      if (e instanceof BlueprintConflict) return { ok: false, message: e.message };
      throw e;
    }
  }
  await ws.store.write(ws.tenant, async (tx) => {
    tx.audit({ id: `aud_${crypto.randomUUID()}`, at: new Date().toISOString(), commandId: crypto.randomUUID(), actor: { id: ws.actor.id, name: ws.actor.displayName, kind: ws.actor.kind, channel: "web", roleKey: ws.actor.roleKey }, target: "blueprint", action: "settings", summary: `${summary} (version ${r.blueprint.version})` });
  });
  revalidatePath(`/w/${ws.tenant}`, "layout");
  return { ok: true, message: summary };
}

/* --------------------------------------------------------------- book close */

const Day = z.iso.date();

export async function closeBooks(tenant: string, date: string): Promise<Result> {
  const ws = await loadWorkspace(tenant);
  if (!ws.compiled.can(ws.actor.roleKey, "book_close", "manage")) return { ok: false, message: "Your role can't close the books." };
  const d = Day.safeParse(date);
  if (!d.success) return { ok: false, message: "Pick a date to close up to." };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ws.bp.business.timezone }).format(new Date());
  if (d.data >= today) return { ok: false, message: "Close up to a day that has already finished." };
  return publish(ws, [{ op: "set_setting", path: "general.lockDate", value: d.data }], `Books closed up to ${d.data}`);
}

/** Opens the books again from a date (or entirely), so earlier entries can be corrected. */
export async function reopenBooks(tenant: string, to: string | null): Promise<Result> {
  const ws = await loadWorkspace(tenant);
  if (!ws.compiled.can(ws.actor.roleKey, "book_close", "manage")) return { ok: false, message: "Your role can't reopen the books." };
  const owner = ws.bp.roles.find((r) => r.key === ws.actor.roleKey)?.owner;
  if (!owner) return { ok: false, message: "Only an owner can reopen closed books." };
  const d = to === null ? null : Day.safeParse(to);
  if (d && !d.success) return { ok: false, message: "That date isn't valid." };
  const value = d ? d.data : undefined;
  return publish(ws, [{ op: "set_setting", path: "general.lockDate", value }], value ? `Books reopened after ${value}` : "Books reopened");
}

/* --------------------------------------------------------------- bank rules */

export interface BankRulesView {
  canEdit: boolean;
  rules: BankRule[];
  accounts: { id: string; label: string }[];
  vendors: { id: string; label: string }[];
  taxCodes: { id: string; label: string }[];
  banks: { id: string; label: string }[];
  currency: string;
}

const canEditRules = (ws: Workspace) => ws.compiled.can(ws.actor.roleKey, "bank_rules", "manage") || ws.compiled.can(ws.actor.roleKey, "bank_rules", "create");

export async function loadBankRules(tenant: string): Promise<BankRulesView> {
  const ws = await loadWorkspace(tenant);
  const [accounts, vendors, taxCodes, banks] = await ws.store.read(ws.tenant, async (tx) => [await tx.list("account"), await tx.list("vendor"), await tx.list("tax_code"), await tx.list("bank_account")] as const);
  const title = (target: string, r: (typeof accounts)[number]) => {
    const t = ws.compiled.targets.get(target);
    return t ? titleOf(t, r) : String(r.data.name ?? r.id);
  };
  const active = <T extends { status?: string }>(xs: readonly T[]) => xs.filter((x) => x.status !== "archived");
  return {
    canEdit: canEditRules(ws),
    rules: ws.bp.settings.banking.rules,
    accounts: active(accounts)
      .filter((a) => a.data.type === "expense" || a.data.type === "income" || a.data.type === "asset" || a.data.type === "liability")
      .sort((a, b) => String(a.data.code ?? "").localeCompare(String(b.data.code ?? "")))
      .map((a) => ({ id: a.id, label: `${a.data.code ?? ""} ${a.data.name ?? ""}`.trim() })),
    vendors: active(vendors).map((v) => ({ id: v.id, label: title("vendor", v) })).sort((a, b) => a.label.localeCompare(b.label)),
    taxCodes: active(taxCodes).map((t) => ({ id: t.id, label: title("tax_code", t) })),
    // Statements come from banks, so bank accounts come before cash and cards.
    banks: active(banks)
      .sort((a, b) => Number(b.data.kind === "bank") - Number(a.data.kind === "bank"))
      .map((b) => ({ id: b.id, label: title("bank_account", b) })),
    currency: ws.bp.business.currency,
  };
}

export async function saveBankRule(tenant: string, rule: Omit<BankRule, "id"> & { id?: string }): Promise<Result> {
  const ws = await loadWorkspace(tenant);
  if (!canEditRules(ws)) return { ok: false, message: "Your role can't change bank rules." };
  const id = rule.id ?? `brl_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const parsed = BankRule.safeParse({ ...rule, id, account: rule.account || undefined, vendor: rule.vendor || undefined, taxCode: rule.taxCode || undefined });
  if (!parsed.success) return { ok: false, message: "Give the rule a name and the words to look for (at least 2 letters)." };
  if (!parsed.data.account) return { ok: false, message: "Choose the account the money goes to." };
  const rules = ws.bp.settings.banking.rules;
  const next = rules.some((r) => r.id === id) ? rules.map((r) => (r.id === id ? parsed.data : r)) : [...rules, parsed.data];
  return publish(ws, [{ op: "set_setting", path: "banking.rules", value: next }], `Bank rule saved: ${parsed.data.name}`);
}

export async function deleteBankRule(tenant: string, id: string): Promise<Result> {
  const ws = await loadWorkspace(tenant);
  if (!canEditRules(ws)) return { ok: false, message: "Your role can't change bank rules." };
  const rule = ws.bp.settings.banking.rules.find((r) => r.id === id);
  if (!rule) return { ok: false, message: "That rule is already gone." };
  return publish(ws, [{ op: "set_setting", path: "banking.rules", value: ws.bp.settings.banking.rules.filter((r) => r.id !== id) }], `Bank rule removed: ${rule.name}`);
}

/* ---------------------------------------------------------- bank statements */

export interface StatementLine {
  row: number;
  date: string;
  description: string;
  /** Minor units; negative is money out. */
  amount: number;
  match: { kind: "rule"; rule: string; name: string; account: string } | { kind: "recorded"; label: string } | { kind: "none" };
}

/** Splits CSV text into rows, honouring quotes. */
function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === "\t" || c === ";") row.push(cell.trim()), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((x) => x)) out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x)) out.push(row);
  return out;
}

function parseDate(s: string): string | undefined {
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

const money = (s: string | undefined) => {
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || /-/.test(s) || /\bDR\b/i.test(s);
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) * (neg ? -1 : 1) : 0;
};

/** Reads a pasted statement (date, description, amount, or separate money out and money in columns). */
function readStatement(text: string): { lines: Omit<StatementLine, "match">[]; problem?: string } {
  const rows = csvRows(text);
  if (rows.length === 0) return { lines: [], problem: "Paste the statement first." };
  const head = rows[0]!.map((h) => h.toLowerCase());
  const hasHeader = head.some((h) => /date|desc|narr|detail|amount|debit|credit|withdraw|deposit/.test(h));
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const di = hasHeader ? find(/date/) : 0;
  const ni = hasHeader ? find(/desc|narr|detail|particular|memo|reference/) : 1;
  const ai = hasHeader ? find(/^amount|amount$/) : 2;
  const outI = hasHeader ? find(/debit|withdraw|money out|paid out/) : -1;
  const inI = hasHeader ? find(/credit|deposit|money in|paid in/) : -1;
  if (di < 0 || ni < 0 || (ai < 0 && outI < 0 && inI < 0)) return { lines: [], problem: "Couldn't find the date, description and amount columns. Use a header row like: Date, Description, Amount." };
  const lines: Omit<StatementLine, "match">[] = [];
  rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const date = parseDate(r[di] ?? "");
    const amount = ai >= 0 && r[ai] ? money(r[ai]) : money(r[inI]) - Math.abs(money(r[outI]));
    if (date && amount) lines.push({ row: i + 1, date, description: r[ni] ?? "", amount });
  });
  return lines.length ? { lines } : { lines: [], problem: "No lines with a date and an amount were found." };
}

const DAY = 86_400_000;

export async function previewStatement(tenant: string, bank: string, text: string): Promise<{ ok: boolean; message?: string; lines?: StatementLine[] }> {
  const ws = await loadWorkspace(tenant);
  if (!ws.compiled.can(ws.actor.roleKey, "bank_rules", "view")) return { ok: false, message: "Your role can't use bank rules." };
  if (text.length > 300_000) return { ok: false, message: "That statement is too long. Paste up to a few thousand lines at a time." };
  const read = readStatement(text);
  if (read.problem) return { ok: false, message: read.problem };
  const rules = ws.bp.settings.banking.rules.filter((r) => r.enabled);
  // Money already recorded on this account, to avoid recording it twice.
  const recorded = await ws.store.read(ws.tenant, async (tx) => {
    const out: { date: string; amount: number; label: string; used: boolean }[] = [];
    for (const [target, field, sign] of [["receipt", "deposit_to", 1], ["payment", "paid_from", -1], ["expense", "paid_from", -1]] as const) {
      if (!ws.compiled.targets.has(target)) continue;
      for (const r of await tx.list(target)) if (r.status === "posted" && (!r.data[field] || r.data[field] === bank)) out.push({ date: String(r.data.date), amount: sign * Number(r.data.amount ?? 0), label: String(r.data.number ?? r.number ?? target), used: false });
    }
    return out;
  });
  const lines: StatementLine[] = read.lines.map((l) => {
    const seen = recorded.find((x) => !x.used && x.amount === l.amount && Math.abs(Date.parse(x.date) - Date.parse(l.date)) <= 3 * DAY);
    if (seen) {
      seen.used = true;
      return { ...l, match: { kind: "recorded", label: seen.label } };
    }
    const rule = rules.find((r) => (r.direction === "any" || (r.direction === "out") === l.amount < 0) && l.description.toLowerCase().includes(r.contains.toLowerCase()));
    return { ...l, match: rule && rule.account ? { kind: "rule", rule: rule.id, name: rule.name, account: rule.account } : { kind: "none" } };
  });
  return { ok: true, lines };
}

/** Records the lines a rule matched as expenses paid from the bank account, and posts them. */
export async function recordStatement(tenant: string, bank: string, picked: { date: string; description: string; amount: number; rule: string }[]): Promise<Result> {
  const ws = await loadWorkspace(tenant);
  const t = ws.compiled.targets.get("expense");
  if (!t || !ws.compiled.can(ws.actor.roleKey, t.submodule, "create")) return { ok: false, message: "Your role can't record expenses." };
  const lines = z.array(z.object({ date: Day, description: z.string().max(300), amount: z.number().int(), rule: z.string() })).max(500).parse(picked);
  const rules = new Map(ws.bp.settings.banking.rules.map((r) => [r.id, r]));
  let done = 0;
  const problems: string[] = [];
  for (const l of lines) {
    const rule = rules.get(l.rule);
    if (!rule?.account || l.amount >= 0) continue;
    const r = await executeIn(ws, { type: "record.create", target: "expense", data: { date: l.date, account: rule.account, vendor: rule.vendor, tax_code: rule.taxCode, amount: Math.abs(l.amount) / 100, paid_from: bank } });
    if (r.status !== "ok") {
      problems.push(`${l.description}: ${r.status === "error" ? r.error.message : "needs approval"}`);
      continue;
    }
    const rec = await ws.store.read(ws.tenant, (tx) => tx.get("expense", r.recordId!));
    const posted = await executeIn(ws, { type: "record.action", target: "expense", recordId: r.recordId!, action: "post", expectedVersion: rec?.version });
    if (posted.status === "error") problems.push(`${l.description}: saved as a draft, ${posted.error.message}`);
    done++;
  }
  revalidatePath(`/w/${tenant}`, "layout");
  const msg = `${done} ${done === 1 ? "expense" : "expenses"} recorded and posted.`;
  return { ok: problems.length === 0, message: problems.length ? `${msg} ${problems.slice(0, 3).join(" ")}` : msg };
}
