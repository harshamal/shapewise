import { describe, expect, it } from "vitest";
import { Blueprint, type Entity } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import { InvalidPathSegment, assignSlots, blueprintDocId, buildIndexes, mcpTokenPath, rollupDocId, tenantPaths } from "../src";

describe("tenant paths", () => {
  it("builds paths under the tenant", () => {
    const p = tenantPaths("t_demo");
    expect(p.doc("records", "r_123")).toBe("tenants/t_demo/records/r_123");
    expect(p.collection("journal")).toBe("tenants/t_demo/journal");
  });

  it("refuses ids that could escape the tenant", () => {
    for (const bad of ["../t_other", "a/b", "..", "", "__name__", "x".repeat(129)]) {
      expect(() => tenantPaths(bad)).toThrow(InvalidPathSegment);
      expect(() => tenantPaths("t_demo").doc("records", bad)).toThrow(InvalidPathSegment);
    }
  });

  it("formats derived doc ids", () => {
    expect(blueprintDocId(12)).toBe("000012");
    expect(rollupDocId("jobs_late", new Date("2026-10-16T05:00:00Z"))).toBe("jobs_late_20261016");
    expect(() => mcpTokenPath("not-a-hash")).toThrow();
  });
});

describe("index slots", () => {
  const bp = Blueprint.parse(plasticsFactory);
  const order = bp.entities.find((e) => e.key === "sales_order")!;

  it("assigns typed slots to filterable and sortable fields", () => {
    const { slots, overflow } = assignSlots(order);
    expect(slots).toEqual({ fld_ocust: "r1", fld_odue: "d1" });
    expect(overflow).toEqual([]);
  });

  it("keeps previous slots stable when fields are added before them", () => {
    const first = assignSlots(order).slots;
    const grown: Entity = {
      ...order,
      fields: [{ id: "fld_oref", key: "customer_ref", label: "Customer ref", type: "ref", to: "ent_customer", filterable: true }, ...order.fields],
    };
    const next = assignSlots(grown, first).slots;
    expect(next.fld_ocust).toBe("r1");
    expect(next.fld_oref).toBe("r2");
  });

  it("reports overflow when a slot kind runs out", () => {
    const many: Entity = {
      ...order,
      fields: Array.from({ length: 5 }, (_, i) => ({ id: `fld_r${i}`, key: `r${i}`, label: `R${i}`, type: "ref" as const, to: "ent_customer", filterable: true })),
    };
    const { overflow } = assignSlots(many);
    expect(overflow).toEqual([{ fieldId: "fld_r4", reason: "slots_full" }]);
  });
});

describe("index catalogue", () => {
  it("stays well under Firestore's composite index limit", () => {
    const { indexes } = buildIndexes();
    expect(indexes.length).toBeLessThanOrEqual(150);
    const keys = indexes.map((i) => i.collectionGroup + JSON.stringify(i.fields));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
