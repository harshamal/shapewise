import { describe, expect, it } from "vitest";
import { Blueprint, OverlayOp, blueprintJsonSchema, newId, overlayOpsJsonSchema } from "../src";
import { plasticsFactory } from "../src/fixtures";

describe("blueprint schema", () => {
  it("accepts a complete plastics factory", () => {
    const result = Blueprint.safeParse(plasticsFactory);
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
  });

  it("applies defaults", () => {
    const bp = Blueprint.parse(plasticsFactory);
    expect(bp.business.fiscalYearStartMonth).toBe(4);
    expect(bp.modules[0]?.enabled).toBe(true);
    expect(bp.entities.find((e) => e.key === "production_job")?.stages?.[0]?.allowsScrap).toBe(true);
  });

  it("rejects ids with the wrong prefix and reports the path", () => {
    const bad = structuredClone(plasticsFactory);
    bad.entities[0]!.fields[0]!.id = "ent_wrong";
    const result = Blueprint.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["entities", 0, "fields", 0, "id"]);
  });

  it("rejects unknown field types and engine bindings", () => {
    const bad = structuredClone(plasticsFactory) as any;
    bad.entities[0].fields[0].type = "spreadsheet";
    bad.entities[1].binding = "inventory.magic";
    const result = Blueprint.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error!.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("does not allow lines inside lines", () => {
    const bad = structuredClone(plasticsFactory) as any;
    const lines = bad.entities[3].fields.find((f: any) => f.type === "lines");
    lines.columns.push({ id: "fld_nested", key: "nested", label: "Nested", type: "lines", columns: [] });
    expect(Blueprint.safeParse(bad).success).toBe(false);
  });
});

describe("overlay ops", () => {
  it("parses each operation", () => {
    const ops = [
      { op: "add", kind: "stage", parent: "ent_job", after: "stg_mould", value: { id: "stg_regrind", key: "regrind", label: "Regrind" } },
      { op: "update", id: "fld_jmach", patch: { label: "Press" } },
      { op: "remove", id: "rul_loyal" },
      { op: "set_enabled", id: "mod_sales", enabled: false },
      { op: "move", id: "stg_pack", after: null },
      { op: "set_business", patch: { name: "DP Plastics" } },
    ];
    for (const op of ops) expect(OverlayOp.safeParse(op).success, JSON.stringify(op)).toBe(true);
  });
});

describe("json schema export", () => {
  it("produces schemas for structured output", () => {
    const bp = blueprintJsonSchema() as Record<string, unknown>;
    const ov = overlayOpsJsonSchema() as Record<string, unknown>;
    expect(bp.type).toBe("object");
    expect(JSON.stringify(ov)).toContain("set_enabled");
  });
});

describe("ids", () => {
  it("generates ids that pass their own schema", () => {
    expect(newId("field")).toMatch(/^fld_[a-z0-9]{8}$/);
  });
});
