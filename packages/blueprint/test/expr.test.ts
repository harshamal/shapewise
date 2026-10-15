import { describe, expect, it } from "vitest";
import { ExprSyntaxError, checkExpr, evaluate, parseExpr, test as holds, type EvalContext, type ExprEnv, type ExprType } from "../src";

const num: ExprType = { t: "number" };
const FIELDS: Record<string, Record<string, ExprType>> = {
  sales_order: {
    total: num,
    status: { t: "text", options: ["draft", "confirmed", "closed"] },
    delivery_date: { t: "date" },
    customer: { t: "ref", to: "customer" },
    created_by: { t: "user" },
  },
  customer: { name: { t: "text" }, order_count: num, days_overdue: num, tags: { t: "list", of: { t: "text" } } },
  invoice: { amount_due: num, customer: { t: "ref", to: "customer" }, status: { t: "text", options: ["draft", "posted", "void"] } },
};
const env = (target = "sales_order", vars?: ExprEnv["vars"]): ExprEnv => ({
  target,
  fields: (t) => (FIELDS[t] ? new Map(Object.entries(FIELDS[t]!)) : undefined),
  vars,
});
const problems = (src: string, e = env(), expect?: ExprType["t"]) => checkExpr(src, e, expect).problems.map((p) => p.message);

describe("parser", () => {
  it("respects precedence", () => {
    const ast = parseExpr("a = 1 or b = 2 and not c");
    expect(ast).toMatchObject({ k: "bin", op: "or", r: { k: "bin", op: "and", r: { k: "not" } } });
    expect(parseExpr("1 + 2 * 3")).toMatchObject({ k: "bin", op: "+", r: { k: "bin", op: "*" } });
  });

  it("reads paths, lists, functions and aggregates", () => {
    expect(parseExpr("customer.order_count")).toMatchObject({ k: "path", parts: ["customer", "order_count"] });
    expect(parseExpr("kind not in ('a', 'b')")).toMatchObject({ k: "in", negated: true, list: [{ v: "a" }, { v: "b" }] });
    expect(parseExpr("today() + 7")).toMatchObject({ k: "bin", l: { k: "call", fn: "today" } });
    expect(parseExpr("sum(invoice.amount_due where customer = this)")).toMatchObject({ k: "agg", fn: "sum", target: "invoice", field: "amount_due", where: { k: "bin" } });
    expect(parseExpr("1_000_000")).toMatchObject({ v: 1_000_000 });
  });

  it("reports syntax errors with a position", () => {
    for (const bad of ["total >", "(a = 1", "'open", "a ! b", "x in 1", "count()"]) {
      expect(() => parseExpr(bad), bad).toThrow(ExprSyntaxError);
    }
    try {
      parseExpr("total > > 5");
    } catch (e) {
      expect((e as ExprSyntaxError).at).toBe(8);
    }
  });

  it("refuses very deep nesting", () => {
    expect(() => parseExpr("(".repeat(40) + "1" + ")".repeat(40))).toThrow(/nested too deeply/);
  });
});

describe("type checker", () => {
  it("accepts well-typed expressions", () => {
    for (const ok of [
      "total > 50000 and status = 'confirmed'",
      "customer.order_count >= 5",
      "delivery_date <= today() + 7",
      "days_between(delivery_date, today()) > 3",
      "contains(customer.tags, 'vip')",
      "count(sales_order where customer = this.customer) > 3",
      "sum(invoice.amount_due where customer = this.customer and status = 'posted') > 100000",
      "created_by = $user",
    ]) {
      expect(problems(ok, env("sales_order", { $user: { t: "user" } }), "boolean"), ok).toEqual([]);
    }
  });

  it("suggests the field that was probably meant", () => {
    expect(problems("customer.order_cout > 5")).toEqual([`Unknown field "order_cout" on customer. Did you mean "order_count"?`]);
  });

  it("checks select values against their options", () => {
    expect(problems("status = 'confimed'")[0]).toMatch(/isn't one of the options.*Did you mean "confirmed"/);
  });

  it("catches type mistakes", () => {
    expect(problems("total > 'big'")[0]).toMatch(/Can't compare|compares/);
    expect(problems("status and total > 1")[0]).toMatch(/needs yes\/no/);
    expect(problems("customer > 5")[0]).toMatch(/compares numbers/);
    expect(problems("sum(invoice.status)")[0]).toMatch(/needs a number field/);
    expect(problems("total + 1", env(), "boolean")[0]).toMatch(/should give yes\/no/);
    expect(problems("teleport(1)")[0]).toMatch(/Unknown function/);
  });

  it("scopes 'where' to the counted record and 'this' to the outer one", () => {
    // Inside the aggregate, `customer` is the invoice's customer field.
    expect(problems("count(invoice where customer = this.customer)")).toEqual([]);
    expect(problems("count(invoice where order_count > 1)")[0]).toMatch(/Unknown field "order_count" on invoice/);
  });
});

describe("evaluator", () => {
  const record: Record<string, unknown> = {
    id: "so_1",
    total: 75_000,
    status: "confirmed",
    delivery_date: "2026-10-20",
    customer: { id: "c_1", order_count: 6, tags: ["vip"] },
    notes: null,
  };
  const ctx: EvalContext = {
    today: "2026-10-16",
    now: "2026-10-16T08:00:00.000Z",
    get: (parts) => parts.reduce<unknown>((v, p) => (v && typeof v === "object" ? (v as Record<string, unknown>)[p] : undefined), record),
    aggregate: (a) => (a.fn === "count" ? 4 : 1000),
  };
  const run = (src: string) => evaluate(parseExpr(src), ctx);

  it("evaluates comparisons, logic and paths", () => {
    expect(run("total > 50000 and status = 'confirmed'")).toBe(true);
    expect(run("customer.order_count >= 5")).toBe(true);
    expect(run("status in ('draft', 'closed')")).toBe(false);
    expect(run("contains(customer.tags, 'vip')")).toBe(true);
  });

  it("does date arithmetic", () => {
    expect(run("today() + 7")).toBe("2026-10-23");
    expect(run("delivery_date <= today() + 7")).toBe(true);
    expect(run("days_between(today(), delivery_date)")).toBe(4);
    expect(run("delivery_date - today()")).toBe(4);
  });

  it("treats missing values safely", () => {
    expect(run("notes = null")).toBe(true);
    expect(run("notes > 5")).toBe(false);
    expect(run("missing_field + 1")).toBe(null);
    expect(holds(parseExpr("not missing_field"), ctx)).toBe(false);
    expect(run("total / 0")).toBe(null);
  });

  it("delegates aggregates to the database", () => {
    expect(run("count(sales_order where customer = this.customer) + 1")).toBe(5);
  });
});
