import type { PermAction } from "./catalogue/actions";
import { EXTENSION_BY_KEY, type ExtensionKey } from "./catalogue/extensions";
import { MODULE_BY_KEY, SUBMODULE_BY_KEY, SUBMODULE_FOR_RECORD, SUBMODULE_NEEDS_MODULE } from "./catalogue/modules";
import { CHART_TEMPLATE_KEYS, chartAccounts, chartLabel, requiredRoles } from "./catalogue/accounts";
import { countryFor, taxRoles, taxesOf } from "./jurisdiction";
import { CORE_RECORDS, type CoreRecordKey } from "./catalogue/records";
import { checkExpr, fieldExprType, type ExprType } from "./expr";
import type { Field, FieldType } from "./fields";
import { Blueprint, type BlueprintInput, type Entity } from "./schema";

/**
 * Semantic validation: everything the Zod schema can't express. Messages are
 * written for the person (and for the AI repair loop), with a path into the
 * blueprint so the generator knows exactly what to fix.
 */

export interface Issue {
  path: (string | number)[];
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  ok: boolean;
  blueprint?: Blueprint;
  issues: Issue[];
}

const GENERIC_ACTIONS = ["create", "update", "delete"] as const;
const ENTITY_PERMS: readonly PermAction[] = ["view", "create", "edit", "approve", "void", "manage"];
const NUMERIC: readonly FieldType[] = ["integer", "decimal", "money", "quantity", "percent"];
const DATES: readonly FieldType[] = ["date", "datetime"];
const ALWAYS_FIELDS: Record<string, FieldType> = { status: "select", created_at: "datetime", updated_at: "datetime", created_by: "user" };

/** Parse, then check. */
export function validateBlueprint(input: BlueprintInput | unknown): ValidationResult {
  const parsed = Blueprint.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)), message: i.message, severity: "error" as const })),
    };
  }
  const issues = checkBlueprint(parsed.data);
  return { ok: !issues.some((i) => i.severity === "error"), blueprint: parsed.data, issues };
}

/** The resolved view of a blueprint that checks (and later the compiler) work against. */
export class Resolved {
  readonly modules = new Set<string>();
  readonly extensions: Set<ExtensionKey>;
  readonly entities: Map<string, Entity>;
  readonly customModules: Set<string>;

  constructor(readonly bp: Blueprint) {
    for (const m of bp.modules) if (m.enabled) this.modules.add(m.key);
    for (const m of MODULE_BY_KEY.values()) if (m.core) this.modules.add(m.key);
    this.extensions = new Set(bp.extensions);
    this.entities = new Map(bp.entities.map((e) => [e.id, e]));
    this.customModules = new Set(bp.customModules.map((m) => m.id));
  }

  submoduleEnabled(key: string): boolean {
    const sub = SUBMODULE_BY_KEY.get(key);
    if (!sub || !this.modules.has(sub.module)) return false;
    const needs = SUBMODULE_NEEDS_MODULE[key];
    if (needs && !this.modules.has(needs)) return false;
    if (sub.extension && !this.extensions.has(sub.extension)) return false;
    if (sub.core) return true;
    const override = this.bp.modules.find((m) => m.key === sub.module)?.submodules.find((s) => s.key === key);
    // An extension's screens come on with the extension, as in SyncBooks.
    return override?.enabled ?? (sub.extension ? true : (sub.default ?? true));
  }

  recordEnabled(record: CoreRecordKey): boolean {
    const sub = SUBMODULE_FOR_RECORD.get(record);
    return sub ? this.submoduleEnabled(sub) : true;
  }

  isTarget(target: string): boolean {
    return target in CORE_RECORDS || this.entities.has(target);
  }

  /** Header fields of a target by key and custom-field id, with their types. */
  fields(target: string): Map<string, { type: FieldType; system?: boolean }> {
    const out = new Map<string, { type: FieldType; system?: boolean }>(Object.entries(ALWAYS_FIELDS).map(([k, t]) => [k, { type: t, system: true }]));
    if (target in CORE_RECORDS) {
      const rec = CORE_RECORDS[target as CoreRecordKey];
      for (const f of rec.fields) out.set(f.key, { type: f.type, system: f.system });
      for (const cf of this.bp.customFields) {
        if (cf.target !== target || cf.part !== "header") continue;
        const type = cf.field.type === "computed" ? cf.field.resultType : cf.field.type;
        out.set(cf.field.key, { type });
        out.set(cf.field.id, { type });
      }
    } else {
      for (const f of this.entities.get(target)?.fields ?? []) {
        const type = f.type === "computed" ? f.resultType : f.type;
        out.set(f.key, { type, system: f.type === "computed" || f.readonly });
        out.set(f.id, { type });
      }
    }
    return out;
  }

  /** Fields of a target as expression types, including select options and lifecycle statuses. */
  exprFields(target: string): ReadonlyMap<string, ExprType> | undefined {
    if (!this.isTarget(target)) return undefined;
    const out = new Map<string, ExprType>([
      ["id", { t: "text" }],
      ["created_at", { t: "datetime" }],
      ["updated_at", { t: "datetime" }],
      ["created_by", { t: "user" }],
    ]);
    const add = (f: Field) => {
      const opts = f.type === "select" || f.type === "multiselect" ? f.options.map((o) => o.value) : undefined;
      const type = f.type === "computed" ? fieldExprType(f.resultType) : fieldExprType(f.type, { to: f.type === "ref" ? f.to : undefined, options: opts });
      out.set(f.key, type);
      out.set(f.id, type);
    };
    if (target in CORE_RECORDS) {
      const rec = CORE_RECORDS[target as CoreRecordKey];
      out.set("status", { t: "text", options: rec.lifecycle?.states.map((s) => s.key) });
      for (const f of rec.fields) out.set(f.key, fieldExprType(f.type, { to: f.to, options: f.options }));
      if (rec.paymentStatus) out.set("payment_status", { t: "text", options: ["unpaid", "partly_paid", "paid", "overdue"] });
      for (const cf of this.bp.customFields) if (cf.target === target && cf.part === "header") add(cf.field);
    } else {
      const e = this.entities.get(target)!;
      out.set("status", { t: "text", options: e.workflow?.states.map((s) => s.key) });
      for (const f of e.fields) add(f);
    }
    return out;
  }

  /** Action keys that can be ruled on or approved. */
  actions(target: string): Map<string, { approvable: boolean }> {
    const out = new Map<string, { approvable: boolean }>(GENERIC_ACTIONS.map((a) => [a, { approvable: true }]));
    if (target in CORE_RECORDS) {
      for (const a of CORE_RECORDS[target as CoreRecordKey].lifecycle?.actions ?? []) out.set(a.key, { approvable: Boolean(a.approvable) });
    } else {
      for (const t of this.entities.get(target)?.workflow?.transitions ?? []) out.set(t.key, { approvable: true });
    }
    return out;
  }
}

export function checkBlueprint(bp: Blueprint): Issue[] {
  const issues: Issue[] = [];
  const err = (path: Issue["path"], message: string) => issues.push({ path, message, severity: "error" });
  const warn = (path: Issue["path"], message: string) => issues.push({ path, message, severity: "warning" });
  const r = new Resolved(bp);

  checkUniqueIds(bp, err);

  /* modules */
  const seenModules = new Set<string>();
  bp.modules.forEach((m, i) => {
    const cat = MODULE_BY_KEY.get(m.key);
    if (!cat) return err(["modules", i, "key"], `Unknown module "${m.key}". Known modules: ${[...MODULE_BY_KEY.keys()].join(", ")}.`);
    if (seenModules.has(m.key)) err(["modules", i, "key"], `Module "${m.key}" is listed twice.`);
    seenModules.add(m.key);
    if (cat.core && !m.enabled) err(["modules", i, "enabled"], `"${cat.label}" is a core module and can't be switched off.`);
    m.submodules.forEach((s, j) => {
      const sub = cat.submodules.find((x) => x.key === s.key);
      if (!sub) {
        const elsewhere = SUBMODULE_BY_KEY.get(s.key);
        return err(["modules", i, "submodules", j, "key"], elsewhere ? `"${s.key}" belongs to the "${elsewhere.module}" module, not "${m.key}".` : `Unknown submodule "${s.key}" in "${m.key}".`);
      }
      if (sub.core && s.enabled === false) err(["modules", i, "submodules", j, "enabled"], `"${sub.label}" is required while "${cat.label}" is on.`);
      if (s.enabled && sub.extension && !r.extensions.has(sub.extension)) {
        err(["modules", i, "submodules", j, "enabled"], `"${sub.label}" needs the "${EXTENSION_BY_KEY[sub.extension].name}" extension (${sub.extension}).`);
      }
    });
  });

  /* extensions */
  bp.extensions.forEach((key, i) => {
    const ext = EXTENSION_BY_KEY[key];
    if (bp.extensions.indexOf(key) !== i) err(["extensions", i], `Extension "${key}" is listed twice.`);
    for (const req of ext.requires) if (!r.extensions.has(req)) err(["extensions", i], `"${ext.name}" needs the "${EXTENSION_BY_KEY[req].name}" extension (${req}) on first.`);
    for (const m of ext.needsModules) if (!r.modules.has(m)) err(["extensions", i], `"${ext.name}" needs the ${MODULE_BY_KEY.get(m)?.label ?? m} module.`);
  });

  /* custom modules */
  bp.customModules.forEach((m, i) => {
    if (MODULE_BY_KEY.has(m.key)) err(["customModules", i, "key"], `"${m.key}" is already a built-in module; choose another key.`);
  });

  /* custom fields on core records */
  if (bp.customFields.length && !r.extensions.has("custom_fields")) {
    err(["customFields"], `Custom fields need the "Custom fields" extension (custom_fields).`);
  }
  const cfKeys = new Set<string>();
  bp.customFields.forEach((cf, i) => {
    const rec = CORE_RECORDS[cf.target];
    if (!rec.customFields.includes(cf.part)) {
      err(["customFields", i, "part"], rec.customFields.length ? `${rec.labelPlural} take custom fields on: ${rec.customFields.join(", ")}.` : `${rec.labelPlural} don't take custom fields.`);
    }
    const coreKeys = cf.part === "header" ? rec.fields.map((f) => f.key) : (rec.lines?.fields.map((f) => f.key) ?? []);
    if (coreKeys.includes(cf.field.key) || cf.field.key in ALWAYS_FIELDS) err(["customFields", i, "field", "key"], `"${cf.field.key}" is already a built-in field on ${rec.labelPlural.toLowerCase()}.`);
    const k = `${cf.target}.${cf.part}.${cf.field.key}`;
    if (cfKeys.has(k)) err(["customFields", i, "field", "key"], `Two custom fields named "${cf.field.key}" on ${rec.labelPlural.toLowerCase()}.`);
    cfKeys.add(k);
    if (!r.recordEnabled(cf.target)) warn(["customFields", i, "target"], `${rec.labelPlural} are switched off, so this field won't show.`);
    if (cf.field.type === "ref" && !r.isTarget(cf.field.to)) err(["customFields", i, "field", "to"], `Unknown record type "${cf.field.to}".`);
    if (cf.showInProduction && !(cf.target === "sales_order" && cf.part === "line")) warn(["customFields", i, "showInProduction"], `Only sales order line fields are carried into production.`);
  });

  /* custom record types */
  const entityKeys = new Set<string>();
  bp.entities.forEach((e, i) => {
    const p = ["entities", i];
    if (entityKeys.has(e.key)) err([...p, "key"], `Two record types use the key "${e.key}".`);
    entityKeys.add(e.key);
    if (SUBMODULE_BY_KEY.has(e.key) || e.key in CORE_RECORDS) err([...p, "key"], `"${e.key}" is a built-in name; choose another key.`);
    if (e.module.startsWith("mod_")) {
      if (!r.customModules.has(e.module)) err([...p, "module"], `Unknown custom module "${e.module}".`);
    } else if (!MODULE_BY_KEY.has(e.module)) {
      err([...p, "module"], `Unknown module "${e.module}".`);
    } else if (!r.modules.has(e.module)) {
      err([...p, "module"], `The ${MODULE_BY_KEY.get(e.module)!.label} module is switched off.`);
    }
    checkFields(e.fields, [...p, "fields"], r, err);
    if (!e.fields.some((f) => f.id === e.titleField)) err([...p, "titleField"], `Title field "${e.titleField}" isn't one of this record type's fields.`);
    if (e.workflow) {
      const wf = e.workflow;
      const states = new Set(wf.states.map((s) => s.id));
      if (!states.has(wf.initial)) err([...p, "workflow", "initial"], `Initial state "${wf.initial}" isn't in the states list.`);
      dupKeys(wf.states.map((s) => s.key), (k, j) => err([...p, "workflow", "states", j, "key"], `State key "${k}" is used twice.`));
      dupKeys(wf.transitions.map((t) => t.key), (k, j) => err([...p, "workflow", "transitions", j, "key"], `Transition key "${k}" is used twice.`));
      const fieldIds = new Set(e.fields.map((f) => f.id));
      wf.transitions.forEach((t, j) => {
        const tp = [...p, "workflow", "transitions", j];
        if ((GENERIC_ACTIONS as readonly string[]).includes(t.key)) err([...tp, "key"], `"${t.key}" is reserved; name the transition after what it does.`);
        t.from.forEach((s, k) => states.has(s) || err([...tp, "from", k], `Unknown state "${s}".`));
        if (!states.has(t.to)) err([...tp, "to"], `Unknown state "${t.to}".`);
        if (t.from.includes(t.to)) warn([...tp, "to"], `"${t.label}" goes from a state to itself.`);
        t.requires?.forEach((f, k) => fieldIds.has(f) || err([...tp, "requires", k], `Unknown field "${f}".`));
        if (!ENTITY_PERMS.includes(t.permission)) err([...tp, "permission"], `Custom record types use ${ENTITY_PERMS.join(", ")} permissions.`);
      });
      const reachable = new Set([wf.initial]);
      for (let changed = true; changed; ) {
        changed = false;
        for (const t of wf.transitions) if (t.from.some((s) => reachable.has(s)) && !reachable.has(t.to)) (reachable.add(t.to), (changed = true));
      }
      wf.states.forEach((s, j) => reachable.has(s.id) || warn([...p, "workflow", "states", j], `No transition reaches "${s.label}".`));
    }
  });

  /* rules */
  bp.rules.forEach((rule, i) => {
    const p = ["rules", i];
    if (!targetOk(rule.target, [...p, "target"])) return;
    const actions = r.actions(rule.target);
    rule.on.forEach((a, j) => actions.has(a) || err([...p, "on", j], `"${a}" isn't an action on ${label(rule.target)}. Options: ${[...actions.keys()].join(", ")}.`));
    const t = rule.then;
    if (t.kind === "set") {
      const f = r.fields(rule.target).get(t.field);
      if (!f) err([...p, "then", "field"], `Unknown field "${t.field}" on ${label(rule.target)}.`);
      else if (f.system) err([...p, "then", "field"], `"${t.field}" is set by the system and can't be changed by a rule.`);
    }
    if (t.kind === "notify") t.roles.forEach((role, j) => roleOk(role, [...p, "then", "roles", j]));
    if (t.kind === "discount_percent" && !(rule.target in CORE_RECORDS && CORE_RECORDS[rule.target as CoreRecordKey].lines)) {
      err([...p, "then", "kind"], `Discounts only apply to documents with lines.`);
    }
  });

  /* approvals */
  bp.approvals.forEach((a, i) => {
    const p = ["approvals", i];
    if (!targetOk(a.target, [...p, "target"])) return;
    const action = r.actions(a.target).get(a.action);
    if (!action) err([...p, "action"], `"${a.action}" isn't an action on ${label(a.target)}. Options: ${[...r.actions(a.target).keys()].join(", ")}.`);
    else if (!action.approvable) err([...p, "action"], `"${a.action}" on ${label(a.target)} can't be held for approval.`);
    let last = -1;
    a.stages.forEach((s, j) => {
      s.roles.forEach((role, k) => roleOk(role, [...p, "stages", j, "roles", k]));
      if (s.minAmount < last) err([...p, "stages", j, "minAmount"], `Stages must go up in amount: this stage starts below the one before.`);
      last = s.minAmount;
      if (s.minAmount > 0 && a.target in CORE_RECORDS && !CORE_RECORDS[a.target as CoreRecordKey].amountField) {
        err([...p, "stages", j, "minAmount"], `${label(a.target)} have no amount, so stages can't start at an amount.`);
      }
    });
  });

  /* roles */
  if (!bp.roles.some((role) => role.owner)) err(["roles"], `At least one role must be the owner role.`);
  dupKeys(bp.roles.map((role) => role.key), (k, i) => err(["roles", i, "key"], `Role key "${k}" is used twice.`));
  bp.roles.forEach((role, i) => {
    const targets = new Set<string>();
    role.grants.forEach((g, j) => {
      const p = ["roles", i, "grants", j];
      if (targets.has(g.target)) err([...p, "target"], `"${g.target}" is granted twice in ${role.label}.`);
      targets.add(g.target);
      if (g.target === "*") return;
      const entity = r.entities.get(g.target) ?? bp.entities.find((e) => e.key === g.target);
      const allowed: readonly PermAction[] | undefined = entity ? ENTITY_PERMS : SUBMODULE_BY_KEY.get(g.target)?.actions;
      if (!allowed) return err([...p, "target"], `Unknown submodule or record type "${g.target}".`);
      g.actions.forEach((a, k) => allowed.includes(a) || err([...p, "actions", k], `"${a}" doesn't apply to "${g.target}". Allowed: ${allowed.join(", ")}.`));
      if (!entity && !r.submoduleEnabled(g.target)) warn([...p, "target"], `"${g.target}" is switched off, so this grant has no effect.`);
      if (typeof g.scope === "object" && g.scope.kind === "own" && g.scope.field) {
        const t = entity ? entity.id : SUBMODULE_BY_KEY.get(g.target)?.record;
        const f = t ? r.fields(t).get(g.scope.field) : undefined;
        if (!f) err([...p, "scope", "field"], `Unknown field "${g.scope.field}".`);
        else if (f.type !== "user" && f.type !== "ref") err([...p, "scope", "field"], `"Own records" needs a user field.`);
      }
    });
  });

  /* views */
  bp.views.forEach((v, i) => {
    const p = ["views", i];
    if (!targetOk(v.target, [...p, "target"])) return;
    const fields = r.fields(v.target);
    const fieldOk = (key: string | undefined, path: Issue["path"], types?: readonly FieldType[]) => {
      if (!key) return;
      const f = fields.get(key);
      if (!f) err(path, `Unknown field "${key}" on ${label(v.target)}.`);
      else if (types && !types.includes(f.type)) err(path, `"${key}" must be a ${types.join(" or ")} field.`);
    };
    v.columns?.forEach((c, j) => fieldOk(c, [...p, "columns", j]));
    fieldOk(v.groupBy, [...p, "groupBy"], ["select", "ref", "user", "boolean"]);
    fieldOk(v.dateField, [...p, "dateField"], DATES);
    fieldOk(v.sort?.field, [...p, "sort", "field"]);
    if (v.type === "kanban" && !v.groupBy) err([...p, "groupBy"], `A kanban view needs a field to group by, such as "status".`);
    if (v.type === "calendar" && !v.dateField) err([...p, "dateField"], `A calendar view needs a date field.`);
    v.roles?.forEach((role, j) => roleOk(role, [...p, "roles", j]));
  });

  /* documents */
  bp.documents.forEach((d, i) => {
    const rec = CORE_RECORDS[d.record];
    if (!rec.printable) err(["documents", i, "record"], `${rec.labelPlural} don't have a printed document.`);
    if (d.layout === "ird_tax_invoice" && d.record !== "invoice" && d.record !== "credit_note") err(["documents", i, "layout"], `The IRD tax invoice layout is only for invoices and credit notes.`);
    const fields = r.fields(d.record);
    const lineFields = new Set([...(rec.lines?.fields.map((f) => f.key) ?? []), ...bp.customFields.filter((c) => c.target === d.record && c.part === "line").flatMap((c) => [c.field.key, c.field.id])]);
    d.extraFields.forEach((f, j) => fields.has(f) || lineFields.has(f) || err(["documents", i, "extraFields", j], `Unknown field "${f}" on ${rec.labelPlural.toLowerCase()}.`));
  });

  /* dashboard */
  bp.dashboard.forEach((w, i) => {
    w.roles?.forEach((role, j) => roleOk(role, ["dashboard", i, "roles", j]));
    if (w.source.kind !== "aggregate") return;
    const p = ["dashboard", i, "source"];
    if (!targetOk(w.source.target, [...p, "target"])) return;
    if (w.source.agg !== "count") {
      const f = w.source.field ? r.fields(w.source.target).get(w.source.field) : undefined;
      if (!w.source.field) err([...p, "field"], `"${w.source.agg}" needs a number field.`);
      else if (!f) err([...p, "field"], `Unknown field "${w.source.field}".`);
      else if (!NUMERIC.includes(f.type)) err([...p, "field"], `"${w.source.field}" isn't a number field.`);
    }
  });

  /* expressions */
  const USER: ExprType = { t: "user" };
  const CHANNEL: ExprType = { t: "text", options: ["web", "assistant", "mcp", "import", "system"] };
  const env = (target: string | undefined, extra: Record<string, ExprType> = {}) => ({
    target,
    fields: (t: string) => r.exprFields(t),
    vars: { $user: USER, channel: CHANNEL, ...extra },
  });
  const expr = (src: string | undefined, path: Issue["path"], target: string | undefined, expect?: ExprType["t"], extra?: Record<string, ExprType>) => {
    if (!src) return;
    if (target && !r.isTarget(target)) return; // already reported
    for (const p of checkExpr(src, env(target, extra), expect).problems) {
      err(path, p.at > 0 ? `${p.message} (at "${src.slice(p.at, p.at + 20)}")` : p.message);
    }
  };
  const resultExpect = (t: string): ExprType["t"] => (["integer", "decimal", "money", "quantity", "percent"].includes(t) ? "number" : (t as ExprType["t"]));

  bp.rules.forEach((rule, i) => {
    expr(rule.when, ["rules", i, "when"], rule.target, "boolean");
    const t = rule.then;
    if (t.kind === "set") {
      const f = r.exprFields(rule.target)?.get(t.field);
      expr(t.expr, ["rules", i, "then", "expr"], rule.target, f && f.t !== "any" && f.t !== "list" && f.t !== "ref" && f.t !== "null" ? f.t : undefined);
    }
    if (t.kind === "discount_percent") expr(t.expr, ["rules", i, "then", "expr"], rule.target, "number");
  });
  bp.approvals.forEach((a, i) => expr(a.when, ["approvals", i, "when"], a.target, "boolean", { amount: { t: "number" } }));
  bp.views.forEach((v, i) => expr(v.filter, ["views", i, "filter"], v.target, "boolean"));
  bp.dashboard.forEach((w, i) => w.source.kind === "aggregate" && expr(w.source.filter, ["dashboard", i, "source", "filter"], w.source.target, "boolean"));
  bp.entities.forEach((e, i) => {
    e.workflow?.transitions.forEach((t, j) => expr(t.when, ["entities", i, "workflow", "transitions", j, "when"], e.id, "boolean"));
    e.fields.forEach((f, j) => f.type === "computed" && expr(f.expr, ["entities", i, "fields", j, "expr"], e.id, resultExpect(f.resultType)));
  });
  bp.customFields.forEach((c, i) => c.field.type === "computed" && expr(c.field.expr, ["customFields", i, "field", "expr"], c.target, resultExpect(c.field.resultType)));
  bp.roles.forEach((role, i) =>
    role.grants.forEach((g, j) => {
      if (typeof g.scope !== "object" || g.scope.kind !== "expr") return;
      const target = r.entities.has(g.target) ? g.target : (bp.entities.find((e) => e.key === g.target)?.id ?? SUBMODULE_BY_KEY.get(g.target)?.record);
      expr(g.scope.expr, ["roles", i, "grants", j, "scope", "expr"], target, "boolean");
    }),
  );

  /* chart of accounts */
  const chart = bp.settings.accounting.chartTemplate;
  const { country } = bp.business;
  const rolesOf = (k: string) => new Set(chartAccounts(k, country, bp.settings.tax.custom).flatMap((a) => (a.role ? [a.role] : [])));
  const accountsByRole = rolesOf(chart);
  const taxes = taxesOf(bp);
  const missingRoles = requiredRoles({
    inventory: r.modules.has("inventory"),
    production: r.modules.has("production"),
    taxRoles: taxRoles(taxes.registered),
  }).filter((role) => !accountsByRole.has(role));
  if (missingRoles.length) {
    const better = CHART_TEMPLATE_KEYS.find((k) => {
      const roles = rolesOf(k);
      return missingRoles.every((m) => roles.has(m));
    });
    err(["settings", "accounting", "chartTemplate"], `The ${chartLabel(chart).toLowerCase()} chart has no account for ${missingRoles.join(", ")}.${better ? ` Use "${better}".` : ""}`);
  }

  /* taxes */
  if (!countryFor(country)) err(["business", "country"], `"${country}" isn't an ISO country code.`);
  const known = new Set(taxes.all.map((t) => t.id));
  bp.settings.tax.registered.forEach((id, i) => {
    if (!known.has(id) && !["vat", "sscl", "wht"].includes(id)) err(["settings", "tax", "registered", i], `"${id}" isn't a tax of ${countryFor(country)?.name ?? country} or one of the business's own. Use one of: ${[...known].join(", ") || "(none, add your own)"}.`);
  });
  dupKeys(bp.settings.tax.custom.map((c) => c.id), (k, i) => err(["settings", "tax", "custom", i, "id"], `Tax "${k}" is defined twice.`));

  /* settings */
  dupKeys(bp.settings.general.numbering.map((n) => n.record), (k, i) => err(["settings", "general", "numbering", i, "record"], `Numbering for "${k}" is set twice.`));

  /* seed */
  const s = bp.seed;
  for (const [kind, list] of [["units", s.units], ["itemClasses", s.itemClasses], ["warehouses", s.warehouses], ["resources", s.production.resources], ["parameters", s.production.parameters]] as const) {
    dupKeys(list.map((x) => x.code.toUpperCase()), (k, i) => err(["seed", ...(kind === "resources" || kind === "parameters" ? ["production"] : []), kind, i, "code"], `Code "${k}" is used twice.`));
  }
  const resourceCodes = new Set(s.production.resources.map((x) => x.code));
  s.production.resources.forEach((x, i) => x.parent && !resourceCodes.has(x.parent) && err(["seed", "production", "resources", i, "parent"], `Unknown resource "${x.parent}".`));
  const classCodes = new Set(s.itemClasses.map((x) => x.code));
  s.itemClasses.forEach((x, i) => x.parent && !classCodes.has(x.parent) && err(["seed", "itemClasses", i, "parent"], `Unknown item class "${x.parent}".`));
  const paramCodes = new Set(s.production.parameters.map((x) => x.code));
  s.production.operationTypes.forEach((o, i) => o.params?.forEach((c, j) => paramCodes.has(c) || err(["seed", "production", "operationTypes", i, "params", j], `Unknown parameter "${c}".`)));
  s.production.qcTemplates.forEach((t, i) => t.params.forEach((q, j) => q.code && !paramCodes.has(q.code) && warn(["seed", "production", "qcTemplates", i, "params", j, "code"], `"${q.code}" isn't in the parameter library.`)));
  if (s.production.qcTemplates.some((t) => t.appliesTo === "receipt") && !r.extensions.has("incoming_qc")) {
    warn(["seed", "production", "qcTemplates"], `Receipt QC templates are only used with the "Incoming inspection" extension.`);
  }
  if ((s.production.resources.length || s.production.operationTypes.length) && !r.modules.has("production")) {
    warn(["seed", "production"], `Production starter data is ignored while the Production module is off.`);
  }

  return issues;

  /* helpers that close over r, err */
  function targetOk(target: string, path: Issue["path"]): boolean {
    if (!r.isTarget(target)) {
      err(path, `Unknown record type "${target}".`);
      return false;
    }
    if (target in CORE_RECORDS && !r.recordEnabled(target as CoreRecordKey)) {
      warn(path, `${label(target)} are switched off.`);
    }
    return true;
  }
  function roleOk(role: string, path: Issue["path"]) {
    if (!bp.roles.some((x) => x.id === role)) err(path, `Unknown role "${role}".`);
  }
  function label(target: string): string {
    return target in CORE_RECORDS ? CORE_RECORDS[target as CoreRecordKey].labelPlural.toLowerCase() : (r.entities.get(target)?.labelPlural.toLowerCase() ?? target);
  }
}

function checkFields(fields: readonly Field[], path: Issue["path"], r: Resolved, err: (p: Issue["path"], m: string) => void) {
  dupKeys(fields.map((f) => f.key), (k, i) => err([...path, i, "key"], `Field key "${k}" is used twice.`));
  fields.forEach((f, i) => {
    if (f.key in ALWAYS_FIELDS) err([...path, i, "key"], `"${f.key}" is a built-in field name.`);
    if (f.type === "ref" && !r.isTarget(f.to)) err([...path, i, "to"], `Unknown record type "${f.to}".`);
    if ((f.type === "select" || f.type === "multiselect")) dupKeys(f.options.map((o) => o.value), (k, j) => err([...path, i, "options", j, "value"], `Option "${k}" is listed twice.`));
    if (f.type === "quantity" && f.unitFromItem && !fields.some((x) => x.id === f.unitFromItem && x.type === "ref")) err([...path, i, "unitFromItem"], `"unitFromItem" must point at a ref field on the same record.`);
    if (f.type === "lines") {
      if (f.item && !r.isTarget(f.item)) err([...path, i, "item"], `Unknown record type "${f.item}".`);
      checkFields(f.columns, [...path, i, "columns"], r, err);
    }
  });
}

function checkUniqueIds(bp: Blueprint, err: (p: Issue["path"], m: string) => void) {
  const seen = new Map<string, string>();
  const see = (id: string, path: Issue["path"]) => {
    const prev = seen.get(id);
    if (prev) err(path, `Id "${id}" is already used at ${prev}.`);
    else seen.set(id, path.join("."));
  };
  const fieldIds = (fields: readonly Field[], path: Issue["path"]) =>
    fields.forEach((f, i) => {
      see(f.id, [...path, i, "id"]);
      if (f.type === "lines") fieldIds(f.columns, [...path, i, "columns"]);
    });
  bp.customModules.forEach((m, i) => see(m.id, ["customModules", i, "id"]));
  bp.customFields.forEach((c, i) => see(c.field.id, ["customFields", i, "field", "id"]));
  bp.entities.forEach((e, i) => {
    see(e.id, ["entities", i, "id"]);
    fieldIds(e.fields, ["entities", i, "fields"]);
    e.workflow?.states.forEach((s, j) => see(s.id, ["entities", i, "workflow", "states", j, "id"]));
    e.workflow?.transitions.forEach((t, j) => see(t.id, ["entities", i, "workflow", "transitions", j, "id"]));
  });
  bp.rules.forEach((x, i) => see(x.id, ["rules", i, "id"]));
  bp.approvals.forEach((x, i) => {
    see(x.id, ["approvals", i, "id"]);
    x.stages.forEach((s, j) => see(s.id, ["approvals", i, "stages", j, "id"]));
  });
  bp.roles.forEach((x, i) => see(x.id, ["roles", i, "id"]));
  bp.views.forEach((x, i) => see(x.id, ["views", i, "id"]));
  bp.documents.forEach((x, i) => see(x.id, ["documents", i, "id"]));
  bp.dashboard.forEach((x, i) => see(x.id, ["dashboard", i, "id"]));
}

function dupKeys(keys: readonly string[], onDup: (key: string, index: number) => void) {
  const seen = new Set<string>();
  keys.forEach((k, i) => {
    if (seen.has(k)) onDup(k, i);
    seen.add(k);
  });
}
