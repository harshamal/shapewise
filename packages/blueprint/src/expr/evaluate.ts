import type { ExprNode } from "./parse";

/**
 * Interprets a checked expression. Values are plain JSON:
 * numbers (money and quantities in major units), strings, booleans, null,
 * arrays for multiselect, dates as "YYYY-MM-DD", datetimes as ISO strings.
 *
 * Missing values are null. Comparisons with null are false (except `= null`
 * and `!= null`), arithmetic with null gives null, and `and`/`or` treat null
 * as false, so a rule on an empty field never fires by accident.
 */
export interface EvalContext {
  /** Value at a path, relative to the current record (["customer", "order_count"]). */
  get(parts: readonly string[]): unknown;
  /** "Today" in the business's timezone, "YYYY-MM-DD". */
  today: string;
  /** Current time, ISO. */
  now: string;
  /** Run an aggregate; `where` evaluates the condition for one candidate record. */
  aggregate?(agg: Extract<ExprNode, { k: "agg" }>): unknown;
}

export class ExprRuntimeError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
    this.name = "ExprRuntimeError";
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

export function evaluate(e: ExprNode, ctx: EvalContext): unknown {
  switch (e.k) {
    case "num":
    case "str":
    case "bool":
      return e.v;
    case "null":
      return null;
    case "path":
      return norm(e.parts[0] === "this" ? ctx.get(["id", ...e.parts.slice(1)]) : ctx.get(e.parts[0] === "record" ? e.parts.slice(1) : e.parts));
    case "not": {
      const v = evaluate(e.e, ctx);
      return v === null ? null : !truthy(v);
    }
    case "neg": {
      const v = evaluate(e.e, ctx);
      return typeof v === "number" ? -v : null;
    }
    case "in": {
      const v = evaluate(e.e, ctx);
      const hit = e.list.some((x) => equal(v, evaluate(x, ctx)));
      return e.negated ? !hit : hit;
    }
    case "bin":
      return binary(e, ctx);
    case "call":
      return call(e, ctx);
    case "agg":
      if (!ctx.aggregate) throw new ExprRuntimeError(`${e.fn}() needs the database and can't run here.`, e.at);
      return norm(ctx.aggregate(e));
  }
}

/** Evaluate as a condition: anything but true is false. */
export function test(e: ExprNode, ctx: EvalContext): boolean {
  return evaluate(e, ctx) === true;
}

function binary(e: Extract<ExprNode, { k: "bin" }>, ctx: EvalContext): unknown {
  if (e.op === "and") return truthy(evaluate(e.l, ctx)) && truthy(evaluate(e.r, ctx));
  if (e.op === "or") return truthy(evaluate(e.l, ctx)) || truthy(evaluate(e.r, ctx));
  const l = evaluate(e.l, ctx);
  const r = evaluate(e.r, ctx);
  switch (e.op) {
    case "=":
      return equal(l, r);
    case "!=":
      return !equal(l, r);
    case "<":
    case "<=":
    case ">":
    case ">=": {
      if (l === null || r === null) return false;
      const c = compare(l, r);
      if (c === undefined) return false;
      return e.op === "<" ? c < 0 : e.op === "<=" ? c <= 0 : e.op === ">" ? c > 0 : c >= 0;
    }
    case "+":
    case "-": {
      if (l === null || r === null) return null;
      if (typeof l === "number" && typeof r === "number") return e.op === "+" ? l + r : l - r;
      if (typeof l === "string" && typeof r === "number" && isTime(l)) return addDays(l, e.op === "+" ? r : -r);
      if (e.op === "-" && typeof l === "string" && typeof r === "string" && isTime(l) && isTime(r)) return (ms(l) - ms(r)) / DAY;
      if (e.op === "+" && typeof l === "string" && typeof r === "string") return l + r;
      return null;
    }
    case "*":
      return typeof l === "number" && typeof r === "number" ? l * r : null;
    case "/":
      return typeof l === "number" && typeof r === "number" && r !== 0 ? l / r : null;
  }
}

function call(e: Extract<ExprNode, { k: "call" }>, ctx: EvalContext): unknown {
  const a = e.args.map((x) => evaluate(x, ctx));
  const [x, y] = a;
  switch (e.fn) {
    case "today":
      return ctx.today;
    case "now":
      return ctx.now;
    case "days_between":
      return typeof x === "string" && typeof y === "string" && isTime(x) && isTime(y) ? Math.round((ms(y) - ms(x)) / DAY) : null;
    case "year":
      return typeof x === "string" && isTime(x) ? Number(x.slice(0, 4)) : null;
    case "month":
      return typeof x === "string" && isTime(x) ? Number(x.slice(5, 7)) : null;
    case "day":
      return typeof x === "string" && isTime(x) ? Number(x.slice(8, 10)) : null;
    case "lower":
      return typeof x === "string" ? x.toLowerCase() : null;
    case "upper":
      return typeof x === "string" ? x.toUpperCase() : null;
    case "trim":
      return typeof x === "string" ? x.trim() : null;
    case "len":
      return typeof x === "string" || Array.isArray(x) ? x.length : null;
    case "contains":
      if (Array.isArray(x)) return x.includes(y);
      return typeof x === "string" && typeof y === "string" ? x.toLowerCase().includes(y.toLowerCase()) : false;
    case "is_empty":
      return x === null || (Array.isArray(x) && x.length === 0);
    case "coalesce":
      return x ?? y ?? null;
    case "round": {
      if (typeof x !== "number") return null;
      const p = 10 ** (typeof y === "number" ? y : 0);
      return Math.round(x * p) / p;
    }
    case "abs":
      return typeof x === "number" ? Math.abs(x) : null;
    default:
      throw new ExprRuntimeError(`Unknown function "${e.fn}".`, e.at);
  }
}

function norm(v: unknown): unknown {
  if (v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function truthy(v: unknown): boolean {
  return v === true;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "string" && typeof b === "string" && isTime(a) && isTime(b) && (DATE.test(a) !== DATE.test(b))) {
    // A date equals a datetime on the same day.
    return a.slice(0, 10) === b.slice(0, 10);
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

function compare(a: unknown, b: unknown): number | undefined {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    if (isTime(a) && isTime(b)) return ms(a) - ms(b);
    return a.localeCompare(b);
  }
  return undefined;
}

function isTime(s: string): boolean {
  return DATE.test(s) || (/^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s)));
}

function ms(s: string): number {
  return DATE.test(s) ? Date.parse(`${s}T00:00:00Z`) : Date.parse(s);
}

function addDays(s: string, days: number): string {
  const t = new Date(ms(s) + Math.round(days * DAY));
  return DATE.test(s) ? t.toISOString().slice(0, 10) : t.toISOString();
}
