import { describe, expect, it } from "vitest";
import {
  Blueprint,
  CORE_RECORDS,
  EXTENSIONS,
  MODULES,
  OverlayOp,
  SUBMODULE_BY_KEY,
  blueprintJsonSchema,
  newId,
  overlayOpsJsonSchema,
} from "../src";
import { plasticsFactory } from "../src/fixtures";

describe("catalogue", () => {
  it("has unique submodule keys across modules", () => {
    const keys = MODULES.flatMap((m) => m.submodules.map((s) => s.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lists every core record in exactly one submodule", () => {
    const listed = MODULES.flatMap((m) => m.submodules.flatMap((s) => (s.record ? [s.record] : [])));
    expect(new Set(listed).size).toBe(listed.length);
    for (const key of Object.keys(CORE_RECORDS)) expect(listed, key).toContain(key);
  });

  it("references only real records, extensions and states", () => {
    const extKeys = new Set(EXTENSIONS.map((e) => e.key));
    for (const s of SUBMODULE_BY_KEY.values()) if (s.extension) expect(extKeys.has(s.extension), s.key).toBe(true);
    for (const e of EXTENSIONS) for (const r of e.requires) expect(extKeys.has(r), `${e.key} requires ${r}`).toBe(true);
    for (const rec of Object.values(CORE_RECORDS)) {
      const all = [...rec.fields, ...(rec.lines?.fields ?? []), ...(rec.children ?? []).flatMap((c) => c.fields)];
      for (const f of all) if (f.to && f.to !== "user") expect(f.to in CORE_RECORDS, `${rec.key}.${f.key}`).toBe(true);
      for (const c of rec.children ?? []) expect(new Set(c.fields.map((f) => f.key)).size, `${rec.key}.${c.key} keys`).toBe(c.fields.length);
      for (const c of rec.convertsTo ?? []) expect(c.to in CORE_RECORDS).toBe(true);
      if (rec.amountField) expect(rec.fields.some((f) => f.key === rec.amountField), rec.key).toBe(true);
      // Required fields must be fields people can fill in.
      for (const f of [...rec.fields, ...(rec.lines?.fields ?? [])]) if (f.required) expect(f.system, `${rec.key}.${f.key} is required but system-set`).toBeFalsy();
      const lc = rec.lifecycle;
      if (!lc) continue;
      const states = new Set(lc.states.map((s) => s.key));
      expect(states.has(lc.initial), rec.key).toBe(true);
      for (const a of lc.actions) {
        for (const from of a.from) expect(states.has(from), `${rec.key}.${a.key} from ${from}`).toBe(true);
        expect(states.has(a.to), `${rec.key}.${a.key} to ${a.to}`).toBe(true);
        // Every lifecycle permission must be grantable on the record's submodule.
        const sub = [...SUBMODULE_BY_KEY.values()].find((s) => s.record === rec.key);
        if (sub) expect(sub.actions, `${rec.key}.${a.key} needs ${a.permission}`).toContain(a.permission);
      }
    }
  });
});

describe("blueprint schema", () => {
  it("parses the plastics fixture and applies defaults", () => {
    const bp = Blueprint.parse(plasticsFactory);
    expect(bp.settings.inventory.costingMethod).toBe("weighted_average");
    expect(bp.settings.production.useOperations).toBe(true);
    expect(bp.settings.sales.moqMode).toBe("block");
    expect(bp.business.fiscalYearStartMonth).toBe(4);
  });

  it("rejects ids with the wrong prefix and reports the path", () => {
    const bad = structuredClone(plasticsFactory);
    bad.entities![0]!.fields[0]!.id = "ent_wrong";
    const result = Blueprint.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["entities", 0, "fields", 0, "id"]);
  });

  it("rejects unknown extensions and record types", () => {
    const bad = structuredClone(plasticsFactory) as any;
    bad.extensions.push("teleportation");
    bad.views.push({ id: "vw_x", target: "spaceship", label: "X", type: "table" });
    expect(Blueprint.safeParse(bad).error!.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("does not allow lines inside lines", () => {
    const bad = structuredClone(plasticsFactory) as any;
    bad.entities[0].fields.push({ id: "fld_l1", key: "l1", label: "L", type: "lines", columns: [{ id: "fld_l2", key: "l2", label: "L2", type: "lines", columns: [] }] });
    expect(Blueprint.safeParse(bad).success).toBe(false);
  });
});

describe("overlay ops", () => {
  it("parses each operation", () => {
    const ops = [
      { op: "set_module", key: "pos", enabled: true },
      { op: "set_submodule", key: "quotes", enabled: false },
      { op: "set_extension", key: "lots", enabled: true },
      { op: "set_setting", path: "sales.moqMode", value: "warn" },
      { op: "set_business", patch: { name: "DP Plastics" } },
      { op: "set_grant", role: "rol_qc", target: "ncr", actions: ["view", "approve"] },
      { op: "add_seed", kind: "resources", value: { code: "IMM-04", name: "Haitian 120T", type: "machine" } },
      { op: "add", collection: "fields", parent: "ent_maint", value: { id: "fld_x", key: "x", label: "X", type: "text" } },
      { op: "update", id: "fld_mres", patch: { label: "Press" } },
      { op: "remove", id: "rul_loyal" },
      { op: "move", id: "fld_mdue", after: null },
    ];
    for (const op of ops) expect(OverlayOp.safeParse(op).success, JSON.stringify(op)).toBe(true);
  });
});

describe("json schema export", () => {
  it("produces schemas for structured output", () => {
    expect((blueprintJsonSchema() as Record<string, unknown>).type).toBe("object");
    expect(JSON.stringify(overlayOpsJsonSchema())).toContain("set_extension");
  });
});

describe("ids", () => {
  it("generates ids that pass their own schema", () => {
    expect(newId("field")).toMatch(/^fld_[a-z0-9]{8}$/);
  });
});
