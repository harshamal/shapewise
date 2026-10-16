import { z } from "zod";
import { checkExpr, evaluate, exprReads, type EvalContext, type ExprNode } from "@shapewise/blueprint";
import { fromMinor, titleOf, type CField, type Compiled, type CTarget, type Store, type StoredRecord } from "@shapewise/runtime";
import type { ToolSpec } from "../llm";

/**
 * The assistant's tools, generated per workspace and per person. They read
 * only record types the person's role can view, filter with Shapewise
 * expressions (type-checked, never code), and never write: changes come back
 * as proposals the person confirms, then run through the command pipeline.
 */

export interface ToolContext {
  compiled: Compiled;
  store: Store;
  tenant: string;
  roleKey: string;
  today: string;
  now: string;
}

export interface Proposal {
  id: string;
  kind: "create" | "update" | "action" | "convert";
  record: string;
  recordLabel: string;
  recordId?: string;
  action?: string;
  to?: string;
  data?: Record<string, unknown>;
  summary: string;
}

const MAX_ROWS = 50;

/** Record types this person may read, keyed the way the model refers to them. */
export function visibleTargets(ctx: Pick<ToolContext, "compiled" | "roleKey">): Map<string, CTarget> {
  const out = new Map<string, CTarget>();
  for (const t of ctx.compiled.targets.values()) {
    if (!ctx.compiled.can(ctx.roleKey, t.submodule, "view")) continue;
    out.set(t.kind === "custom" ? t.submodule : t.target, t);
  }
  return out;
}

export function toolSpecs(ctx: Pick<ToolContext, "compiled" | "roleKey">): ToolSpec[] {
  const records = [...visibleTargets(ctx).keys()];
  const record = { type: "string", enum: records, description: "record type key" };
  return [
    {
      name: "search_records",
      description: "Find records of one type. Returns up to 50 rows with their main fields. Use `where` to filter with a Shapewise expression over that record's field keys.",
      parameters: {
        type: "object",
        properties: {
          record,
          where: { type: "string", description: "e.g. status = 'posted' and due_date < today() and amount_due > 0; customer.name = 'Perera Stores'" },
          order_by: { type: "string", description: "field key to sort by" },
          descending: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: MAX_ROWS },
        },
        required: ["record"],
      },
    },
    {
      name: "get_record",
      description: "Read one record in full, including its lines.",
      parameters: { type: "object", properties: { record, id: { type: "string" } }, required: ["record", "id"] },
    },
    {
      name: "summarise",
      description: "Count records, or sum/average/min/max a number field, optionally filtered and grouped by a field (e.g. sales by customer).",
      parameters: {
        type: "object",
        properties: {
          record,
          measure: { type: "string", enum: ["count", "sum", "avg", "min", "max"] },
          field: { type: "string", description: "number field for sum/avg/min/max" },
          where: { type: "string" },
          group_by: { type: "string", description: "field key to group by" },
        },
        required: ["record", "measure"],
      },
    },
    {
      name: "propose_change",
      description:
        "Propose creating or changing a record, running an action (e.g. post, confirm) or converting one record into another. Nothing happens until the person confirms; validation and approval rules still apply then.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["create", "update", "action", "convert"] },
          record,
          id: { type: "string", description: "record id for update, action and convert" },
          action: { type: "string", description: "action key for kind=action" },
          to: { type: "string", description: "target record type for kind=convert" },
          data: { type: "object", description: "field values by field key; money in rupees; lines as arrays of objects" },
          summary: { type: "string", description: "one sentence the person will read before confirming" },
        },
        required: ["kind", "record", "summary"],
      },
    },
  ];
}

/* ---------------------------------------------------------------- execution */

const SearchArgs = z.object({ record: z.string(), where: z.string().max(300).optional(), order_by: z.string().optional(), descending: z.boolean().optional(), limit: z.number().int().min(1).max(MAX_ROWS).optional() });
const GetArgs = z.object({ record: z.string(), id: z.string().max(64) });
const SummariseArgs = z.object({ record: z.string(), measure: z.enum(["count", "sum", "avg", "min", "max"]), field: z.string().optional(), where: z.string().max(300).optional(), group_by: z.string().optional() });
const ProposeArgs = z.object({
  kind: z.enum(["create", "update", "action", "convert"]),
  record: z.string(),
  id: z.string().max(64).optional(),
  action: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().min(1).max(300),
});

export class ToolFailure extends Error {}

export async function runTool(ctx: ToolContext, name: string, rawArgs: unknown, proposals: Proposal[]): Promise<unknown> {
  try {
    switch (name) {
      case "search_records":
        return await search(ctx, parse(SearchArgs, rawArgs));
      case "get_record":
        return await getOne(ctx, parse(GetArgs, rawArgs));
      case "summarise":
        return await summarise(ctx, parse(SummariseArgs, rawArgs));
      case "propose_change":
        return propose(ctx, parse(ProposeArgs, rawArgs), proposals);
      default:
        throw new ToolFailure(`Unknown tool "${name}".`);
    }
  } catch (e) {
    if (e instanceof ToolFailure) return { error: e.message };
    throw e;
  }
}

function parse<T extends z.ZodType>(schema: T, v: unknown): z.infer<T> {
  const r = schema.safeParse(v);
  if (!r.success) throw new ToolFailure(`Invalid arguments: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

function targetOf(ctx: ToolContext, key: string): CTarget {
  const t = visibleTargets(ctx).get(key);
  if (!t) throw new ToolFailure(`"${key}" isn't a record type you can see. Available: ${[...visibleTargets(ctx).keys()].join(", ")}.`);
  return t;
}

/** Parse and type-check a filter against the record's fields. */
function filterFor(ctx: ToolContext, t: CTarget, where: string | undefined): ExprNode | undefined {
  if (!where) return undefined;
  const r = checkExpr(where, { target: t.target, fields: (x) => ctx.compiled.resolved.exprFields(x), vars: { $user: { t: "user" } } }, "boolean");
  if (r.problems.length) throw new ToolFailure(`The filter has problems: ${r.problems.map((p) => p.message).join(" ")}`);
  if (exprReads(r.ast!).aggregates.length) throw new ToolFailure("Filters can't use count() or sum(); use the summarise tool instead.");
  return r.ast!;
}

/** Records plus the records they reference (one level), for filters and display. */
async function loadWithRefs(ctx: ToolContext, t: CTarget, recs: StoredRecord[]) {
  const refs = new Map<string, { t: CTarget; rec: StoredRecord }>();
  await ctx.store.read(ctx.tenant, async (tx) => {
    for (const rec of recs)
      for (const f of t.fields) {
        const v = rec.data[f.key];
        if (f.type !== "ref" || typeof v !== "string" || !f.to || refs.has(v)) continue;
        const rt = ctx.compiled.targets.get(f.to);
        const r = rt && (await tx.get(f.to, v));
        if (rt && r) refs.set(v, { t: rt, rec: r });
      }
  });
  return refs;
}

function evalCtx(ctx: ToolContext, t: CTarget, rec: StoredRecord, refs: Map<string, { t: CTarget; rec: StoredRecord }>): EvalContext {
  const read = (tt: CTarget, r: StoredRecord, parts: readonly string[]): unknown => {
    const [head, ...rest] = parts;
    if (!head || head === "id") return r.id;
    if (head === "status") return r.status ?? null;
    if (head === "number") return r.number ?? null;
    if (head === "created_at") return r.createdAt;
    if (head === "created_by") return r.createdBy;
    const f = tt.fields.find((x) => x.key === head);
    const v = f ? r.data[f.key] : undefined;
    if (rest.length) {
      const ref = f?.type === "ref" && typeof v === "string" ? refs.get(v) : undefined;
      return ref ? read(ref.t, ref.rec, rest) : null;
    }
    return f?.type === "money" && typeof v === "number" ? fromMinor(v) : (v ?? null);
  };
  return { today: ctx.today, now: ctx.now, get: (parts) => (parts[0] === "$user" ? null : read(t, rec, parts)) };
}

/** A record's fields as plain values: money in rupees, references as titles. */
function present(t: CTarget, rec: StoredRecord, refs: Map<string, { t: CTarget; rec: StoredRecord }>, fields: readonly CField[] = t.fields) {
  const out: Record<string, unknown> = { id: rec.id, title: titleOf(t, rec) };
  if (rec.status) out.status = rec.status;
  for (const f of fields) {
    const v = rec.data[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "money" && typeof v === "number") out[f.key] = fromMinor(v);
    else if (f.type === "ref" && typeof v === "string") out[f.key] = refs.get(v) ? titleOf(refs.get(v)!.t, refs.get(v)!.rec) : v;
    else out[f.key] = v;
  }
  if (rec.pendingApproval) out.awaiting_approval = true;
  return out;
}

async function search(ctx: ToolContext, a: z.infer<typeof SearchArgs>) {
  const t = targetOf(ctx, a.record);
  const filter = filterFor(ctx, t, a.where);
  const all = await ctx.store.read(ctx.tenant, (tx) => tx.list(t.target));
  const refs = await loadWithRefs(ctx, t, all);
  let rows = filter ? all.filter((r) => evaluate(filter, evalCtx(ctx, t, r, refs)) === true) : all;
  if (a.order_by) {
    const f = t.fields.find((x) => x.key === a.order_by);
    if (!f && !["created_at", "updated_at", "status", "number"].includes(a.order_by)) throw new ToolFailure(`"${a.order_by}" isn't a field of ${t.label}.`);
    const key = (r: StoredRecord) => (a.order_by === "created_at" ? r.createdAt : a.order_by === "updated_at" ? r.updatedAt : a.order_by === "status" ? r.status : a.order_by === "number" ? r.number : r.data[a.order_by!]) as string | number | undefined;
    rows = [...rows].sort((x, y) => cmp(key(x), key(y)) * (a.descending ? -1 : 1));
  } else rows = [...rows].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  const limit = a.limit ?? 20;
  const brief = t.fields.filter((f) => !["longtext", "lines", "file", "image"].includes(f.type)).slice(0, 10);
  return { record: a.record, matched: rows.length, showing: Math.min(limit, rows.length), rows: rows.slice(0, limit).map((r) => present(t, r, refs, brief)) };
}

async function getOne(ctx: ToolContext, a: z.infer<typeof GetArgs>) {
  const t = targetOf(ctx, a.record);
  const rec = await ctx.store.read(ctx.tenant, (tx) => tx.get(t.target, a.id));
  if (!rec) throw new ToolFailure(`No ${t.label.toLowerCase()} with id ${a.id}.`);
  const refs = await loadWithRefs(ctx, t, [rec]);
  const out = present(t, rec, refs);
  for (const l of [t.lines, ...t.children]) {
    if (!l) continue;
    const rows = (rec.data[l.key] as Record<string, unknown>[] | undefined) ?? [];
    out[l.key] = rows.map((row) => Object.fromEntries(l.fields.filter((f) => row[f.key] !== undefined && row[f.key] !== null).map((f) => [f.key, f.type === "money" && typeof row[f.key] === "number" ? fromMinor(row[f.key] as number) : row[f.key]])));
  }
  out.number = rec.number;
  return out;
}

async function summarise(ctx: ToolContext, a: z.infer<typeof SummariseArgs>) {
  const t = targetOf(ctx, a.record);
  const filter = filterFor(ctx, t, a.where);
  const field = a.field ? t.fields.find((f) => f.key === a.field) : undefined;
  if (a.measure !== "count") {
    if (!field) throw new ToolFailure(`${a.measure} needs a number field of ${t.label}.`);
    if (!["integer", "decimal", "money", "quantity", "percent"].includes(field.type)) throw new ToolFailure(`"${field.key}" isn't a number field.`);
  }
  const groupField = a.group_by ? t.fields.find((f) => f.key === a.group_by) : undefined;
  if (a.group_by && !groupField && a.group_by !== "status") throw new ToolFailure(`"${a.group_by}" isn't a field of ${t.label}.`);

  const all = await ctx.store.read(ctx.tenant, (tx) => tx.list(t.target));
  const refs = await loadWithRefs(ctx, t, all);
  const rows = filter ? all.filter((r) => evaluate(filter, evalCtx(ctx, t, r, refs)) === true) : all;
  const value = (r: StoredRecord) => {
    const v = field ? r.data[field.key] : undefined;
    return typeof v === "number" ? (field!.type === "money" ? fromMinor(v) : v) : undefined;
  };
  const agg = (rs: StoredRecord[]) => {
    if (a.measure === "count") return rs.length;
    const nums = rs.map(value).filter((v): v is number => v !== undefined);
    if (!nums.length) return null;
    const sum = nums.reduce((s, v) => s + v, 0);
    return round(a.measure === "sum" ? sum : a.measure === "avg" ? sum / nums.length : a.measure === "min" ? Math.min(...nums) : Math.max(...nums));
  };
  if (!a.group_by) return { record: a.record, measure: a.measure, field: a.field, value: agg(rows), records: rows.length, unit: field?.type === "money" ? "Rs" : undefined };

  const groups = new Map<string, StoredRecord[]>();
  for (const r of rows) {
    const raw = a.group_by === "status" ? r.status : r.data[a.group_by];
    const label = groupField?.type === "ref" && typeof raw === "string" && refs.get(raw) ? titleOf(refs.get(raw)!.t, refs.get(raw)!.rec) : raw === undefined || raw === null || raw === "" ? "(none)" : String(raw);
    groups.set(label, [...(groups.get(label) ?? []), r]);
  }
  const out = [...groups.entries()].map(([group, rs]) => ({ group, value: agg(rs), records: rs.length })).sort((x, y) => Number(y.value ?? 0) - Number(x.value ?? 0));
  return { record: a.record, measure: a.measure, field: a.field, group_by: a.group_by, groups: out.slice(0, 25), more: Math.max(0, out.length - 25), unit: field?.type === "money" ? "Rs" : undefined };
}

function propose(ctx: ToolContext, a: z.infer<typeof ProposeArgs>, proposals: Proposal[]) {
  const t = targetOf(ctx, a.record);
  if (a.kind !== "create" && !a.id) throw new ToolFailure("Give the id of the record to change.");
  if (a.kind === "action" && !t.actions.some((x) => x.key === a.action)) throw new ToolFailure(`"${a.action}" isn't an action on ${t.labelPlural}. Actions: ${t.actions.map((x) => x.key).join(", ") || "none"}.`);
  if (a.kind === "convert" && !t.convertsTo.some((c) => c.to === a.to)) throw new ToolFailure(`${t.labelPlural} can't be turned into "${a.to}".`);
  const need = a.kind === "create" ? "create" : a.kind === "update" ? "edit" : a.kind === "action" ? t.actions.find((x) => x.key === a.action)!.permission : "create";
  const checkSub = a.kind === "convert" ? ctx.compiled.targets.get(a.to!)?.submodule : t.submodule;
  if (!checkSub || !ctx.compiled.can(ctx.roleKey, checkSub, need)) throw new ToolFailure(`Your role can't do that (${need} on ${checkSub ?? a.to}).`);
  const p: Proposal = {
    id: `prp_${proposals.length + 1}_${Date.now().toString(36)}`,
    kind: a.kind,
    record: t.target,
    recordLabel: t.label,
    recordId: a.id,
    action: a.action,
    to: a.to,
    data: a.data,
    summary: a.summary,
  };
  proposals.push(p);
  return { proposed: true, proposalId: p.id, note: "Shown to the person to confirm. Tell them what it will do; don't claim it's done." };
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
}

const round = (n: number) => Math.round(n * 100) / 100;
