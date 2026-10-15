import { describe, expect, it } from "vitest";
import { ClaimsTooLarge, roleIn, safeNext, sameOrigin, withMembership, workspaceAccess } from "../src/lib/auth/policy";

describe("membership claims", () => {
  it("adds, changes and removes a workspace without touching other claims", () => {
    const a = withMembership({ admin: false }, "t_acme", "owner");
    expect(a).toEqual({ admin: false, tenants: { t_acme: "owner" } });
    const b = withMembership(a, "t_beta", "qc");
    expect(b.tenants).toEqual({ t_acme: "owner", t_beta: "qc" });
    expect(withMembership(b, "t_acme", null).tenants).toEqual({ t_beta: "qc" });
  });

  it("refuses bad ids and roles", () => {
    expect(() => withMembership({}, "../x", "owner")).toThrow();
    expect(() => withMembership({}, "t_acme", "Owner!")).toThrow();
  });

  it("stays under Firebase's custom-claims size limit", () => {
    let claims: Record<string, unknown> = {};
    expect(() => {
      for (let i = 0; i < 100; i++) claims = withMembership(claims, `tenant_${i}_xxxxxxxx`, "production_supervisor");
    }).toThrow(ClaimsTooLarge);
  });

  it("reads a role defensively", () => {
    expect(roleIn({ tenants: { t1: "owner" } }, "t1")).toBe("owner");
    expect(roleIn({ tenants: { t1: 5 } }, "t1")).toBeNull();
    expect(roleIn(null, "t1")).toBeNull();
  });
});

describe("workspace access", () => {
  it("lets anyone open the demos, as a guest unless they are a member", () => {
    expect(workspaceAccess("demo", null)).toEqual({ ok: true, role: null });
    expect(workspaceAccess("demo", { tenants: { demo: "qc" } })).toEqual({ ok: true, role: "qc" });
  });

  it("sends guests to sign in and blocks non-members", () => {
    expect(workspaceAccess("t_acme", null)).toEqual({ ok: false, reason: "sign_in" });
    expect(workspaceAccess("t_acme", { tenants: { t_beta: "owner" } })).toEqual({ ok: false, reason: "not_member" });
    expect(workspaceAccess("t_acme", { tenants: { t_acme: "sales" } })).toEqual({ ok: true, role: "sales" });
  });
});

describe("redirect and origin guards", () => {
  it("only follows same-site paths", () => {
    expect(safeNext("/w/demo")).toBe("/w/demo");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "w/demo", "/w\r\nSet-Cookie: x", null]) {
      expect(safeNext(bad as string | null), String(bad)).toBe("/");
    }
  });

  it("accepts only requests from this site", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(sameOrigin(h({ origin: "http://localhost:3100", host: "localhost:3100" }))).toBe(true);
    expect(sameOrigin(h({ origin: "https://app.example", host: "internal:8080", "x-forwarded-host": "app.example" }))).toBe(true);
    expect(sameOrigin(h({ origin: "https://evil.example", host: "localhost:3100" }))).toBe(false);
    expect(sameOrigin(h({ host: "localhost:3100" }))).toBe(false);
  });
});
