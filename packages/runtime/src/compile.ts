import {
  CORE_RECORDS,
  SUBMODULE_BY_KEY,
  SUBMODULE_FOR_RECORD,
  Resolved,
  navigation,
  parseExpr,
  titleFieldOf,
  type ApprovalPolicy,
  type Blueprint,
  type CoreField,
  type CoreRecordKey,
  type ExprNode,
  type Field,
  type FieldType,
  type PermAction,
  type Rule,
  type Tone,
} from "@shapewise/blueprint";

/**
 * The compiled form of a blueprint: everything the command pipeline and the
 * screens need, resolved once per blueprint version. Field shapes merge core
 * catalogue fields with the business's custom fields, expressions are parsed
 * once, and permissions become a lookup table.
 */

export interface CField {
  key: string;
  /** Custom field id, or the key for core fields. */
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Set by the system; never accepted from input. */
  system: boolean;
  /** Custom field, not part of the catalogue. */
  custom: boolean;
  to?: string;
  options?: { value: string; label: string; tone?: Tone }[];
  unit?: string;
  description?: string;
  /** Computed fields. */
  expr?: ExprNode;
  /** For nested lines on custom record types. */
  columns?: CField[];
}

export interface CList {
  key: string;
  label: string;
  fields: CField[];
}

export interface CState {
  key: string;
  label: string;
  tone: Tone;
  terminal?: boolean;
}

export interface CAction {
  key: string;
  label: string;
  from: string[];
  to: string;
  permission: PermAction;
  approvable: boolean;
  effects: ("ledger" | "stock" | "numbering")[];
  requires?: string[];
  when?: ExprNode;
}

export interface CTarget {
  target: string;
  kind: "core" | "custom";
  label: string;
  labelPlural: string;
  /** Submodule (core) or custom record type key; used for permissions and URLs. */
  submodule: string;
  module: string;
  titleField: string;
  fields: CField[];
  lines?: CList;
  children: CList[];
  states: CState[];
  initial?: string;
  actions: CAction[];
  numbering?: string;
  /** Number assigned on create (true) or by a lifecycle action with the numbering effect. */
  numberOnCreate: boolean;
  amountField?: string;
  convertsTo: { to: string; label: string }[];
  printable: boolean;
  paymentStatus: boolean;
}

export interface CRule extends Omit<Rule, "when" | "then"> {
  when?: ExprNode;
  then: Rule["then"] extends infer T ? (T extends { expr: string } ? Omit<T, "expr"> & { expr: ExprNode } : T) : never;
}

export interface CApproval extends Omit<ApprovalPolicy, "when"> {
  when?: ExprNode;
}

export interface Compiled {
  version: number;
  bp: Blueprint;
  targets: ReadonlyMap<string, CTarget>;
  /** Find a target by its submodule (core) or key (custom). */
  bySubmodule(key: string): CTarget | undefined;
  /** Allowed actions for a role on a submodule or custom record type. */
  can(roleKey: string, submodule: string, action: PermAction): boolean;
  /** Which records of a screen a role sees: all, or only its own (by a person field, or who created them). */
  scope(roleKey: string, submodule: string): RowScopeRule;
  rules(target: string, event: string): CRule[];
  approvals(target: string, action: string): CApproval[];
  resolved: Resolved;
}

const cache = new WeakMap<Blueprint, Compiled>();

export function compile(bp: Blueprint): Compiled {
  const hit = cache.get(bp);
  if (hit) return hit;
  const r = new Resolved(bp);
  const targets = new Map<string, CTarget>();
  /** A field pointing at a switched-off record type (price list without the extension) isn't shown or accepted. */
  const live = (f: { type: string; to?: string }) => !(f.type === "ref" && f.to && f.to in CORE_RECORDS && !r.recordEnabled(f.to as CoreRecordKey));

  /* core records whose submodule is on */
  for (const [record, rec] of Object.entries(CORE_RECORDS) as [CoreRecordKey, (typeof CORE_RECORDS)[CoreRecordKey]][]) {
    const sub = SUBMODULE_FOR_RECORD.get(record);
    if (!sub || !r.submoduleEnabled(sub)) continue;
    const custom = bp.customFields.filter((c) => c.target === record);
    const prod = bp.settings.production;
    const nav = navLabel(bp, sub);
    const numberingEffect = rec.lifecycle?.actions.some((a) => a.effects?.includes("numbering")) ?? false;
    targets.set(record, {
      target: record,
      kind: "core",
      label: rec.label,
      labelPlural: nav ?? rec.labelPlural,
      submodule: sub,
      module: SUBMODULE_BY_KEY.get(sub)!.module,
      titleField: titleFieldOf(record),
      fields: [...rec.fields.filter(live).map(coreField), ...custom.filter((c) => c.part === "header").map((c) => customField(c.field))],
      lines: rec.lines
        ? { key: "lines", label: rec.lines.label, fields: [...rec.lines.fields.filter(live).map(coreField), ...custom.filter((c) => c.part === "line").map((c) => customField(c.field))] }
        : undefined,
      children: (rec.children ?? [])
        .filter((c) => !c.setting || prod[c.setting])
        .map((c) => ({ key: c.key, label: c.label, fields: c.fields.filter(live).map(coreField) })),
      states: rec.lifecycle?.states.map((s) => ({ ...s })) ?? [],
      initial: rec.lifecycle?.initial,
      actions: (rec.lifecycle?.actions ?? []).map((a) => ({
        key: a.key, label: a.label, from: [...a.from], to: a.to, permission: a.permission, approvable: Boolean(a.approvable), effects: [...(a.effects ?? [])],
      })),
      numbering: bp.settings.general.numbering.find((n) => n.record === record)?.pattern ?? rec.numbering,
      numberOnCreate: Boolean(rec.numbering) && !numberingEffect,
      amountField: rec.amountField,
      convertsTo: (rec.convertsTo ?? []).filter((c) => r.recordEnabled(c.to)).map((c) => ({ ...c })),
      printable: Boolean(rec.printable),
      paymentStatus: Boolean(rec.paymentStatus),
    });
  }

  /* custom record types */
  for (const e of bp.entities) {
    const wf = e.workflow;
    const stateKey = new Map(wf?.states.map((s) => [s.id, s.key]));
    const lines = e.fields.find((f) => f.type === "lines");
    targets.set(e.id, {
      target: e.id,
      kind: "custom",
      label: e.label,
      labelPlural: e.labelPlural,
      submodule: e.key,
      module: e.module.startsWith("mod_") ? (bp.customModules.find((m) => m.id === e.module)?.key ?? e.module) : e.module,
      titleField: e.fields.find((f) => f.id === e.titleField)?.key ?? e.fields[0]!.key,
      fields: e.fields.filter((f) => f.type !== "lines").map(customField),
      lines: lines && lines.type === "lines" ? { key: lines.key, label: lines.label, fields: lines.columns.map(customField) } : undefined,
      children: [],
      states: wf?.states.map((s) => ({ key: s.key, label: s.label, tone: s.tone, terminal: s.terminal })) ?? [],
      initial: wf ? stateKey.get(wf.initial) : undefined,
      actions: (wf?.transitions ?? []).map((t) => ({
        key: t.key, label: t.label, from: t.from.map((s) => stateKey.get(s)!), to: stateKey.get(t.to)!, permission: t.permission, approvable: true, effects: [],
        requires: t.requires?.map((id) => e.fields.find((f) => f.id === id)?.key ?? id),
        when: t.when ? parseExpr(t.when) : undefined,
      })),
      numbering: e.numbering?.pattern,
      numberOnCreate: Boolean(e.numbering),
      convertsTo: [],
      printable: false,
      paymentStatus: false,
    });
  }

  /* permissions: role key → submodule → actions */
  const perms = new Map<string, Map<string, Set<PermAction>>>();
  const scopes = new Map<string, Map<string, RowScopeRule>>();
  const owners = new Set(bp.roles.filter((x) => x.owner).map((x) => x.key));
  for (const role of bp.roles) {
    const m = new Map<string, Set<PermAction>>();
    const sc = new Map<string, RowScopeRule>();
    for (const g of role.grants) {
      const key = bp.entities.find((e) => e.id === g.target)?.key ?? g.target;
      m.set(key, new Set([...(m.get(key) ?? []), ...g.actions]));
      // Any grant without a limit opens every record; "own" only applies when every grant says so.
      const own = typeof g.scope === "object" && g.scope.kind === "own" ? g.scope : undefined;
      const prev = sc.get(key);
      sc.set(key, !own || prev === "all" ? "all" : (prev ?? { field: own.field }));
    }
    perms.set(role.key, m);
    scopes.set(role.key, sc);
  }

  /* rules and approvals, expressions parsed once */
  const rules = bp.rules.filter((x) => x.enabled).map((x) => ({
    ...x,
    when: x.when ? parseExpr(x.when) : undefined,
    then: "expr" in x.then ? { ...x.then, expr: parseExpr(x.then.expr) } : x.then,
  })) as CRule[];
  const approvals = bp.approvals.filter((a) => a.enabled).map((a) => ({ ...a, when: a.when ? parseExpr(a.when) : undefined }));
  const bySub = new Map([...targets.values()].map((t) => [t.submodule, t]));

  const compiled: Compiled = {
    version: bp.version,
    bp,
    targets,
    resolved: r,
    bySubmodule: (key) => bySub.get(key),
    can(roleKey, submodule, action) {
      if (owners.has(roleKey)) return true;
      const m = perms.get(roleKey);
      return Boolean(m?.get("*")?.has(action) || m?.get(submodule)?.has(action));
    },
    scope(roleKey, submodule) {
      if (owners.has(roleKey)) return "all";
      const m = scopes.get(roleKey);
      if (m?.get("*") === "all") return "all";
      return m?.get(submodule) ?? "all";
    },
    rules: (target, event) => rules.filter((x) => x.target === target && x.on.includes(event)),
    approvals: (target, action) => approvals.filter((a) => a.target === target && a.action === action),
  };
  cache.set(bp, compiled);
  return compiled;
}

function coreField(f: CoreField): CField {
  return {
    key: f.key,
    id: f.key,
    label: f.label,
    type: f.type,
    required: Boolean(f.required),
    system: Boolean(f.system),
    custom: false,
    to: f.to,
    options: f.options?.map((o) => ({ value: o, label: humanise(o) })),
  };
}

function customField(f: Field): CField {
  return {
    key: f.key,
    id: f.id,
    label: f.label,
    type: f.type,
    required: Boolean(f.required),
    system: f.type === "computed" || Boolean(f.readonly),
    custom: true,
    to: f.type === "ref" ? f.to : undefined,
    options: f.type === "select" || f.type === "multiselect" ? f.options.map((o) => ({ value: o.value, label: o.label, tone: o.tone })) : undefined,
    unit: f.type === "quantity" ? f.unit : undefined,
    description: f.description,
    expr: f.type === "computed" ? parseExpr(f.expr) : undefined,
    columns: f.type === "lines" ? f.columns.map(customField) : undefined,
  };
}

function navLabel(bp: Blueprint, submodule: string): string | undefined {
  for (const s of navigation(bp)) for (const m of s.modules) for (const x of m.submodules) if (x.key === submodule) return x.label;
  return undefined;
}

/** Words that are written in capitals wherever they appear. */
const ACRONYMS = new Set(["vat", "sscl", "wht", "grn", "qc", "ncr", "coa", "pos", "wip", "fifo", "po", "so"]);

export function humanise(key: string): string {
  const words = key.split("_").map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "all", or only records that are the person's own: those a person field points at, or that they created. */
export type RowScopeRule = "all" | { field?: string };

/** Whether a person may see and work on a record, under their role's row scope. */
export function visibleTo(c: Compiled, roleKey: string, actorId: string, t: CTarget, rec: { data: Record<string, unknown>; createdBy?: string }): boolean {
  const s = c.scope(roleKey, t.submodule);
  if (s === "all") return true;
  if (!s.field) return rec.createdBy === actorId;
  const key = t.fields.find((f) => f.key === s.field || f.id === s.field)?.key ?? s.field;
  const v = rec.data[key];
  return v === actorId || (Array.isArray(v) && v.includes(actorId)) || rec.createdBy === actorId;
}
