import { describe, expect, it } from "vitest";
import { Blueprint, CORE_RECORD_KEYS, type Entity } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import {
  InvalidPathSegment,
  SLOT_KINDS,
  assignSlots,
  blueprintDocId,
  buildIndexes,
  mcpTokenPath,
  rollupDocId,
  slotsForCore,
  slotsForEntity,
  tenantPaths,
} from "../src";

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

  it("fits every core record's indexed fields with room to spare", () => {
    for (const key of CORE_RECORD_KEYS) {
      const { slots, overflow } = slotsForCore(key, []);
      expect(overflow, key).toEqual([]);
      for (const kind of Object.keys(SLOT_KINDS) as (keyof typeof SLOT_KINDS)[]) {
        const used = Object.values(slots).filter((s) => s.startsWith(kind)).length;
        expect(used, `${key} uses ${used} ${kind} slots`).toBeLessThanOrEqual(SLOT_KINDS[kind] - 2);
      }
    }
  });

  it("gives custom fields on core records the slots after the core ones", () => {
    const { slots } = slotsForCore("item", bp.customFields);
    expect(slots.sku).toBe("s1");
    expect(slots.fld_resingrade).toMatch(/^s\d$/);
    expect(slots.fld_shape).toMatch(/^s\d$/);
    expect(new Set(Object.values(slots)).size).toBe(Object.keys(slots).length);
  });

  it("keeps core slots fixed even if previous assignments disagree", () => {
    const { slots } = slotsForCore("item", bp.customFields, { fld_resingrade: "s1" });
    expect(slots.sku).toBe("s1");
    expect(slots.fld_resingrade).not.toBe("s1");
  });

  it("assigns typed slots to custom record types", () => {
    const maint = bp.entities.find((e) => e.key === "maintenance")!;
    const { slots, overflow } = slotsForEntity(maint);
    expect(slots).toEqual({ fld_mres: "r1", fld_mkind: "s1", fld_mdue: "d1", fld_mtech: "r2" });
    expect(overflow).toEqual([]);
  });

  it("keeps previous slots stable when fields are added before them", () => {
    const maint = bp.entities.find((e) => e.key === "maintenance")!;
    const first = slotsForEntity(maint).slots;
    const grown: Entity = { ...maint, fields: [{ id: "fld_mline", key: "line", label: "Line", type: "ref", to: "resource", filterable: true }, ...maint.fields] };
    const next = slotsForEntity(grown, first).slots;
    expect(next.fld_mres).toBe("r1");
    expect(next.fld_mline).toBe("r3");
  });

  it("reports overflow when a slot kind runs out", () => {
    const many = Array.from({ length: SLOT_KINDS.r + 1 }, (_, i) => ({ id: `fld_r${i}`, type: "ref" as const }));
    expect(assignSlots(many).overflow).toEqual([{ fieldId: `fld_r${SLOT_KINDS.r}`, reason: "slots_full" }]);
  });
});

describe("index catalogue", () => {
  it("stays well under Firestore's composite index limit and has no duplicates", () => {
    const { indexes } = buildIndexes();
    expect(indexes.length).toBeLessThanOrEqual(150);
    const keys = indexes.map((i) => i.collectionGroup + JSON.stringify(i.fields));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
