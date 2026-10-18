import { describe, expect, it } from "vitest";
import { normaliseEmail, normaliseUsername } from "../src/lib/auth/policy";

describe("credentials normalization", () => {
  it("normalises emails properly", () => {
    expect(normaliseEmail("  User@Example.Com  ")).toBe("user@example.com");
    expect(normaliseEmail("ALICE.B@COMPANY.CO.UK")).toBe("alice.b@company.co.uk");
  });

  it("normalises usernames properly", () => {
    expect(normaliseUsername("  Harshamal  ")).toBe("harshamal");
    expect(normaliseUsername("Alex_99")).toBe("alex_99");
  });
});
