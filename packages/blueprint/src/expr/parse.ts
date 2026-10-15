/**
 * Shapewise expressions: a small, safe language for rule conditions, computed
 * fields, view filters, approval conditions and row scopes. Parsed into an
 * AST and interpreted; nothing is ever passed to `eval`.
 *
 *   customer.order_count >= 5
 *   status = 'qc_hold' and due_date <= today() + 7
 *   kind in ('planned', 'breakdown')
 *   count(sales_order where customer = this)
 *   sum(invoice.amount_due where customer = this and status = 'posted')
 *   technician = $user
 *
 * Precedence, lowest first: or · and · not · comparison / in · + - · * / · unary - · call, path, literal.
 */

export type BinaryOp = "or" | "and" | "=" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/";
export const AGGREGATES = ["count", "sum", "avg", "min", "max"] as const;
export type AggregateFn = (typeof AGGREGATES)[number];

export type ExprNode =
  | { k: "num"; v: number; at: number }
  | { k: "str"; v: string; at: number }
  | { k: "bool"; v: boolean; at: number }
  | { k: "null"; at: number }
  | { k: "path"; parts: string[]; at: number }
  | { k: "not"; e: ExprNode; at: number }
  | { k: "neg"; e: ExprNode; at: number }
  | { k: "bin"; op: BinaryOp; l: ExprNode; r: ExprNode; at: number }
  | { k: "in"; e: ExprNode; list: ExprNode[]; negated: boolean; at: number }
  | { k: "call"; fn: string; args: ExprNode[]; at: number }
  /** count(target where cond), sum(target.field where cond) */
  | { k: "agg"; fn: AggregateFn; target: string; field?: string; where?: ExprNode; at: number };

export class ExprSyntaxError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
    this.name = "ExprSyntaxError";
  }
}

/* ------------------------------------------------------------------- lexer */

type Tok =
  | { t: "num"; v: number; at: number }
  | { t: "str"; v: string; at: number }
  | { t: "id"; v: string; at: number }
  | { t: "op"; v: string; at: number }
  | { t: "eof"; at: number };

const KEYWORDS = new Set(["and", "or", "not", "in", "where", "true", "false", "null"]);
const MAX_LENGTH = 500;
const MAX_DEPTH = 32;

function lex(src: string): Tok[] {
  if (src.length > MAX_LENGTH) throw new ExprSyntaxError(`Expressions are limited to ${MAX_LENGTH} characters.`, MAX_LENGTH);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const at = i;
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9_]/.test(src[j]!)) j++;
      if (src[j] === "." && /[0-9]/.test(src[j + 1] ?? "")) {
        j++;
        while (j < src.length && /[0-9_]/.test(src[j]!)) j++;
      }
      // 1_000_000 is allowed for readability.
      out.push({ t: "num", v: Number(src.slice(i, j).replaceAll("_", "")), at });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let v = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        v += src[j];
        j++;
      }
      if (j >= src.length) throw new ExprSyntaxError("Text is missing its closing quote.", at);
      out.push({ t: "str", v, at });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ t: "id", v: src.slice(i, j), at });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "!=", "==", "<>"].includes(two)) {
      out.push({ t: "op", v: two === "==" ? "=" : two === "<>" ? "!=" : two, at });
      i += 2;
      continue;
    }
    if ("=<>+-*/(),.".includes(c)) {
      out.push({ t: "op", v: c, at });
      i++;
      continue;
    }
    throw new ExprSyntaxError(`Unexpected "${c}".`, at);
  }
  out.push({ t: "eof", at: src.length });
  return out;
}

/* ------------------------------------------------------------------ parser */

export function parseExpr(src: string): ExprNode {
  const toks = lex(src);
  let p = 0;
  let depth = 0;

  const peek = () => toks[p]!;
  const next = () => toks[p++]!;
  const isOp = (v: string) => peek().t === "op" && (peek() as { v: string }).v === v;
  const isKw = (v: string) => peek().t === "id" && (peek() as { v: string }).v.toLowerCase() === v;
  const expectOp = (v: string, what: string) => {
    if (!isOp(v)) throw new ExprSyntaxError(`Expected ${what}.`, peek().at);
    next();
  };
  const nest = <T>(f: () => T): T => {
    if (++depth > MAX_DEPTH) throw new ExprSyntaxError("Expression is nested too deeply.", peek().at);
    try {
      return f();
    } finally {
      depth--;
    }
  };

  const orExpr = (): ExprNode => {
    let l = andExpr();
    while (isKw("or")) {
      const at = next().at;
      l = { k: "bin", op: "or", l, r: andExpr(), at };
    }
    return l;
  };
  const andExpr = (): ExprNode => {
    let l = notExpr();
    while (isKw("and")) {
      const at = next().at;
      l = { k: "bin", op: "and", l, r: notExpr(), at };
    }
    return l;
  };
  const notExpr = (): ExprNode => {
    if (isKw("not") && !(toks[p + 1]?.t === "id" && (toks[p + 1] as { v: string }).v.toLowerCase() === "in")) {
      const at = next().at;
      return nest(() => ({ k: "not", e: notExpr(), at }));
    }
    return compare();
  };
  const compare = (): ExprNode => {
    const l = additive();
    if (peek().t === "op" && ["=", "!=", "<", "<=", ">", ">="].includes((peek() as { v: string }).v)) {
      const t = next() as { v: BinaryOp; at: number };
      return { k: "bin", op: t.v, l, r: additive(), at: t.at };
    }
    const negated = isKw("not") && toks[p + 1]?.t === "id" && (toks[p + 1] as { v: string }).v.toLowerCase() === "in";
    if (negated || isKw("in")) {
      const at = peek().at;
      if (negated) next();
      next();
      expectOp("(", `"(" after "in"`);
      const list: ExprNode[] = [];
      if (!isOp(")")) {
        do list.push(orExpr());
        while (isOp(",") && next());
      }
      expectOp(")", `")" to close the list`);
      return { k: "in", e: l, list, negated, at };
    }
    return l;
  };
  const additive = (): ExprNode => {
    let l = multiplicative();
    while (isOp("+") || isOp("-")) {
      const t = next() as { v: BinaryOp; at: number };
      l = { k: "bin", op: t.v, l, r: multiplicative(), at: t.at };
    }
    return l;
  };
  const multiplicative = (): ExprNode => {
    let l = unary();
    while (isOp("*") || isOp("/")) {
      const t = next() as { v: BinaryOp; at: number };
      l = { k: "bin", op: t.v, l, r: unary(), at: t.at };
    }
    return l;
  };
  const unary = (): ExprNode => {
    if (isOp("-")) {
      const at = next().at;
      return nest(() => ({ k: "neg", e: unary(), at }));
    }
    return primary();
  };
  const primary = (): ExprNode => {
    const t = peek();
    if (t.t === "num") return (next(), { k: "num", v: t.v, at: t.at });
    if (t.t === "str") return (next(), { k: "str", v: t.v, at: t.at });
    if (t.t === "op" && t.v === "(") {
      next();
      const e = nest(orExpr);
      expectOp(")", `")"`);
      return e;
    }
    if (t.t === "id") {
      const word = t.v.toLowerCase();
      if (word === "true" || word === "false") return (next(), { k: "bool", v: word === "true", at: t.at });
      if (word === "null") return (next(), { k: "null", at: t.at });
      if (KEYWORDS.has(word)) throw new ExprSyntaxError(`"${t.v}" can't start a value.`, t.at);
      next();
      if (isOp("(")) {
        next();
        if ((AGGREGATES as readonly string[]).includes(word)) return aggregate(word as AggregateFn, t.at);
        const args: ExprNode[] = [];
        if (!isOp(")")) {
          do args.push(nest(orExpr));
          while (isOp(",") && next());
        }
        expectOp(")", `")" to close ${t.v}(`);
        return { k: "call", fn: word, args, at: t.at };
      }
      const parts = [t.v];
      while (isOp(".")) {
        next();
        const n = next();
        if (n.t !== "id") throw new ExprSyntaxError(`Expected a field name after ".".`, n.at);
        parts.push(n.v);
      }
      return { k: "path", parts, at: t.at };
    }
    if (t.t === "eof") throw new ExprSyntaxError("The expression ends too early.", t.at);
    throw new ExprSyntaxError(`Unexpected "${(t as { v: string }).v}".`, t.at);
  };
  const aggregate = (fn: AggregateFn, at: number): ExprNode => {
    const target = next();
    if (target.t !== "id") throw new ExprSyntaxError(`${fn}( needs a record type, e.g. ${fn}(invoice where ...).`, target.at);
    let field: string | undefined;
    if (isOp(".")) {
      next();
      const f = next();
      if (f.t !== "id") throw new ExprSyntaxError(`Expected a field name after ".".`, f.at);
      field = f.v;
    }
    let where: ExprNode | undefined;
    if (isKw("where")) {
      next();
      where = nest(orExpr);
    }
    expectOp(")", `")" to close ${fn}(`);
    return { k: "agg", fn, target: target.v, field, where, at };
  };

  const e = orExpr();
  if (peek().t !== "eof") throw new ExprSyntaxError(`Unexpected "${(peek() as { v?: string }).v ?? ""}" after the expression.`, peek().at);
  return e;
}

/** Every field path and aggregate an expression reads, for the dependency graph. */
export function exprReads(e: ExprNode): { paths: string[][]; aggregates: Extract<ExprNode, { k: "agg" }>[] } {
  const paths: string[][] = [];
  const aggregates: Extract<ExprNode, { k: "agg" }>[] = [];
  const walk = (x: ExprNode) => {
    switch (x.k) {
      case "path":
        paths.push(x.parts);
        break;
      case "not":
      case "neg":
        walk(x.e);
        break;
      case "bin":
        walk(x.l);
        walk(x.r);
        break;
      case "in":
        walk(x.e);
        x.list.forEach(walk);
        break;
      case "call":
        x.args.forEach(walk);
        break;
      case "agg":
        aggregates.push(x);
        break;
    }
  };
  walk(e);
  return { paths, aggregates };
}
