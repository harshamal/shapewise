import { evaluate, exprReads, type EvalContext, type ExprNode } from "@shapewise/blueprint";
import { CommandEnvelope, type Actor, type Command, type CommandResult, type ErrorCode } from "./commands";
import { visibleTo, type CAction, type CField, type Compiled, type CTarget } from "./compile";
import { checkRefs, coerceRecord, computeTotals, formatNumber, fromMinor, sequenceKey, titleOf, toMinor, type DataIssue } from "./data";
import type { ApprovalDoc, Store, StoredRecord, WriteTx } from "./store";
import { EngineRule, postAction } from "./engines";

/**
 * The command pipeline. Every write runs here, in one transaction:
 *
 *   parse → permission → validate input and references → totals →
 *   rules → approval (park and stop) → numbering → write → audit
 *
 * Ledger and stock postings (the engines in ./engines) run at the action
 * step, inside the same transaction as the status change.
 */

export interface PipelineDeps {
  store: Store;
  blueprint(tenantId: string): Promise<Compiled>;
  now?: () => Date;
  newId?: (prefix: string) => string;
}

class Fail extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly issues?: DataIssue[],
  ) {
    super(message);
  }
}

interface Run {
  env: CommandEnvelope;
  c: Compiled;
  tx: WriteTx;
  now: Date;
  today: string;
  warnings: { ruleId?: string; message: string }[];
  effects: Record<string, unknown>;
  /** Set when re-running a command an approver has approved. */
  approved: boolean;
  newId: (prefix: string) => string;
}

const TERMINAL = new Set(["void", "cancelled", "closed", "reversed", "refunded", "rejected", "released", "completed", "ended", "disposed", "written_off", "paid", "archived", "consumed", "converted"]);

export function createExecutor(deps: PipelineDeps) {
  const now = deps.now ?? (() => new Date());
  const newId =
    deps.newId ??
    ((prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

  return async function execute(input: unknown): Promise<CommandResult> {
    const parsed = CommandEnvelope.safeParse(input);
    const commandId = (input as { id?: string })?.id ?? "unknown";
    if (!parsed.success) {
      return error(commandId, "validation", "The command isn't valid.", parsed.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })));
    }
    const env = parsed.data;
    try {
      const c = await deps.blueprint(env.tenantId);
      return await deps.store.write(env.tenantId, async (tx) => {
        const key = env.idempotencyKey ? `idem:${env.actor.id}:${env.idempotencyKey}` : undefined;
        if (key) {
          const prev = (await tx.getResult(key)) as CommandResult | undefined;
          if (prev) return prev;
        }
        const t = now();
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: c.bp.business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
        const run: Run = { env, c, tx, now: t, today, warnings: [], effects: {}, approved: Boolean(env.approvalId), newId };
        const result = await handle(run, env.command);
        if (key && result.status !== "error") tx.putResult(key, result);
        return result;
      });
    } catch (e) {
      if (e instanceof Fail) return error(env.id, e.code, e.message, e.issues);
      if (e instanceof EngineRule) return error(env.id, "engine_rule", e.message);
      console.error("pipeline: unexpected failure", e);
      return error(env.id, "internal", "Something went wrong saving this. Nothing was changed.");
    }
  };
}

function error(commandId: string, code: ErrorCode, message: string, issues?: DataIssue[]): CommandResult {
  return { status: "error", commandId, error: { code, message, issues, retryable: code === "unavailable" } };
}

/* ------------------------------------------------------------------ handlers */

async function handle(run: Run, cmd: Command): Promise<CommandResult> {
  switch (cmd.type) {
    case "record.create":
      return create(run, target(run, cmd.target), cmd.data);
    case "record.update":
      return update(run, target(run, cmd.target), cmd.recordId, cmd.patch, cmd.expectedVersion);
    case "record.delete":
      return remove(run, target(run, cmd.target), cmd.recordId);
    case "record.action":
      return action(run, target(run, cmd.target), cmd.recordId, cmd.action, cmd.data, cmd.expectedVersion);
    case "record.convert":
      return convert(run, cmd);
    case "approval.decide":
      return decide(run, cmd.approvalId, cmd.decision, cmd.note);
    default:
      throw new Fail("unavailable", "System changes arrive with the change studio.");
  }
}

function target(run: Run, key: string): CTarget {
  const t = run.c.targets.get(key);
  if (!t) throw new Fail("not_found", `"${key}" isn't switched on in this workspace.`);
  return t;
}

function allow(run: Run, t: CTarget, action: Parameters<Compiled["can"]>[2]) {
  if (!run.c.can(run.env.actor.roleKey, t.submodule, action)) {
    throw new Fail("forbidden", `Your role (${run.env.actor.roleKey}) can't ${action === "edit" ? "change" : action} ${t.labelPlural.toLowerCase()}.`);
  }
}

/** Refuses records outside a role's "own records" scope (and treats them as missing, so their existence isn't revealed). */
function inScope(run: Run, t: CTarget, rec: StoredRecord) {
  if (run.approved) return;
  if (!visibleTo(run.c, run.env.actor.roleKey, run.env.actor.id, t, rec)) throw new Fail("forbidden", `That ${t.label.toLowerCase()} isn't one of yours.`);
}

async function load(run: Run, t: CTarget, id: string): Promise<StoredRecord> {
  const rec = await run.tx.get(t.target, id);
  if (!rec) throw new Fail("not_found", `That ${t.label.toLowerCase()} doesn't exist.`);
  inScope(run, t, rec);
  return rec;
}

/** Documents change only while draft; masters and custom records until they reach a final state. */
export function editable(t: CTarget, rec: Pick<StoredRecord, "status">): boolean {
  if (t.initial === "draft") return rec.status === "draft";
  const state = t.states.find((s) => s.key === rec.status);
  return !(state?.terminal || (rec.status && TERMINAL.has(rec.status)));
}

/** Drafts can be deleted; other documents are voided instead. Masters can be deleted when unused. */
export function deletable(t: CTarget, rec: Pick<StoredRecord, "status">): boolean {
  return t.initial !== "draft" || rec.status === "draft";
}

/** The business date a record is booked on, if it has one. */
function bookedOn(rec: { data: Record<string, unknown> }): string | undefined {
  const d = rec.data.date ?? (typeof rec.data.at === "string" ? rec.data.at.slice(0, 10) : undefined);
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : undefined;
}

/** Closed books: nothing dated on or before the lock date is created, changed, posted, voided or deleted. */
function notClosed(run: Run, t: CTarget, verb: string, ...recs: ({ data: Record<string, unknown> } | undefined)[]) {
  const lock = run.c.bp.settings.general.lockDate;
  if (!lock) return;
  for (const r of recs) {
    const d = r && bookedOn(r);
    if (d && d <= lock) throw new Fail("engine_rule", `The books are closed up to ${lock}, so a ${t.label.toLowerCase()} dated ${d} can't be ${verb}. Date it after ${lock}, or ask an owner to reopen the books.`);
  }
}

async function create(run: Run, t: CTarget, input: Record<string, unknown>): Promise<CommandResult> {
  allow(run, t, "create");
  const { data, issues } = coerceRecord(t, input, "create");
  notClosed(run, t, "created", { data });
  const links = await checkRefs(t, data, run.tx, issues);
  if (issues.length) throw new Fail("validation", `Please fix ${issues.length === 1 ? "this" : `these ${issues.length}`} before saving.`, issues);

  const at = run.now.toISOString();
  const rec: StoredRecord = {
    id: run.newId(prefixOf(t)),
    target: t.target,
    data,
    status: t.initial,
    version: 1,
    createdAt: at,
    updatedAt: at,
    createdBy: run.env.actor.id,
    updatedBy: run.env.actor.id,
    links,
  };
  await defaultDueDate(run, t, rec);
  await computeTotals(t, rec.data, run.tx);
  await computeFields(run, t, rec);
  await runRules(run, t, "create", rec);

  const parked = await maybePark(run, t, "create", rec, undefined);
  if (parked) return parked;

  if (t.numberOnCreate) await assignNumber(run, t, rec);
  run.tx.put(rec);
  audit(run, t, rec.id, "create", `Created ${t.label.toLowerCase()} ${titleOf(t, rec)}`);
  return ok(run, rec);
}

async function update(run: Run, t: CTarget, id: string, patch: Record<string, unknown>, expectedVersion?: number): Promise<CommandResult> {
  allow(run, t, "edit");
  const rec = await load(run, t, id);
  if (expectedVersion !== undefined && rec.version !== expectedVersion) throw new Fail("conflict", "Someone else changed this since you opened it. Reload and try again.");
  if (rec.pendingApproval && !run.approved) throw new Fail("conflict", "This is waiting for approval and can't be changed until it's decided.");
  if (!editable(t, rec)) throw new Fail("engine_rule", `A ${statusLabel(t, rec)} ${t.label.toLowerCase()} can't be changed.${t.actions.some((a) => a.key === "void") ? " Void it and create a new one." : ""}`);

  const { data, issues } = coerceRecord(t, patch, "update");
  const next: StoredRecord = { ...rec, data: { ...rec.data, ...data } };
  notClosed(run, t, "changed", rec, next);
  next.links = await checkRefs(t, next.data, run.tx, issues);
  if (issues.length) throw new Fail("validation", `Please fix ${issues.length === 1 ? "this" : `these ${issues.length}`} before saving.`, issues);

  await computeTotals(t, next.data, run.tx);
  await computeFields(run, t, next);
  await runRules(run, t, "update", next);
  const parked = await maybePark(run, t, "update", next, rec);
  if (parked) return parked;

  next.version = rec.version + 1;
  next.updatedAt = run.now.toISOString();
  next.updatedBy = run.env.actor.id;
  delete next.pendingApproval;
  run.tx.put(next);
  audit(run, t, id, "update", `Changed ${titleOf(t, next)}`);
  return ok(run, next);
}

async function remove(run: Run, t: CTarget, id: string): Promise<CommandResult> {
  allow(run, t, "manage");
  const rec = await load(run, t, id);
  if (!deletable(t, rec)) {
    throw new Fail("engine_rule", `Only drafts can be deleted. ${t.actions.some((a) => a.key === "void") ? "Void it instead, so the record and its history stay." : ""}`.trim());
  }
  const using = await run.tx.referencedBy(id);
  if (using) {
    const other = run.c.targets.get(using.target);
    const where = other ? `${other.label.toLowerCase()} ${titleOf(other, using)}` : "another record";
    throw new Fail("engine_rule", `${titleOf(t, rec)} is used on ${where}, so it can't be deleted.${t.actions.some((a) => a.key === "archive") ? " Archive it instead." : ""}`);
  }
  notClosed(run, t, "deleted", rec);
  const parked = await maybePark(run, t, "delete", rec, rec);
  if (parked) return parked;
  run.tx.remove(t.target, id);
  audit(run, t, id, "delete", `Deleted ${titleOf(t, rec)}`);
  return { status: "ok", commandId: run.env.id, recordId: id, effects: run.effects, warnings: run.warnings };
}

async function action(run: Run, t: CTarget, id: string, key: string, input: Record<string, unknown> | undefined, expectedVersion?: number): Promise<CommandResult> {
  const a = t.actions.find((x) => x.key === key);
  if (!a) throw new Fail("validation", `"${key}" isn't an action on ${t.labelPlural.toLowerCase()}. Options: ${t.actions.map((x) => x.key).join(", ") || "none"}.`);
  allow(run, t, a.permission);
  const rec = await load(run, t, id);
  if (expectedVersion !== undefined && rec.version !== expectedVersion) throw new Fail("conflict", "Someone else changed this since you opened it. Reload and try again.");
  if (rec.pendingApproval && !run.approved) throw new Fail("conflict", "This is already waiting for approval.");
  if (!rec.status || !a.from.includes(rec.status)) {
    throw new Fail("conflict", `Can't ${a.label.toLowerCase()} a ${statusLabel(t, rec)} ${t.label.toLowerCase()}.`);
  }

  const next: StoredRecord = { ...rec, data: { ...rec.data } };
  if (input && Object.keys(input).length) {
    const { data, issues } = coerceRecord(t, input, "update");
    if (issues.length) throw new Fail("validation", "Please fix these first.", issues);
    Object.assign(next.data, data);
  }
  const missing = (a.requires ?? []).filter((f) => next.data[f] === undefined || next.data[f] === null || next.data[f] === "");
  if (missing.length) throw new Fail("validation", `Fill in ${missing.map((f) => t.fields.find((x) => x.key === f)?.label ?? f).join(", ")} first.`);
  if (a.when && (await evalOn(run, t, next, a.when)) !== true) throw new Fail("rule_rejected", `"${a.label}" isn't allowed for this record right now.`);
  engineChecks(t, a, next);
  // Anything that books or reverses an entry counts; moving a draft along doesn't.
  if (a.effects.some((e) => e === "ledger" || e === "stock") || /^(void|cancel|reverse|refund)$/.test(a.key)) notClosed(run, t, a.label.toLowerCase().startsWith("void") ? "voided" : "posted", next);

  await runRules(run, t, a.key, next);
  const parked = await maybePark(run, t, a.key, next, rec, a);
  if (parked) return parked;

  next.status = a.to;
  if (a.effects.includes("numbering") && !next.number) await assignNumber(run, t, next);
  if (t.paymentStatus && a.to === "posted") next.data.payment_status = "unpaid";
  if (a.effects.some((e) => e === "ledger" || e === "stock")) {
    const posted = await postAction(
      {
        tx: run.tx,
        c: run.c,
        now: run.now,
        today: run.today,
        actorId: run.env.actor.id,
        newId: run.newId,
        warn: (message) => run.warnings.push({ message }),
        audit: (target, recordId, action, summary) => audit(run, run.c.targets.get(target) ?? ({ target } as CTarget), recordId, action, summary),
      },
      t,
      a,
      next,
    );
    if (posted.journal.length || posted.moves) run.effects.posted = posted;
  }
  next.version = rec.version + 1;
  next.updatedAt = run.now.toISOString();
  next.updatedBy = run.env.actor.id;
  delete next.pendingApproval;
  run.tx.put(next);
  audit(run, t, id, a.key, `${a.label}: ${titleOf(t, next)}`);
  return ok(run, next);
}

/** Invariants the engines enforce even before postings exist. */
function engineChecks(t: CTarget, a: CAction, rec: StoredRecord) {
  if (t.target === "journal" && a.key === "post") {
    const lines = (rec.data.lines as Record<string, unknown>[] | undefined) ?? [];
    const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    if (lines.length < 2 || dr !== cr || dr === 0) throw new Fail("engine_rule", `Debits (${fromMinor(dr).toFixed(2)}) must equal credits (${fromMinor(cr).toFixed(2)}) across at least two lines.`);
  }
  const lines = rec.data.lines as unknown[] | undefined;
  if (a.effects.includes("ledger") && Array.isArray(lines) && lines.length === 0 && t.lines) throw new Fail("engine_rule", `Add at least one line before you ${a.label.toLowerCase()}.`);
}

async function convert(run: Run, cmd: Extract<Command, { type: "record.convert" }>): Promise<CommandResult> {
  const { from, to, src } = await convertible(run, cmd.from, cmd.recordId, cmd.to);
  const data = await conversionData({ c: run.c, get: (t, id) => run.tx.get(t, id), today: run.today }, from, to, src, cmd.lines);
  Object.assign(data, cmd.data ?? {});
  const result = await create(run, to, data);
  if (result.status === "ok" && from.states.some((s) => s.key === "converted") && src.status === "accepted") {
    run.tx.put({ ...src, status: "converted", version: src.version + 1, updatedAt: run.now.toISOString() });
  }
  if (result.status === "ok") audit(run, from, src.id, "convert", `Turned into ${to.label.toLowerCase()} ${result.recordId}`);
  return result;
}

/** The checks before a conversion: it exists, the role may read the source and create the target, the source is far enough along. */
async function convertible(run: Run, fromKey: string, recordId: string, toKey: string) {
  const from = target(run, fromKey);
  const to = target(run, toKey);
  if (!from.convertsTo.some((x) => x.to === toKey)) throw new Fail("validation", `${from.labelPlural} can't be turned into ${to.labelPlural.toLowerCase()}.`);
  allow(run, from, "view");
  allow(run, to, "create");
  const src = await load(run, from, recordId);
  if (from.initial === "draft" && src.status === "draft" && from.target !== "quote") throw new Fail("conflict", `Confirm or post the ${from.label.toLowerCase()} first.`);
  return { from, to, src };
}

interface ConversionDeps {
  c: Compiled;
  get: (target: string, id: string) => Promise<StoredRecord | undefined>;
  today: string;
}

/**
 * What a new document takes from the one it's made from, as create input
 * (money in major units): matching fields, a link back, today's date, the
 * lines; prices and discounts from the order behind a delivery note or goods
 * received; and for "buy shortages" the recipe's materials for the planned
 * quantity.
 */
export async function conversionData(d: ConversionDeps, from: CTarget, to: CTarget, src: StoredRecord, pickLines?: { lineId: string; quantity: number }[]): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};
  const fromMajor = (f: CField, v: unknown) => (f.type === "money" && typeof v === "number" ? fromMinor(v) : v);
  for (const f of to.fields) {
    if (f.system) continue;
    const sf = from.fields.find((x) => x.key === f.key && x.type === f.type);
    if (sf && src.data[f.key] !== undefined && src.data[f.key] !== null) data[f.key] = fromMajor(f, src.data[f.key]);
    if (f.type === "ref" && f.to === from.target) data[f.key] = src.id;
  }
  // Not every document has a date (production orders, batches).
  if (to.fields.some((f) => f.key === "date")) data.date = d.today;
  // Paying an invoice or a bill: the amount still owed.
  const amount = to.fields.find((f) => f.key === "amount" && f.type === "money" && !f.system);
  if (amount && data.amount === undefined) {
    const owed = src.data.amount_due ?? src.data.total;
    if (typeof owed === "number" && owed > 0) data.amount = fromMinor(owed);
  }
  if (to.lines && from.lines) {
    const rows = (src.data.lines as Record<string, unknown>[] | undefined) ?? [];
    const pick = pickLines ? new Map(pickLines.map((l) => [l.lineId, l.quantity])) : undefined;
    data.lines = rows
      .filter((r) => !pick || pick.has(String(r._line)))
      .map((r) => {
        const out: Record<string, unknown> = {};
        for (const f of to.lines!.fields) {
          if (f.system) continue;
          const sf = from.lines!.fields.find((x) => x.key === f.key);
          if (sf && r[f.key] !== undefined && r[f.key] !== null) out[f.key] = fromMajor(f, r[f.key]);
        }
        if (pick) out.quantity = pick.get(String(r._line));
        return out;
      });
  }
  // Buying for production: the recipe's materials, scaled from its output to the planned quantity.
  if (to.lines && !from.lines && src.data.recipe) {
    const recipe = await d.get("recipe", String(src.data.recipe));
    const per = Number(recipe?.data.output_quantity) || 1;
    const planned = Number(src.data.planned_quantity) || per;
    data.lines = ((recipe?.data.lines as Record<string, unknown>[] | undefined) ?? [])
      .filter((l) => l.item)
      .map((l) => ({ item: l.item, quantity: Math.round(((Number(l.quantity) || 0) * planned * 1000) / per) / 1000 }));
  }
  // A delivery note or goods received has no prices; take them (and discounts, tax) from the order behind it, item by item.
  if (to.lines && Array.isArray(data.lines)) {
    const needs = to.lines.fields.filter((f) => !f.system && f.key !== "item" && f.key !== "quantity").map((f) => f.key);
    const missing = (data.lines as Record<string, unknown>[]).some((l) => needs.some((k) => l[k] === undefined));
    const origin = missing ? from.fields.find((f) => f.type === "ref" && f.to && src.data[f.key] && d.c.targets.get(f.to)?.lines) : undefined;
    if (origin) {
      const ot = d.c.targets.get(origin.to!)!;
      const order = await d.get(ot.target, String(src.data[origin.key]));
      const orderLines = (order?.data.lines as Record<string, unknown>[] | undefined) ?? [];
      for (const l of data.lines as Record<string, unknown>[]) {
        const match = orderLines.find((o) => o.item && o.item === l.item);
        if (!match) continue;
        for (const k of needs) {
          const f = ot.lines!.fields.find((x) => x.key === k);
          if (l[k] === undefined && f && match[k] !== undefined && match[k] !== null) l[k] = fromMajor(f, match[k]);
        }
      }
    }
  }
  return data;
}

/**
 * The new document a conversion would make, without making it, so a form
 * can open pre-filled when something still has to be filled in. Values are
 * in stored form (money in minor units), like a saved record.
 */
export async function previewConversion(
  deps: { store: Store; blueprint: () => Promise<Compiled>; now?: () => Date },
  tenantId: string,
  actor: Actor,
  fromKey: string,
  recordId: string,
  toKey: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
  const c = await deps.blueprint();
  const now = deps.now?.() ?? new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: c.bp.business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  try {
    return await deps.store.read(tenantId, async (tx) => {
      const run = { c, env: { actor }, approved: false, tx, today, now } as unknown as Run;
      const { from, to, src } = await convertible(run, fromKey, recordId, toKey);
      const data = await conversionData({ c, get: (t, id) => tx.get(t, id), today }, from, to, src);
      const toStored = (f: CField, v: unknown) => (f.type === "money" && typeof v === "number" ? toMinor(v) : v);
      for (const f of to.fields) if (data[f.key] !== undefined) data[f.key] = toStored(f, data[f.key]);
      if (to.lines && Array.isArray(data.lines)) data.lines = (data.lines as Record<string, unknown>[]).map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, toStored(to.lines!.fields.find((f) => f.key === k) ?? ({ type: "text" } as CField), v)])));
      return { ok: true as const, data };
    });
  } catch (e) {
    if (e instanceof Fail) return { ok: false, message: e.message };
    throw e;
  }
}

/* ---------------------------------------------------------------- approvals */

async function maybePark(run: Run, t: CTarget, actionKey: string, rec: StoredRecord, existing: StoredRecord | undefined, a?: CAction): Promise<CommandResult | undefined> {
  if (run.approved) return undefined;
  const { actor } = run.env;
  const amount = t.amountField && typeof rec.data[t.amountField] === "number" ? fromMinor(rec.data[t.amountField] as number) : undefined;

  let hit: { id: string; label: string; stages: ApprovalDoc["stages"] } | undefined;
  for (const p of run.c.approvals(t.target, actionKey)) {
    if (p.channels && !p.channels.includes(actor.channel as never)) continue;
    if (p.when && (await evalOn(run, t, rec, p.when, { amount: amount ?? null })) !== true) continue;
    const stages = p.stages.filter((s) => s.minAmount <= 0 || (amount !== undefined && amount >= s.minAmount));
    if (stages.length) {
      hit = { id: p.id, label: p.label, stages: stages.map((s) => ({ id: s.id, name: s.name, roles: [...s.roles], requireAll: s.requireAll })) };
      break;
    }
  }
  // Agents: hold writes per the workspace's agent setting, whatever the rules say.
  const hold = run.c.bp.settings.agents.holdAgentWrites;
  if (!hit && actor.kind === "agent" && (hold === "all" || (hold === "posting" && a?.effects.some((e) => e === "ledger" || e === "stock")))) {
    const owners = run.c.bp.roles.filter((r) => r.owner).map((r) => r.id);
    hit = { id: "agents", label: "Changes made by agents", stages: [{ id: "agents", name: "Owner", roles: owners, requireAll: false }] };
  }
  if (!hit) return undefined;

  const doc: ApprovalDoc = {
    id: run.newId("apv_"),
    status: "pending",
    policyId: hit.id,
    label: hit.label,
    target: t.target,
    recordId: existing?.id,
    action: actionKey,
    summary: `${a?.label ?? humanAction(actionKey)}: ${await describe(run, t, rec)}${amount !== undefined ? ` (${amount.toLocaleString("en-LK", { minimumFractionDigits: 2 })})` : ""}`,
    amount,
    envelope: run.env,
    stages: hit.stages,
    stageIndex: 0,
    decisions: [],
    requestedBy: actor.id,
    requestedByName: actor.displayName,
    createdAt: run.now.toISOString(),
  };
  run.tx.putApproval(doc);
  if (existing) run.tx.put({ ...existing, pendingApproval: doc.id });
  audit(run, t, existing?.id, "approval_requested", `Asked for approval: ${doc.summary}`);
  return { status: "pending_approval", commandId: run.env.id, approvalId: doc.id, policyId: hit.id, reason: `Waiting for ${hit.stages.map((s) => s.name).join(", then ")} (${hit.label.toLowerCase()}).` };
}

/** A record as a person would name it in an approval: its number, or for a draft, who it's for. */
async function describe(run: Run, t: CTarget, rec: StoredRecord): Promise<string> {
  if (rec.number) return `${t.label.toLowerCase()} ${rec.number}`;
  const party = t.fields.find((f) => f.type === "ref" && (f.to === "customer" || f.to === "vendor") && rec.data[f.key]);
  const other = party ? run.c.targets.get(party.to!) : undefined;
  const who = party && other ? await run.tx.get(other.target, String(rec.data[party.key])) : undefined;
  return who && other ? `${t.label.toLowerCase()} for ${titleOf(other, who)}` : `${t.label.toLowerCase()} ${titleOf(t, rec)}`;
}

async function decide(run: Run, approvalId: string, decision: "approve" | "reject", note?: string): Promise<CommandResult> {
  const doc = await run.tx.getApproval(approvalId);
  if (!doc) throw new Fail("not_found", "That approval request doesn't exist.");
  if (doc.status !== "pending") throw new Fail("conflict", `This was already ${doc.status}.`);
  const { actor } = run.env;
  const role = run.c.bp.roles.find((r) => r.key === actor.roleKey);
  const isOwner = Boolean(role?.owner);
  const stage = doc.stages[doc.stageIndex]!;
  if (!isOwner && !(role && stage.roles.includes(role.id))) throw new Fail("forbidden", `Only ${stage.name} can decide this stage.`);
  if (doc.requestedBy === actor.id && !isOwner) throw new Fail("forbidden", "You can't approve your own request.");

  // When a stage needs one person from each role, a role that has signed doesn't sign again.
  const signed = doc.decisions.filter((d) => d.stageId === stage.id && d.decision === "approve");
  if (decision === "approve" && stage.requireAll && !isOwner && role && signed.some((d) => d.roleId === role.id)) throw new Fail("conflict", `${role.label} has already approved this stage.`);
  if (signed.some((d) => d.by === actor.id)) throw new Fail("conflict", "You've already approved this stage.");
  doc.decisions.push({ stageId: stage.id, by: actor.id, byName: actor.displayName, roleId: role?.id, decision, note, at: run.now.toISOString() });
  const t = run.c.targets.get(doc.target);
  const clear = async () => {
    if (!doc.recordId || !t) return;
    const rec = await run.tx.get(t.target, doc.recordId);
    if (rec?.pendingApproval === doc.id) {
      delete rec.pendingApproval;
      run.tx.put(rec);
    }
  };

  if (decision === "reject") {
    doc.status = "rejected";
    run.tx.putApproval(doc);
    await clear();
    audit(run, t, doc.recordId, "approval_rejected", `Rejected: ${doc.summary}${note ? ` (${note})` : ""}`);
    return { status: "ok", commandId: run.env.id, recordId: doc.recordId, effects: { approval: "rejected" }, warnings: [] };
  }
  // A stage where all must approve waits until every role in it has (the owner signs for all).
  if (stage.requireAll && !isOwner) {
    const done = new Set(doc.decisions.filter((d) => d.stageId === stage.id && d.decision === "approve").map((d) => d.roleId));
    const waiting = stage.roles.filter((r) => !done.has(r));
    if (waiting.length) {
      run.tx.putApproval(doc);
      const names = waiting.map((r) => run.c.bp.roles.find((x) => x.id === r)?.label ?? r).join(" and ");
      audit(run, t, doc.recordId, "approval_stage", `Approved by ${role?.label ?? actor.displayName}; waiting for ${names}.`);
      return { status: "ok", commandId: run.env.id, recordId: doc.recordId, effects: { approval: "waiting_for_others" }, warnings: [] };
    }
  }
  if (doc.stageIndex < doc.stages.length - 1) {
    doc.stageIndex++;
    run.tx.putApproval(doc);
    audit(run, t, doc.recordId, "approval_stage", `Approved by ${stage.name}; waiting for ${doc.stages[doc.stageIndex]!.name}.`);
    return { status: "ok", commandId: run.env.id, recordId: doc.recordId, effects: { approval: "next_stage" }, warnings: [] };
  }
  doc.status = "approved";
  run.tx.putApproval(doc);
  await clear();
  audit(run, t, doc.recordId, "approval_approved", `Approved: ${doc.summary}`);
  // Carry out the original command as the person who asked, now approved.
  const original = doc.envelope;
  const replay: Run = { ...run, env: { ...original, approvalId: doc.id }, approved: true, warnings: [], effects: {} };
  const result = await handle(replay, original.command);
  if (result.status === "ok") result.effects = { ...result.effects, approval: "approved" };
  return result;
}

/* -------------------------------------------------------------- rules, data */

async function runRules(run: Run, t: CTarget, event: string, rec: StoredRecord) {
  let retotal = false;
  for (const rule of run.c.rules(t.target, event)) {
    if (rule.when && (await evalOn(run, t, rec, rule.when)) !== true) continue;
    const then = rule.then;
    switch (then.kind) {
      case "reject":
        throw new Fail("rule_rejected", then.message);
      case "warn":
        run.warnings.push({ ruleId: rule.id, message: then.message });
        break;
      case "set": {
        const f = t.fields.find((x) => x.key === then.field || x.id === then.field);
        if (!f) break;
        const v = await evalOn(run, t, rec, then.expr as ExprNode);
        rec.data[f.key] = f.type === "money" && typeof v === "number" ? toMinor(v) : v;
        retotal = true;
        break;
      }
      case "discount_percent": {
        const pct = await evalOn(run, t, rec, then.expr as ExprNode);
        if (typeof pct !== "number") break;
        for (const line of (rec.data.lines as Record<string, unknown>[] | undefined) ?? []) {
          if (!(typeof line.discount_pct === "number" && line.discount_pct >= pct)) line.discount_pct = pct;
        }
        run.warnings.push({ ruleId: rule.id, message: `${rule.label} applied.` });
        retotal = true;
        break;
      }
      case "notify":
        ((run.effects.notifications as unknown[]) ??= []).push({ roles: then.roles, message: then.message, ruleId: rule.id });
        break;
    }
  }
  if (retotal) await computeTotals(t, rec.data, run.tx);
}

async function computeFields(run: Run, t: CTarget, rec: StoredRecord) {
  const computed = t.fields.filter((f) => f.expr);
  if (!computed.length) return;
  for (const f of computed) rec.data[f.key] = await evalOn(run, t, rec, f.expr!);
}

/** Invoices and bills fall due after the party's payment terms, else the workspace default. */
async function defaultDueDate(run: Run, t: CTarget, rec: StoredRecord) {
  if (!t.fields.some((f) => f.key === "due_date") || rec.data.due_date || typeof rec.data.date !== "string") return;
  const partyKey = t.fields.some((f) => f.key === "customer") ? "customer" : t.fields.some((f) => f.key === "vendor") ? "vendor" : undefined;
  const party = partyKey && typeof rec.data[partyKey] === "string" ? await run.tx.get(partyKey, rec.data[partyKey] as string) : undefined;
  const terms = typeof party?.data.payment_terms_days === "number" ? party.data.payment_terms_days : run.c.bp.settings.sales.defaultPaymentTermsDays;
  const due = new Date(Date.parse(`${rec.data.date}T00:00:00Z`) + terms * 86_400_000);
  rec.data.due_date = due.toISOString().slice(0, 10);
}

async function assignNumber(run: Run, t: CTarget, rec: StoredRecord) {
  if (!t.numbering) return;
  const date = typeof rec.data.date === "string" ? rec.data.date : run.today;
  rec.number = formatNumber(t.numbering, await run.tx.nextSeq(sequenceKey(t.target, t.numbering, date)), date);
  if (t.fields.some((f) => f.key === "number")) rec.data.number = rec.number;
}

/**
 * Expression context for a record: its fields (money in major units), one
 * level of referenced records, and aggregates computed from the store.
 */
async function context(run: Run, t: CTarget, rec: StoredRecord, vars: Record<string, unknown> = {}, outer?: EvalContext): Promise<EvalContext> {
  const refs = new Map<string, { t: CTarget; rec: StoredRecord }>();
  for (const f of t.fields) {
    const v = rec.data[f.key];
    if (f.type !== "ref" || typeof v !== "string" || !f.to) continue;
    const rt = run.c.targets.get(f.to);
    const r = rt && (await run.tx.get(f.to, v));
    if (rt && r) refs.set(v, { t: rt, rec: r });
  }

  const read = (tt: CTarget, r: StoredRecord, parts: readonly string[]): unknown => {
    const [head, ...rest] = parts;
    if (head === undefined) return r.id;
    if (head === "id") return r.id;
    if (head === "status") return r.status ?? null;
    if (head === "number") return r.number ?? r.data.number ?? null;
    if (head === "created_at") return r.createdAt;
    if (head === "updated_at") return r.updatedAt;
    if (head === "created_by") return r.createdBy;
    const f = tt.fields.find((x) => x.key === head || x.id === head);
    const v = f ? r.data[f.key] : undefined;
    if (rest.length) {
      if (f?.type === "ref" && typeof v === "string") {
        const ref = refs.get(v);
        return ref ? read(ref.t, ref.rec, rest) : null;
      }
      return null;
    }
    return f?.type === "money" && typeof v === "number" ? fromMinor(v) : (v ?? null);
  };

  const ctx: EvalContext = {
    today: run.today,
    now: run.now.toISOString(),
    get(parts) {
      if (parts[0] && parts[0] in vars) return vars[parts[0]];
      if (parts[0] === "$user") return run.env.actor.id;
      if (parts[0] === "channel") return run.env.actor.channel;
      // `this.x` inside an aggregate's condition reads the outer record.
      if (parts[0] === "id" && parts.length > 1 && outer) return outer.get(parts.slice(1));
      return read(t, rec, parts);
    },
  };

  return ctx;
}

/**
 * Evaluate an expression on a record. Aggregates (count, sum, ...) need the
 * database, so they are worked out first and handed to the evaluator.
 */
async function evalOn(run: Run, t: CTarget, rec: StoredRecord, node: ExprNode, vars: Record<string, unknown> = {}): Promise<unknown> {
  const ctx = await context(run, t, rec, vars);
  const values = new Map<ExprNode, unknown>();
  for (const agg of exprReads(node).aggregates) {
    const at = run.c.targets.get(agg.target);
    if (!at) {
      values.set(agg, null);
      continue;
    }
    const nums: number[] = [];
    let count = 0;
    for (const cand of await run.tx.list(agg.target)) {
      if (agg.where && evaluate(agg.where, await context(run, at, cand, {}, ctx)) !== true) continue;
      count++;
      const f = agg.field ? at.fields.find((x) => x.key === agg.field) : undefined;
      const v = agg.field ? cand.data[agg.field] : undefined;
      if (typeof v === "number") nums.push(f?.type === "money" ? fromMinor(v) : v);
    }
    const sum = nums.reduce((s, v) => s + v, 0);
    const pick = { count, sum, avg: nums.length ? sum / nums.length : null, min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null };
    values.set(agg, pick[agg.fn]);
  }
  ctx.aggregate = (n) => values.get(n) ?? null;
  return evaluate(node, ctx);
}

/* ------------------------------------------------------------------- helpers */

function ok(run: Run, rec: StoredRecord): CommandResult {
  return { status: "ok", commandId: run.env.id, recordId: rec.id, version: rec.version, effects: { ...run.effects, number: rec.number, status: rec.status }, warnings: run.warnings };
}

function audit(run: Run, t: CTarget | undefined, recordId: string | undefined, action: string, summary: string) {
  const a: Actor = run.env.actor;
  run.tx.audit({
    id: run.newId("aud_"),
    at: run.now.toISOString(),
    commandId: run.env.id,
    actor: { id: a.id, name: a.displayName, kind: a.kind, channel: a.channel, roleKey: a.roleKey },
    target: t?.target ?? "",
    recordId,
    action,
    summary,
  });
}

function statusLabel(t: CTarget, rec: StoredRecord): string {
  return (t.states.find((s) => s.key === rec.status)?.label ?? rec.status ?? "saved").toLowerCase();
}

function humanAction(key: string): string {
  return key === "create" ? "Create" : key === "update" ? "Change" : key === "delete" ? "Delete" : key.replaceAll("_", " ");
}

function prefixOf(t: CTarget): string {
  return `${t.target.replace(/^ent_/, "").slice(0, 3)}_`;
}
