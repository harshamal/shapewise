import { z } from "zod";
import {
  CORE_RECORDS,
  EXTENSION_BY_KEY,
  MODULE_BY_KEY,
  SUBMODULE_BY_KEY,
  applyOps,
  validateBlueprint,
  type Blueprint,
  type CoreRecordKey,
  type OverlayOp,
} from "@shapewise/blueprint";
import type { Llm, Usage } from "../llm";
import { undash } from "../onboarding/interview";
import { catalogueBrief } from "../onboarding/brief";
import { repairHints } from "../onboarding/design";
import { assemble, type PlanIssue } from "../plan/assemble";
import { BlueprintPlan, PlanApproval, PlanCustomField, PlanExtension, PlanField, PlanHideable, PlanModule, PlanRecordType, PlanRole, PlanRule, PlanSettings, PlanView } from "../plan/schema";

/**
 * The change studio: a change described in plain words ("add a vehicle
 * number to delivery notes", "a complaints register", "warn when an order is
 * over the credit limit") becomes a small plan, which code builds on top of
 * the live setup, validates and describes back in plain words before anyone
 * applies it. The model never edits the setup directly.
 */

const Key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const ChangePlan = z.object({
  understood: z.boolean().describe("false when this isn't a change to the setup, or it's too unclear"),
  question: z.string().max(240).describe("when not understood: one short question back. Empty otherwise"),
  summary: z.string().max(200).describe("the change in one plain sentence, as the owner would say it"),
  addModules: z.array(PlanModule).max(5).describe("modules to switch on"),
  removeModules: z.array(PlanModule).max(5).describe("modules to switch off"),
  addExtensions: z.array(PlanExtension).max(8).describe("features to switch on"),
  removeExtensions: z.array(PlanExtension).max(8).describe("features to switch off"),
  hideScreens: z.array(PlanHideable).max(10),
  showScreens: z.array(PlanHideable).max(10),
  renameScreens: z.array(z.object({ key: z.string().max(40), label: z.string().min(1).max(40) })).max(10).describe("submodule key and its new name"),
  settings: PlanSettings,
  customFields: z.array(PlanCustomField).max(20).describe("new fields on core records"),
  recordTypeFields: z.array(z.object({ recordType: Key.describe("an existing custom record type key"), field: PlanField })).max(20).describe("new fields on record types this business already has"),
  recordTypes: z.array(PlanRecordType).max(4).describe("new record types, only for things no core record covers"),
  removeFields: z.array(z.object({ record: z.string().max(40), key: Key })).max(10).describe("custom fields to remove: core record key or record type key, and the field key"),
  removeRecordTypes: z.array(Key).max(4),
  rules: z.array(PlanRule).max(10),
  views: z.array(PlanView).max(10),
  approvals: z.array(PlanApproval).max(5),
  roles: z.array(PlanRole).max(5).describe("roles to add, or existing roles (by key) whose access changes"),
});
export type ChangePlan = z.infer<typeof ChangePlan>;

export interface ChangeDraft {
  ok: true;
  summary: string;
  /** What changes, in plain words, worked out from the setups before and after. */
  lines: string[];
  notes: string[];
  blueprint: Blueprint;
  usage: Usage[];
}

export type ChangeResult = ChangeDraft | { ok: false; question?: string; message?: string; usage: Usage[] };

/** The live setup in a few lines, so the model knows what's there before it adds anything. */
export function setupBrief(bp: Blueprint): string {
  const on = bp.modules.filter((m) => m.enabled).map((m) => m.key);
  const hidden = bp.modules.flatMap((m) => m.submodules.filter((s) => s.enabled === false).map((s) => s.key));
  const fields = (Object.keys(CORE_RECORDS) as CoreRecordKey[])
    .map((k) => [k, bp.customFields.filter((c) => c.target === k).map((c) => `${c.field.key}${c.part === "line" ? " (line)" : ""}`)] as const)
    .filter(([, f]) => f.length)
    .map(([k, f]) => `- ${k}: ${f.join(", ")}`)
    .join("\n");
  const entities = bp.entities.map((e) => `- ${e.key} (${e.labelPlural}, in ${e.module}): ${e.fields.map((f) => f.key).join(", ")}${e.workflow ? ` | states ${e.workflow.states.map((s) => s.key).join(", ")}` : ""}`).join("\n");
  return `## This business's setup now
Name: ${bp.business.name}. Currency ${bp.business.currency}.
Modules on: ${on.join(", ")}.
Features on: ${bp.extensions.join(", ") || "none"}.
Hidden screens: ${hidden.join(", ") || "none"}.
Custom fields already on core records:
${fields || "(none)"}
Record types made for this business:
${entities || "(none)"}
Rules: ${bp.rules.map((r) => r.label).join("; ") || "none"}.
Approvals: ${bp.approvals.map((a) => a.label).join("; ") || "none"}.
Roles: ${bp.roles.map((r) => `${r.key} (${r.label})`).join(", ")}.`;
}

const SYSTEM = `You change the setup of a business system (Shapewise) when the owner asks, by writing a small change plan.
Only include what the request needs; leave every other list empty. The live setup stays as it is apart from your change.

Rules:
- A new detail on a core document (allergens on items) is a customField on that record. First check that record's fields in the catalogue below and its custom fields above: if one already holds that detail, don't add it again, and say so in the summary. Never recreate core records.
- A new detail on a record type the business already has goes in recordTypeFields.
- A new kind of record no core record covers (complaints, vehicle log, maintenance) is a recordType, with few, useful fields.
- Field keys snake_case, never one that already exists on that record.
- Rules and view filters only use fields that exist on that record (core fields, its custom fields, or ones you add now).
- Approvals only on actions marked (approvable).
- To hide or show a screen use hideScreens/showScreens; to switch a whole area off use removeModules.
- Removing a field or record type deletes it from the setup; only do it when clearly asked.
- If the request isn't a change to the setup (a question about data, a document to create), set understood false and say what to do instead.
- Labels and summary in plain words. Never use dashes as punctuation.

`;

const empty = { modules: [], hideSubmodules: [], extensions: [], customFields: [], recordTypes: [], roles: [], approvals: [], rules: [], views: [], seed: {}, assumptions: [] };

/** Builds a change plan on the live setup: switches and removals first, then the additions through the assembler. */
export function buildChange(bp: Blueprint, plan: ChangePlan): { blueprint?: Blueprint; issues: PlanIssue[]; notes: string[] } {
  const ops: OverlayOp[] = [
    ...plan.removeExtensions.map((key) => ({ op: "set_extension" as const, key, enabled: false })),
    ...plan.removeModules.map((key) => ({ op: "set_module" as const, key, enabled: false })),
    ...plan.showScreens.map((key) => ({ op: "set_submodule" as const, key, enabled: true })),
    ...plan.renameScreens.filter((r) => SUBMODULE_BY_KEY.has(r.key)).map((r) => ({ op: "set_submodule" as const, key: r.key, label: undash(r.label) })),
  ];
  let base = bp;
  const notes: string[] = [];
  // A "new" field the document already has (Vehicle number when delivery notes have Vehicle) is left out, with a note.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const same = (a: string, b: string) => {
    const [x, y] = [norm(a), norm(b)];
    return x === y || x.replace(/ (number|no|name|num)$/, "") === y || y.replace(/ (number|no|name|num)$/, "") === x;
  };
  plan = {
    ...plan,
    customFields: plan.customFields.filter((cf) => {
      const r = CORE_RECORDS[cf.record];
      const existing = [...r.fields, ...(cf.part === "line" ? (r.lines?.fields ?? []) : []), ...bp.customFields.filter((c) => c.target === cf.record).map((c) => c.field)];
      const dup = existing.find((f) => same(f.key, cf.key) || same(f.label, cf.label));
      if (dup) notes.push(`${r.labelPlural} already have "${dup.label}", so "${cf.label}" wasn't added.`);
      return !dup;
    }),
  };
  // Removals edit the setup directly; the validator below refuses one that something still uses.
  if (plan.removeFields.length || plan.removeRecordTypes.length) {
    const next = structuredClone(bp);
    for (const r of plan.removeFields) {
      const entity = next.entities.find((e) => e.key === r.record);
      if (entity) entity.fields = entity.fields.filter((f) => f.key !== r.key);
      else next.customFields = next.customFields.filter((c) => !(c.target === r.record && c.field.key === r.key));
    }
    next.entities = next.entities.filter((e) => !plan.removeRecordTypes.includes(e.key));
    base = next;
  }
  if (ops.length) {
    const r = applyOps(base, ops);
    if (!r.ok) return { issues: r.issues.map((i) => ({ planPath: [], message: i.message })), notes };
    base = r.blueprint;
  }
  const assembled = assemble(
    {
      ...empty,
      businessName: bp.business.name,
      industryDescription: bp.business.industry ?? "",
      preset: "general",
      modules: plan.addModules,
      extensions: plan.addExtensions,
      hideSubmodules: plan.hideScreens,
      settings: plan.settings,
      customFields: plan.customFields,
      recordTypes: plan.recordTypes,
      roles: plan.roles,
      approvals: plan.approvals,
      rules: plan.rules,
      views: plan.views,
    } as BlueprintPlan,
    { base },
  );
  notes.push(...assembled.notes);
  if (!assembled.blueprint) return { issues: assembled.issues, notes };
  let out = assembled.blueprint;
  // Fields on record types the business already has.
  if (plan.recordTypeFields.length) {
    const next = structuredClone(out);
    const issues: PlanIssue[] = [];
    plan.recordTypeFields.forEach((rf, i) => {
      const e = next.entities.find((x) => x.key === rf.recordType);
      if (!e) return issues.push({ planPath: ["recordTypeFields", i, "recordType"], message: `"${rf.recordType}" isn't one of this business's record types: ${next.entities.map((x) => x.key).join(", ") || "none"}.` });
      if (e.fields.some((f) => f.key === rf.field.key)) return issues.push({ planPath: ["recordTypeFields", i, "field", "key"], message: `${e.label} already has a field "${rf.field.key}".` });
      e.fields.push(toEntityField(rf.field, next) as never);
    });
    if (issues.length) return { issues, notes };
    const checked = validateBlueprint(next);
    if (!checked.ok || !checked.blueprint) return { issues: checked.issues.filter((i) => i.severity === "error").map((i) => ({ planPath: ["recordTypeFields"], message: i.message })), notes };
    out = checked.blueprint;
  }
  return { blueprint: { ...out, version: bp.version }, issues: [], notes };
}

function toEntityField(f: z.infer<typeof PlanField>, bp: Blueprint) {
  const id = `fld_${f.key.replace(/_/g, "").slice(0, 14)}${Math.random().toString(36).slice(2, 7)}`;
  const base = { id, key: f.key, label: undash(f.label), required: f.required || undefined, description: f.description, filterable: f.filterable || undefined };
  switch (f.type) {
    case "select":
    case "multiselect":
      return { ...base, type: f.type, options: (f.options?.length ? f.options : [{ value: "other", label: "Other" }]).map((o) => ({ value: o.value, label: undash(o.label) })) };
    case "ref":
      return { ...base, type: "ref", to: f.refTo && !(f.refTo in CORE_RECORDS) ? (bp.entities.find((e) => e.key === f.refTo)?.id ?? "customer") : (f.refTo ?? "customer") };
    case "quantity":
      return { ...base, type: "quantity", unit: f.unit };
    case "text":
      return { ...base, type: "text", maxLength: f.maxLength };
    default:
      return { ...base, type: f.type };
  }
}

/** What a change does, in plain words, worked out by comparing the setups (never taken from the model). */
export function describeChange(before: Blueprint, after: Blueprint): string[] {
  const lines: string[] = [];
  const rec = (t: string) => (t in CORE_RECORDS ? CORE_RECORDS[t as CoreRecordKey].labelPlural.toLowerCase() : (after.entities.find((e) => e.id === t)?.labelPlural ?? before.entities.find((e) => e.id === t)?.labelPlural ?? t).toLowerCase());
  const on = (bp: Blueprint) => new Set(bp.modules.filter((m) => m.enabled).map((m) => m.key));
  const [mb, ma] = [on(before), on(after)];
  for (const m of ma) if (!mb.has(m)) lines.push(`Switches on ${MODULE_BY_KEY.get(m)?.label ?? m}.`);
  for (const m of mb) if (!ma.has(m)) lines.push(`Switches off ${MODULE_BY_KEY.get(m)?.label ?? m}.`);
  for (const x of after.extensions) if (!before.extensions.includes(x)) lines.push(`Turns on ${EXTENSION_BY_KEY[x].name}.`);
  for (const x of before.extensions) if (!after.extensions.includes(x)) lines.push(`Turns off ${EXTENSION_BY_KEY[x].name}.`);
  const subs = (bp: Blueprint) => new Map(bp.modules.flatMap((m) => m.submodules.map((s) => [s.key, s] as const)));
  const [sb, sa] = [subs(before), subs(after)];
  for (const [k, s] of sa) {
    const was = sb.get(k);
    const name = SUBMODULE_BY_KEY.get(k)?.label ?? k;
    if (s.enabled === false && was?.enabled !== false) lines.push(`Hides ${name}.`);
    if (s.enabled !== false && was?.enabled === false) lines.push(`Shows ${name} again.`);
    if (s.label && s.label !== was?.label) lines.push(`Renames ${name} to "${s.label}".`);
  }
  const cf = (bp: Blueprint) => new Map(bp.customFields.map((c) => [`${c.target}.${c.field.key}`, c] as const));
  const [cb, ca] = [cf(before), cf(after)];
  for (const [k, c] of ca) if (!cb.has(k)) lines.push(`Adds "${c.field.label}" to ${rec(c.target)}${c.part === "line" ? ", on each line" : ""}.`);
  for (const [k, c] of cb) if (!ca.has(k)) lines.push(`Removes "${c.field.label}" from ${rec(c.target)}.`);
  for (const e of after.entities) {
    const was = before.entities.find((x) => x.id === e.id);
    if (!was) lines.push(`Adds ${e.labelPlural} (${e.fields.map((f) => f.label).join(", ")})${e.workflow ? `, going through ${e.workflow.states.map((s) => s.label).join(", ")}` : ""}.`);
    else for (const f of e.fields) if (!was.fields.some((x) => x.id === f.id)) lines.push(`Adds "${f.label}" to ${e.labelPlural.toLowerCase()}.`);
    if (was) for (const f of was.fields) if (!e.fields.some((x) => x.id === f.id)) lines.push(`Removes "${f.label}" from ${e.labelPlural.toLowerCase()}.`);
  }
  for (const e of before.entities) if (!after.entities.some((x) => x.id === e.id)) lines.push(`Removes ${e.labelPlural}.`);
  for (const r of after.rules) if (!before.rules.some((x) => x.id === r.id)) lines.push(`New rule on ${rec(r.target)}: ${r.label}.`);
  for (const v of after.views) if (!before.views.some((x) => x.id === v.id)) lines.push(`New ${v.type} view of ${rec(v.target)}: ${v.label}.`);
  for (const a of after.approvals) if (!before.approvals.some((x) => x.id === a.id)) lines.push(`New approval: ${a.label}.`);
  for (const r of after.roles) {
    const was = before.roles.find((x) => x.id === r.id);
    if (!was) lines.push(`New role: ${r.label}.`);
    else if (JSON.stringify(was.grants) !== JSON.stringify(r.grants)) lines.push(`Changes what ${r.label} can do.`);
  }
  for (const g of Object.keys(after.settings) as (keyof Blueprint["settings"])[])
    for (const [k, v] of Object.entries(after.settings[g] as object)) {
      const was = (before.settings[g] as Record<string, unknown>)[k];
      if (JSON.stringify(was) !== JSON.stringify(v)) lines.push(`Sets ${g} › ${k.replace(/([A-Z])/g, " $1").toLowerCase()} to ${JSON.stringify(v)}.`);
    }
  return lines.map(undash);
}

export async function draftChange(llm: Llm, bp: Blueprint, request: string, opts: { maxRepairs?: number } = {}): Promise<ChangeResult> {
  const usage: Usage[] = [];
  const system = `${SYSTEM}${setupBrief(bp)}\n\n${catalogueBrief()}`;
  const messages = [{ role: "user" as const, text: request.slice(0, 2000) }];
  let { value, usage: u } = await llm.json({ tier: "design", system, messages, schema: ChangePlan, temperature: 0.2 });
  usage.push(u);
  if (!value.understood) return { ok: false, question: undash(value.question || "What would you like to change?"), usage };
  for (let round = 0; ; round++) {
    const built = buildChange(bp, value);
    if (built.blueprint) {
      const lines = describeChange(bp, built.blueprint);
      if (!lines.length) return { ok: false, message: "That wouldn't change anything in the setup.", usage };
      return { ok: true, summary: undash(value.summary), lines, notes: built.notes.map(undash), blueprint: built.blueprint, usage };
    }
    if (round >= (opts.maxRepairs ?? 2)) return { ok: false, message: `I couldn't make that change work: ${built.issues[0]?.message ?? "it doesn't fit the setup"}`, usage };
    const fixed = await llm.json({
      tier: "design",
      system,
      messages: [
        ...messages,
        {
          role: "user" as const,
          text: `Your change plan has problems. Fix them and return the whole corrected plan.\n\nProblems:\n${built.issues.map((i) => `- ${i.planPath.join(".") || "(general)"}: ${i.message}`).join("\n")}${repairHints({ ...empty, ...value } as never, built.issues)}\n\nPlan (JSON):\n${JSON.stringify(value)}`,
        },
      ],
      schema: ChangePlan,
      temperature: 0.1,
    });
    usage.push(fixed.usage);
    value = fixed.value;
  }
}
