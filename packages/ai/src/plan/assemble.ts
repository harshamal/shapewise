import {
  Blueprint,
  COUNTRY_BY_CODE,
  CORE_RECORDS,
  EXTENSION_BY_KEY,
  MODULE_BY_KEY,
  PERM_ACTIONS,
  SUBMODULE_BY_KEY,
  SUBMODULE_FOR_RECORD,
  checkBlueprint,
  presetBlueprint,
  withRequirements,
  withoutSubmodules,
  type BlueprintInput,
  type Country,
  type SettingsInput,
  type TaxDecision,
  type CoreRecordKey,
  type ExtensionKey,
  type Issue,
  type PermAction,
} from "@shapewise/blueprint";
import type { BlueprintPlan, PlanField } from "./schema";

/**
 * Plan → blueprint, entirely in code. The model never writes an id or a
 * cross-reference by id: the assembler generates ids, resolves every
 * reference by key and reports anything it can't resolve. Each blueprint
 * element remembers which part of the plan produced it, so validation
 * problems can be reported back to the model, or salvaged, in plan terms.
 */

export interface PlanIssue {
  /** Path into the plan, e.g. ["rules", 2, "when"]; empty when not tied to one element. */
  planPath: (string | number)[];
  message: string;
}

export interface Assembly {
  input: BlueprintInput;
  /** Set when the result passes the validator with no errors. */
  blueprint?: Blueprint;
  issues: PlanIssue[];
  notes: string[];
}

type Path = (string | number)[];

/**
 * What code decides about a business outside the plan: where it is (currency,
 * locale, fiscal year), which taxes apply, and the controls its size wants.
 * Taxes always win over the plan; size controls only fill what the plan
 * leaves unset.
 */
export interface AssemblyContext {
  country?: Country;
  tax?: TaxDecision;
  sizeSettings?: SettingsInput;
  /** Keep the preset's approval rules (default). The AI path starts with none. */
  presetApprovals?: boolean;
}

export function assemble(plan: BlueprintPlan, ctx: AssemblyContext = {}): Assembly {
  const issues: PlanIssue[] = [];
  /** Things corrected automatically, shown to the person; not errors. */
  const notes: string[] = [];
  /** blueprint path prefix ("customFields.3") → plan path */
  const origin = new Map<string, Path>();
  const ids = new IdMaker();

  /* 1. start from the preset */
  const name = plan.businessName.trim().slice(0, 120) || "My business";
  if (name !== plan.businessName) notes.push(`Shortened the business name to "${name}".`);
  const where = ctx.country ?? COUNTRY_BY_CODE.get("LK")!;
  let bp = presetBlueprint(plan.preset, { name, currency: where.currency, locale: where.locale, timezone: where.timezone, industry: plan.industryDescription.trim().slice(0, 80) || undefined });
  bp.business = { ...bp.business, country: where.code, fiscalYearStartMonth: where.fiscalYearStartMonth };
  for (const r of bp.roles) ids.reserve(r.id);
  for (const a of bp.approvals ?? []) (ids.reserve(a.id), a.stages.forEach((s) => ids.reserve(s.id)));
  for (const v of bp.views ?? []) ids.reserve(v.id);
  for (const c of bp.customFields ?? []) ids.reserve(c.field.id);

  /* 2. modules and hidden screens */
  const on = new Set<string>([...[...MODULE_BY_KEY.values()].filter((m) => m.core).map((m) => m.key), ...plan.modules]);
  // A business registered for a tax needs the tax screens (returns, rates, certificates).
  const taxed = ctx.tax && Object.values(ctx.tax.settings).some(Boolean);
  if (taxed && !on.has("tax")) {
    on.add("tax");
    const t = ctx.tax!.settings;
    const names = [t.vatRegistered && "VAT", t.ssclRegistered && "SSCL", t.wht && "withholding tax"].filter(Boolean);
    notes.push(`Switched on Tax for your ${names.join(" and ")} returns.`);
  }
  bp.modules = [...on].map((key) => ({ key, enabled: true }));
  const hide = plan.hideSubmodules.filter((k) => on.has(SUBMODULE_BY_KEY.get(k)?.module ?? ""));
  bp = withoutSubmodules(bp, hide);

  /* 3. extensions, with their requirements, limited to modules that are on */
  const wanted = withRequirements(plan.extensions);
  const dropped = wanted.filter((k) => !EXTENSION_BY_KEY[k].needsModules.every((m) => on.has(m)));
  dropped.forEach((k) => notes.push(`Left out "${EXTENSION_BY_KEY[k].name}": it needs the ${EXTENSION_BY_KEY[k].needsModules.filter((m) => !on.has(m)).map((m) => MODULE_BY_KEY.get(m)?.label ?? m).join(" and ")} module.`));
  const extensions = new Set<ExtensionKey>(wanted.filter((k) => !dropped.includes(k)));
  // Custom fields (the preset's or the plan's) need their extension, whatever the plan listed.
  if ((bp.customFields ?? []).length || plan.customFields.length) extensions.add("custom_fields");
  bp.extensions = [...extensions];

  /* 4. settings: merge each group over the preset's */
  const s = (bp.settings ??= {}) as Record<string, Record<string, unknown> | undefined>;
  for (const [group, values] of Object.entries(ctx.sizeSettings ?? {})) if (values) s[group] = { ...(s[group] ?? {}), ...(values as object) };
  for (const [group, values] of Object.entries(plan.settings)) if (values) s[group] = { ...(s[group] ?? {}), ...values };
  if (ctx.tax) {
    s.tax = { ...ctx.tax.settings };
    if (plan.settings.tax && Object.entries(plan.settings.tax).some(([k, v]) => v !== undefined && (ctx.tax!.settings as Record<string, unknown>)[k] !== v)) notes.push("Taxes follow your registrations and turnover, not the design.");
    (bp.seed ??= {}).taxCodes = ctx.tax.taxCodes;
  }
  // The chart of accounts follows the modules: production needs WIP and scrap accounts, stock needs inventory accounts.
  const accounting = (s.accounting ??= {}) as { chartTemplate?: string };
  const chart = accounting.chartTemplate ?? "lk_trading";
  const neededChart = on.has("production") ? "lk_manufacturing" : on.has("inventory") && chart === "lk_services" ? "lk_trading" : chart;
  if (neededChart !== chart) notes.push(`Using the ${neededChart === "lk_manufacturing" ? "manufacturing" : "trading"} chart of accounts to match the modules.`);
  accounting.chartTemplate = neededChart;

  /* 5. record types first, so everything else can reference them */
  const recordIds = new Map<string, string>();
  plan.recordTypes.forEach((rt) => recordIds.set(rt.key, ids.make("ent", rt.key)));
  const resolveRecord = (key: string, path: Path): string | undefined => {
    if (key in CORE_RECORDS) return key;
    const id = recordIds.get(key);
    if (id) return id;
    issues.push({ planPath: path, message: `"${key}" isn't a record type. Use a core record key or one of: ${[...recordIds.keys()].join(", ") || "(none defined)"}.` });
    return undefined;
  };

  const toField = (f: PlanField, idBase: string, path: Path) => {
    const id = ids.make("fld", idBase);
    const base = { id, key: f.key, label: f.label, required: f.required || undefined, description: f.description, filterable: f.filterable || undefined };
    switch (f.type) {
      case "text":
        return { ...base, type: "text" as const, maxLength: f.maxLength };
      case "select":
      case "multiselect":
        if (!f.options?.length) issues.push({ planPath: [...path, "options"], message: `${f.label} is a list but has no options.` });
        return { ...base, type: f.type, options: dedupeOptions(f.options ?? [{ value: "other", label: "Other" }]) };
      case "ref": {
        const to = f.refTo ? resolveRecord(f.refTo, [...path, "refTo"]) : undefined;
        if (!f.refTo) issues.push({ planPath: [...path, "refTo"], message: `${f.label} is a reference but doesn't say what it points at.` });
        return { ...base, type: "ref" as const, to: to ?? "customer" };
      }
      case "quantity":
        return { ...base, type: "quantity" as const, unit: f.unit };
      default:
        return { ...base, type: f.type };
    }
  };

  /* 6. custom fields on core records */
  const custom: NonNullable<BlueprintInput["customFields"]> = [...(bp.customFields ?? [])];
  plan.customFields.forEach((cf0, i) => {
    const parts = CORE_RECORDS[cf0.record].customFields as readonly string[];
    let cf = cf0;
    if (!parts.includes(cf.part)) {
      if (!parts.length) return notes.push(`Left out "${cf.label}": ${CORE_RECORDS[cf.record].label} can't take extra details.`), undefined;
      cf = { ...cf, part: parts[0] as typeof cf.part };
      notes.push(`"${cf.label}" goes on the ${CORE_RECORDS[cf.record].label.toLowerCase()} itself, as it has no lines.`);
    }
    if (custom.some((c) => c.target === cf.record && (c.part ?? "header") === cf.part && c.field.key === cf.key)) return; // the preset already has it
    origin.set(`customFields.${custom.length}`, ["customFields", i]);
    custom.push({ target: cf.record, part: cf.part, showOnDocuments: cf.showOnDocuments, showInProduction: cf.showInProduction, field: toField(cf, cf.key, ["customFields", i]) as never });
  });
  bp.customFields = custom;

  /* 7. custom record types */
  bp.entities = plan.recordTypes.map((rt, i) => {
    origin.set(`entities.${i}`, ["recordTypes", i]);
    const fields = rt.fields.map((f, j) => toField(f, `${rt.key}_${f.key}`, ["recordTypes", i, "fields", j]));
    const fieldId = (key: string, path: Path) => {
      const f = fields.find((x) => x.key === key);
      if (!f) issues.push({ planPath: path, message: `"${key}" isn't one of ${rt.label}'s fields (${rt.fields.map((x) => x.key).join(", ")}).` });
      return f?.id ?? fields[0]!.id;
    };
    let workflow: NonNullable<BlueprintInput["entities"]>[number]["workflow"];
    if (rt.workflow) {
      const stateIds = new Map(rt.workflow.states.map((st) => [st.key, ids.make("st", `${rt.key}_${st.key}`)]));
      const stateId = (key: string, path: Path) => {
        const id = stateIds.get(key);
        if (!id) issues.push({ planPath: path, message: `"${key}" isn't one of ${rt.label}'s states (${[...stateIds.keys()].join(", ")}).` });
        return id ?? [...stateIds.values()][0]!;
      };
      const wp: Path = ["recordTypes", i, "workflow"];
      workflow = {
        states: rt.workflow.states.map((st) => ({ id: stateIds.get(st.key)!, key: st.key, label: st.label, tone: st.tone, terminal: st.terminal })),
        initial: stateId(rt.workflow.initial, [...wp, "initial"]),
        transitions: rt.workflow.transitions.map((t, k) => ({
          id: ids.make("tr", `${rt.key}_${t.key}`),
          key: t.key,
          label: t.label,
          from: t.from.map((f, m) => stateId(f, [...wp, "transitions", k, "from", m])),
          to: stateId(t.to, [...wp, "transitions", k, "to"]),
          permission: t.permission,
          requires: t.requiredFields?.map((f, m) => fieldId(f, [...wp, "transitions", k, "requiredFields", m])),
        })),
      };
    }
    return {
      id: recordIds.get(rt.key)!,
      key: rt.key,
      label: rt.label,
      labelPlural: rt.labelPlural,
      module: rt.module,
      titleField: fieldId(rt.titleField, ["recordTypes", i, "titleField"]),
      fields,
      workflow,
      numbering: rt.numberingPrefix ? { pattern: `${rt.numberingPrefix}-{seq:4}` } : undefined,
    };
  });

  /* 8. roles: replace by key, or add */
  const roles = [...bp.roles];
  plan.roles.forEach((r, i) => {
    const grants = toGrants(r.grants, recordIds, (j, message) => issues.push({ planPath: ["roles", i, "grants", j, "area"], message }), notes, r.label);
    const existing = roles.findIndex((x) => x.key === r.key);
    if (existing >= 0) {
      // The owner always keeps everything; a plan that restates it is ignored.
      if (roles[existing]!.owner) return;
      roles[existing] = { ...roles[existing]!, label: r.label, description: r.description, grants };
      origin.set(`roles.${existing}`, ["roles", i]);
    } else {
      origin.set(`roles.${roles.length}`, ["roles", i]);
      roles.push({ id: ids.make("rol", r.key), key: r.key, label: r.label, description: r.description, grants });
    }
  });
  bp.roles = roles;
  const roleId = (key: string, path: Path) => {
    const r = roles.find((x) => x.key === key);
    if (!r) issues.push({ planPath: path, message: `"${key}" isn't a role. Roles: ${roles.map((x) => x.key).join(", ")}.` });
    return r?.id ?? roles.find((x) => x.owner)!.id;
  };

  /* 9. approvals: a plan approval on the same record and action replaces the preset's */
  const approvals = ctx.presetApprovals === false ? [] : [...(bp.approvals ?? [])];
  plan.approvals.forEach((a0, i) => {
    let a = a0;
    const target = resolveRecord(a.record, ["approvals", i, "record"]);
    if (!target) return;
    const action = approvableAction(a.record, a.action);
    if (action === null) return notes.push(`Left out "${a.label}": ${a.action.replaceAll("_", " ")} on ${a.record.replaceAll("_", " ")} can't wait for approval.`), undefined;
    // Records without an amount (delivery notes, batches) can't have amount thresholds: every stage applies from the start.
    const noAmount = a.record in CORE_RECORDS && !CORE_RECORDS[a.record as CoreRecordKey].amountField;
    if (noAmount && a.stages.some((st) => st.minAmount > 0)) {
      a = { ...a, stages: a.stages.map((st) => ({ ...st, minAmount: 0 })), when: a.when && /\b(total|amount)\b/.test(a.when) ? undefined : a.when };
      notes.push(`"${a.label}" applies to every ${a.record.replaceAll("_", " ")}, as ${a.record.replaceAll("_", " ")}s have no amount.`);
    }
    if (action !== a.action) notes.push(`"${a.label}" applies when the ${a.record.replaceAll("_", " ")} is ${action.replaceAll("_", " ")}d, the step that can wait for approval.`);
    const value = {
      id: ids.make("apr", `${a.record}_${action}`),
      label: a.label,
      target,
      action,
      when: a.when,
      channels: a.onlyFor?.length ? a.onlyFor : undefined,
      stages: [...a.stages]
        .sort((x, y) => x.minAmount - y.minAmount)
        .map((st, j) => ({ id: ids.make("aps", `${a.action}_${j}`), name: st.name, minAmount: st.minAmount, requireAll: st.requireAll, roles: st.roles.map((rk, k) => roleId(rk, ["approvals", i, "stages", j, "roles", k])) })),
    };
    const same = approvals.findIndex((x) => x.target === target && x.action === action);
    if (same >= 0) approvals[same] = value;
    else approvals.push(value);
    origin.set(`approvals.${same >= 0 ? same : approvals.length - 1}`, ["approvals", i]);
  });
  bp.approvals = approvals;

  /* 10. rules */
  bp.rules = plan.rules.flatMap((r, i) => {
    const target = resolveRecord(r.record, ["rules", i, "record"]);
    if (!target) return [];
    const p: Path = ["rules", i];
    let then: NonNullable<BlueprintInput["rules"]>[number]["then"];
    switch (r.effect) {
      case "reject":
      case "warn":
        then = { kind: r.effect, message: r.message ?? r.label };
        break;
      case "notify":
        then = { kind: "notify", message: r.message ?? r.label, roles: (r.roles?.length ? r.roles : ["owner"]).map((rk, k) => roleId(rk, [...p, "roles", k])) };
        break;
      case "set":
        if (!r.field || !r.value) return issues.push({ planPath: p, message: `"Set" rules need a field and a value.` }), [];
        if (r.record in CORE_RECORDS && (r.field === "status" || CORE_RECORDS[r.record as CoreRecordKey].fields.some((f) => f.key === r.field && f.system)))
          return notes.push(`Left out the rule "${r.label}": ${r.field.replaceAll("_", " ")} is worked out by the system.`), [];
        then = { kind: "set", field: r.field, expr: r.value };
        break;
      case "discount_percent":
        if (!r.value) return issues.push({ planPath: p, message: "Discount rules need a value." }), [];
        then = { kind: "discount_percent", expr: r.value };
        break;
    }
    origin.set(`rules.${i}`, p);
    return [{ id: ids.make("rul", r.label), key: keyOf(r.label), label: r.label, target, on: r.on, when: r.when, then }];
  });
  // origin indexes for rules must follow the emitted order
  remapOrigins(origin, "rules", bp.rules.length);

  /* 11. views */
  const views = [...(bp.views ?? [])];
  plan.views.forEach((v, i) => {
    const target = resolveRecord(v.record, ["views", i, "record"]);
    if (!target) return;
    origin.set(`views.${views.length}`, ["views", i]);
    views.push({ id: ids.make("vw", v.label), target, label: v.label, type: v.type, columns: v.columns, groupBy: v.groupBy, dateField: v.dateField, filter: v.filter, default: v.type === "kanban" ? true : undefined });
  });
  bp.views = views;

  /* 12. starter data: the plan's lists replace the preset's where given */
  const seed = (bp.seed ??= {});
  const production = { ...(seed.production ?? {}) };
  for (const k of ["resources", "parameters", "operationTypes", "qcTemplates"] as const) if (plan.seed[k]?.length) (production as Record<string, unknown>)[k] = plan.seed[k];
  // Steps often name parameters that were never defined ("temperature"). Match them by code or name, else leave them off the step.
  const params = (production.parameters ?? []) as { code: string; name: string }[];
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  let unmatched = 0;
  production.operationTypes = (production.operationTypes ?? []).map((o) => ({
    ...o,
    params: o.params && [...new Set(o.params.flatMap((c) => {
      const hit = params.find((p) => p.code === c) ?? params.find((p) => norm(p.code) === norm(c) || norm(p.name) === norm(c));
      if (!hit) unmatched++;
      return hit ? [hit.code] : [];
    }))],
  }));
  if (unmatched) notes.push(`Left ${unmatched === 1 ? "a process reading" : `${unmatched} process readings`} off the production steps, as ${unmatched === 1 ? "it isn't" : "they aren't"} in the parameter library yet. Add them in Settings, Production.`);
  const resources = (production.resources ?? []) as { code: string; parent?: string }[];
  production.resources = resources.map((r) => (r.parent && !resources.some((x) => x.code === r.parent) ? { ...r, parent: undefined } : r)) as typeof production.resources;
  seed.production = production;

  /* 13. validate */
  const parsed = Blueprint.safeParse(bp);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ planPath: toPlanPath(origin, i.path as Path), message: `${i.path.join(".")}: ${i.message}` });
    return { input: bp, issues, notes };
  }
  for (const i of checkBlueprint(parsed.data)) {
    if (i.severity === "error") issues.push({ planPath: toPlanPath(origin, i.path), message: i.message });
  }
  return { input: bp, blueprint: issues.length ? undefined : parsed.data, issues, notes };
}

/**
 * The action an approval on a core record should wait on: the action itself
 * when it is approvable, the record's only approvable action when there is
 * just one, otherwise null. Custom record types and create/update/delete are
 * left to the validator.
 */
function approvableAction(record: string, action: string): string | null {
  if (!(record in CORE_RECORDS) || ["create", "update", "delete"].includes(action)) return action;
  const actions = CORE_RECORDS[record as CoreRecordKey].lifecycle?.actions ?? [];
  if (actions.some((x) => x.key === action && x.approvable)) return action;
  const approvable = actions.filter((x) => x.approvable && x.permission !== "void");
  return approvable.length === 1 ? approvable[0]!.key : null;
}

const ENTITY_ACTIONS: readonly PermAction[] = ["view", "create", "edit", "approve", "void", "manage"];

/**
 * Plan grants → blueprint grants. Models often name a whole module
 * ("production") or a record ("invoice") where a screen key ("invoices") is
 * meant, so the intent is resolved here: a module grants each of its screens,
 * a record grants the screen that lists it. Actions a screen doesn't have are
 * dropped (noted), never errors. Only areas that can't be resolved at all are
 * reported, with the valid choices.
 */
function toGrants(
  grants: BlueprintPlan["roles"][number]["grants"],
  recordIds: Map<string, string>,
  problem: (index: number, message: string) => void,
  notes: string[],
  roleLabel: string,
) {
  const out = new Map<string, Set<PermAction>>();
  const add = (target: string, allowed: readonly PermAction[], wanted: readonly PermAction[]) => {
    const keep = wanted.filter((a) => allowed.includes(a));
    if (!keep.length) return;
    const set = out.get(target) ?? new Set<PermAction>();
    keep.forEach((a) => set.add(a));
    out.set(target, set);
  };
  grants.forEach((g, j) => {
    const area = g.area.trim().toLowerCase();
    if (area === "*") return add("*", PERM_ACTIONS, g.actions);
    const entity = recordIds.get(area);
    if (entity) return add(entity, ENTITY_ACTIONS, g.actions);
    const sub = SUBMODULE_BY_KEY.get(area) ?? SUBMODULE_BY_KEY.get(SUBMODULE_FOR_RECORD.get(area as CoreRecordKey) ?? "") ?? SUBMODULE_BY_KEY.get(`${area}s`);
    if (sub) return add(sub.key, sub.actions, g.actions);
    const mod = MODULE_BY_KEY.get(area);
    if (mod) {
      for (const s of mod.submodules) add(s.key, s.actions, g.actions);
      return;
    }
    problem(j, `"${g.area}" isn't a screen or record type. Use a submodule key such as invoices, items, batches, sales_orders, customers, or a module key such as sales.`);
  });
  // Actions a screen doesn't have are simply left off: a quiet fix, not something the person needs to check.
  return [...out.entries()].map(([target, set]) => ({ target, actions: [...set] }));
}

/** The plan path for a blueprint path, via the longest known prefix. */
function toPlanPath(origin: Map<string, Path>, path: Issue["path"]): Path {
  for (let n = path.length; n > 0; n--) {
    const hit = origin.get(path.slice(0, n).join("."));
    if (hit) return [...hit];
  }
  return [];
}

/** Rules are emitted with flatMap, so re-key their origins by emitted position. */
function remapOrigins(origin: Map<string, Path>, prefix: string, _count: number) {
  const entries = [...origin.entries()].filter(([k]) => k.startsWith(`${prefix}.`));
  const planIdx = entries.map(([, v]) => v).sort((a, b) => Number(a[1]) - Number(b[1]));
  entries.forEach(([k]) => origin.delete(k));
  planIdx.forEach((p, i) => origin.set(`${prefix}.${i}`, p));
}

function keyOf(label: string): string {
  const k = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(k) ? k : `r_${k}`.slice(0, 40);
}

function dedupeOptions(options: { value: string; label: string }[]) {
  const seen = new Set<string>();
  return options.filter((o) => !seen.has(o.value) && seen.add(o.value));
}

/** Generates readable, unique, schema-valid ids: prefix_ + up to 24 [a-z0-9]. */
class IdMaker {
  private used = new Set<string>();
  reserve(id: string) {
    this.used.add(id);
  }
  make(prefix: string, base: string): string {
    const stem = base.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "x";
    let id = `${prefix}_${stem}`;
    for (let n = 2; this.used.has(id); n++) id = `${prefix}_${stem.slice(0, 20)}${n}`;
    this.used.add(id);
    return id;
  }
}
