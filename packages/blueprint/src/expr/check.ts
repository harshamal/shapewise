import type { FieldType } from "../fields";
import { ExprSyntaxError, parseExpr, type ExprNode } from "./parse";

/** Static types in expressions. Money and quantities are plain numbers (major units). */
export type ExprType =
  | { t: "number" }
  | { t: "text"; options?: readonly string[] }
  | { t: "boolean" }
  | { t: "date" }
  | { t: "datetime" }
  | { t: "ref"; to: string }
  | { t: "user" }
  | { t: "list"; of: ExprType }
  | { t: "null" }
  | { t: "any" };

export interface ExprEnv {
  /** The record type the expression runs on, if any. */
  target?: string;
  /** Fields of a record type, or undefined if it isn't one. */
  fields(target: string): ReadonlyMap<string, ExprType> | undefined;
  /** Extra names in scope, e.g. $user, amount, channel. */
  vars?: Readonly<Record<string, ExprType>>;
}

export interface ExprProblem {
  message: string;
  /** Character offset in the source. */
  at: number;
}

export interface CheckResult {
  ast?: ExprNode;
  type?: ExprType;
  problems: ExprProblem[];
}

const T = {
  number: { t: "number" } as ExprType,
  text: { t: "text" } as ExprType,
  boolean: { t: "boolean" } as ExprType,
  date: { t: "date" } as ExprType,
  datetime: { t: "datetime" } as ExprType,
  user: { t: "user" } as ExprType,
  null: { t: "null" } as ExprType,
  any: { t: "any" } as ExprType,
};

const USER_FIELDS: ReadonlyMap<string, ExprType> = new Map([
  ["id", T.text],
  ["name", T.text],
  ["email", T.text],
  ["role", T.text],
]);

/** The expression type of a stored field. */
export function fieldExprType(type: FieldType, extra: { to?: string; options?: readonly string[] } = {}): ExprType {
  switch (type) {
    case "integer":
    case "decimal":
    case "money":
    case "quantity":
    case "percent":
      return T.number;
    case "select":
      return { t: "text", options: extra.options };
    case "multiselect":
      return { t: "list", of: { t: "text", options: extra.options } };
    case "boolean":
      return T.boolean;
    case "date":
      return T.date;
    case "datetime":
      return T.datetime;
    case "ref":
      return extra.to === "user" ? T.user : { t: "ref", to: extra.to ?? "?" };
    case "user":
      return T.user;
    case "lines":
      return { t: "list", of: T.any };
    default:
      return T.text;
  }
}

export function typeName(x: ExprType): string {
  switch (x.t) {
    case "ref":
      return `a ${x.to.replaceAll("_", " ")}`;
    case "list":
      return `a list`;
    case "null":
      return "empty";
    case "any":
      return "a value";
    case "user":
      return "a person";
    case "boolean":
      return "yes/no";
    default:
      return `a ${x.t}`;
  }
}

/** Parse and type-check. `expect` is the type the place it's used needs. */
export function checkExpr(src: string, env: ExprEnv, expect?: ExprType["t"]): CheckResult {
  let ast: ExprNode;
  try {
    ast = parseExpr(src);
  } catch (e) {
    if (e instanceof ExprSyntaxError) return { problems: [{ message: e.message, at: e.at }] };
    throw e;
  }
  const problems: ExprProblem[] = [];
  const type = new Checker(env, problems).check(ast, { target: env.target, thisType: env.target ? { t: "ref", to: env.target } : undefined });
  if (expect && problems.length === 0 && !assignable(type, expect)) {
    problems.push({ message: `This should give ${typeName({ t: expect } as ExprType)}, but gives ${typeName(type)}.`, at: 0 });
  }
  return { ast, type, problems };
}

function assignable(type: ExprType, expect: ExprType["t"]): boolean {
  if (type.t === "any" || type.t === "null") return true;
  if (expect === "datetime" && type.t === "date") return true;
  return type.t === expect;
}

interface Scope {
  target?: string;
  thisType?: ExprType;
}

class Checker {
  constructor(
    private readonly env: ExprEnv,
    private readonly problems: ExprProblem[],
  ) {}

  private fail(at: number, message: string): ExprType {
    this.problems.push({ message, at });
    return T.any;
  }

  check(e: ExprNode, s: Scope): ExprType {
    switch (e.k) {
      case "num":
        return T.number;
      case "str":
        return T.text;
      case "bool":
        return T.boolean;
      case "null":
        return T.null;
      case "path":
        return this.path(e, s);
      case "not": {
        const x = this.check(e.e, s);
        if (!is(x, "boolean")) this.fail(e.at, `"not" needs yes/no, got ${typeName(x)}.`);
        return T.boolean;
      }
      case "neg": {
        const x = this.check(e.e, s);
        if (!is(x, "number")) this.fail(e.at, `Only numbers can be negative.`);
        return T.number;
      }
      case "bin":
        return this.binary(e, s);
      case "in": {
        const x = this.check(e.e, s);
        for (const item of e.list) {
          const y = this.check(item, s);
          if (!comparable(x, y)) this.fail(item.at, `Can't compare ${typeName(x)} with ${typeName(y)}.`);
          else this.checkOption(x, item);
        }
        return T.boolean;
      }
      case "call":
        return this.call(e, s);
      case "agg":
        return this.aggregate(e, s);
    }
  }

  private path(e: Extract<ExprNode, { k: "path" }>, s: Scope): ExprType {
    const [head, ...rest] = e.parts as [string, ...string[]];
    let cur: ExprType;
    let tail = rest;
    if (head === "this") {
      if (!s.thisType) return this.fail(e.at, `"this" only works on a record.`);
      cur = s.thisType;
    } else if (this.env.vars && head in this.env.vars) {
      cur = this.env.vars[head]!;
    } else if (head.startsWith("$")) {
      return this.fail(e.at, `Unknown name "${head}".${this.env.vars ? ` Available: ${Object.keys(this.env.vars).join(", ")}.` : ""}`);
    } else if (head === "record" && s.target) {
      cur = { t: "ref", to: s.target };
    } else {
      if (!s.target) return this.fail(e.at, `"${head}" isn't available here.`);
      cur = this.field(s.target, head, e.at);
      if (cur.t === "any") return cur;
    }
    for (const name of tail) {
      if (cur.t === "ref") cur = this.field(cur.to, name, e.at);
      else if (cur.t === "user") cur = USER_FIELDS.get(name) ?? this.fail(e.at, `A person has ${[...USER_FIELDS.keys()].join(", ")}, not "${name}".`);
      else return this.fail(e.at, `${typeName(cur)} has no field "${name}".`);
      if (cur.t === "any") return cur;
    }
    return cur;
  }

  private field(target: string, name: string, at: number): ExprType {
    const fields = this.env.fields(target);
    if (!fields) return this.fail(at, `Unknown record type "${target}".`);
    const f = fields.get(name);
    if (f) return f;
    const hint = closest(name, [...fields.keys()].filter((k) => !k.startsWith("fld_")));
    return this.fail(at, `Unknown field "${name}" on ${target.replaceAll("_", " ")}.${hint ? ` Did you mean "${hint}"?` : ""}`);
  }

  private binary(e: Extract<ExprNode, { k: "bin" }>, s: Scope): ExprType {
    const l = this.check(e.l, s);
    const r = this.check(e.r, s);
    switch (e.op) {
      case "and":
      case "or":
        if (!is(l, "boolean")) this.fail(e.l.at, `"${e.op}" needs yes/no on both sides, got ${typeName(l)}.`);
        if (!is(r, "boolean")) this.fail(e.r.at, `"${e.op}" needs yes/no on both sides, got ${typeName(r)}.`);
        return T.boolean;
      case "=":
      case "!=":
        if (!comparable(l, r)) this.fail(e.at, `Can't compare ${typeName(l)} with ${typeName(r)}.`);
        else {
          this.checkOption(l, e.r);
          this.checkOption(r, e.l);
        }
        return T.boolean;
      case "<":
      case "<=":
      case ">":
      case ">=":
        if (!comparable(l, r) || l.t === "boolean" || l.t === "ref" || l.t === "user" || l.t === "list" || l.t === "null" || r.t === "null") {
          this.fail(e.at, `"${e.op}" compares numbers, dates or text, not ${typeName(l)} and ${typeName(r)}.`);
        }
        return T.boolean;
      case "+":
      case "-": {
        if (is(l, "number") && is(r, "number")) return T.number;
        if ((l.t === "date" || l.t === "datetime") && is(r, "number")) return l;
        if (e.op === "-" && (l.t === "date" || l.t === "datetime") && (r.t === "date" || r.t === "datetime")) return T.number;
        if (e.op === "+" && is(l, "text") && is(r, "text")) return T.text;
        return this.fail(e.at, `Can't ${e.op === "+" ? "add" : "subtract"} ${typeName(r)} ${e.op === "+" ? "to" : "from"} ${typeName(l)}.`);
      }
      case "*":
      case "/":
        if (!is(l, "number") || !is(r, "number")) return this.fail(e.at, `"${e.op}" needs numbers on both sides.`);
        return T.number;
    }
  }

  /** 'breakdwon' compared with a select field is almost certainly a typo. */
  private checkOption(field: ExprType, other: ExprNode) {
    if (field.t === "text" && field.options && other.k === "str" && !field.options.includes(other.v)) {
      const hint = closest(other.v, field.options);
      this.fail(other.at, `"${other.v}" isn't one of the options (${field.options.join(", ")}).${hint ? ` Did you mean "${hint}"?` : ""}`);
    }
  }

  private call(e: Extract<ExprNode, { k: "call" }>, s: Scope): ExprType {
    const args = e.args.map((a) => this.check(a, s));
    const arity = (n: number, m = n) => {
      if (args.length < n || args.length > m) this.fail(e.at, `${e.fn}() takes ${n === m ? n : `${n} to ${m}`} value${m === 1 ? "" : "s"}.`);
    };
    const need = (i: number, ...ts: ExprType["t"][]) => {
      const a = args[i];
      if (a && !ts.some((t) => is(a, t))) this.fail(e.args[i]!.at, `${e.fn}() needs ${ts.map((t) => typeName({ t } as ExprType)).join(" or ")} here, got ${typeName(a)}.`);
    };
    switch (e.fn) {
      case "today":
        return arity(0), T.date;
      case "now":
        return arity(0), T.datetime;
      case "days_between":
        return arity(2), need(0, "date", "datetime"), need(1, "date", "datetime"), T.number;
      case "year":
      case "month":
      case "day":
        return arity(1), need(0, "date", "datetime"), T.number;
      case "lower":
      case "upper":
      case "trim":
        return arity(1), need(0, "text"), T.text;
      case "len":
        return arity(1), need(0, "text", "list"), T.number;
      case "contains":
        return arity(2), need(0, "text", "list"), need(1, "text"), T.boolean;
      case "is_empty":
        return arity(1), T.boolean;
      case "coalesce":
        arity(2);
        if (args[0] && args[1] && !comparable(args[0], args[1])) this.fail(e.at, `coalesce() needs two values of the same kind.`);
        return args[0]?.t === "null" ? (args[1] ?? T.any) : (args[0] ?? T.any);
      case "round":
        return arity(1, 2), need(0, "number"), need(1, "number"), T.number;
      case "abs":
        return arity(1), need(0, "number"), T.number;
      default: {
        const hint = closest(e.fn, FUNCTIONS);
        return this.fail(e.at, `Unknown function "${e.fn}".${hint ? ` Did you mean "${hint}"?` : ""}`);
      }
    }
  }

  private aggregate(e: Extract<ExprNode, { k: "agg" }>, s: Scope): ExprType {
    const fields = this.env.fields(e.target);
    if (!fields) return this.fail(e.at, `Unknown record type "${e.target}" in ${e.fn}().`);
    if (e.fn === "count") {
      if (e.field) this.fail(e.at, `count() counts records; write count(${e.target} where ...).`);
    } else {
      if (!e.field) return this.fail(e.at, `${e.fn}() needs a field, e.g. ${e.fn}(${e.target}.total where ...).`);
      const f = this.field(e.target, e.field, e.at);
      const okTypes: ExprType["t"][] = e.fn === "min" || e.fn === "max" ? ["number", "date", "datetime"] : ["number"];
      if (f.t !== "any" && !okTypes.includes(f.t)) this.fail(e.at, `${e.fn}() needs a number field; "${e.field}" is ${typeName(f)}.`);
    }
    if (e.where) {
      // Inside the condition, fields belong to the counted record and `this` is the outer record.
      const w = this.check(e.where, { target: e.target, thisType: s.thisType });
      if (!is(w, "boolean")) this.fail(e.where.at, `The condition after "where" must be yes/no.`);
    }
    if (e.fn === "count") return T.number;
    if (e.fn === "sum" || e.fn === "avg") return T.number;
    return e.field ? (fields.get(e.field) ?? T.any) : T.any;
  }
}

const FUNCTIONS = ["today", "now", "days_between", "year", "month", "day", "lower", "upper", "trim", "len", "contains", "is_empty", "coalesce", "round", "abs"];

function is(x: ExprType, t: ExprType["t"]): boolean {
  return x.t === t || x.t === "any";
}

function comparable(a: ExprType, b: ExprType): boolean {
  if (a.t === "any" || b.t === "any" || a.t === "null" || b.t === "null") return true;
  const dateish = (x: ExprType) => x.t === "date" || x.t === "datetime";
  if (dateish(a) && dateish(b)) return true;
  // Record ids can be compared with text, and refs with refs to the same type.
  if (a.t === "ref" && b.t === "ref") return a.to === b.to;
  if ((a.t === "ref" || a.t === "user") && b.t === "text") return true;
  if (a.t === "text" && (b.t === "ref" || b.t === "user")) return true;
  if (a.t === "list" && b.t === "list") return true;
  return a.t === b.t;
}

/** The nearest candidate by edit distance, if it's close enough to be a typo. */
export function closest(word: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  const w = word.toLowerCase();
  for (const c of candidates) {
    const d = distance(w, c.toLowerCase());
    if (d < bestD) (best = c), (bestD = d);
  }
  return best !== undefined && bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : undefined;
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}
