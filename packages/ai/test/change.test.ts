import { describe, expect, it } from "vitest";
import { Blueprint } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import { ChangePlan, buildChange, describeChange, draftChange, type Llm } from "../src";

const bp = Blueprint.parse(plasticsFactory);
const none: ChangePlan = ChangePlan.parse({
  understood: true, question: "", summary: "x", addModules: [], removeModules: [], addExtensions: [], removeExtensions: [], hideScreens: [], showScreens: [], renameScreens: [],
  settings: {}, customFields: [], recordTypeFields: [], recordTypes: [], removeFields: [], removeRecordTypes: [], rules: [], views: [], approvals: [], roles: [],
});

describe("change studio", () => {
  it("adds a field to a core document on top of the live setup, keeping everything else", () => {
    const r = buildChange(bp, { ...none, customFields: [{ key: "seal_no", label: "Seal number", type: "text", required: false, record: "delivery_note", part: "header", showOnDocuments: true, showInProduction: false }] });
    expect(r.issues).toEqual([]);
    const after = r.blueprint!;
    expect(after.customFields.length).toBe(bp.customFields.length + 1);
    expect(after.entities.map((e) => e.id)).toEqual(bp.entities.map((e) => e.id));
    expect(after.rules.map((x) => x.id)).toEqual(bp.rules.map((x) => x.id));
    expect(after.approvals.map((x) => x.id)).toEqual(bp.approvals.map((x) => x.id));
    expect(after.settings.accounting.chartTemplate).toBe(bp.settings.accounting.chartTemplate);
    expect(describeChange(bp, after)).toEqual(['Adds "Seal number" to delivery notes.']);
  });

  it("adds a record type and a rule on it, and a field to an existing record type", () => {
    const r = buildChange(bp, {
      ...none,
      recordTypes: [{ key: "complaint", label: "Complaint", labelPlural: "Complaints", module: "sales", titleField: "subject", fields: [{ key: "subject", label: "Subject", type: "text", required: true }, { key: "customer", label: "Customer", type: "ref", refTo: "customer", required: false }], why: "x" }],
      rules: [{ label: "Complaints need a subject", record: "complaint", on: ["create"], when: "is_empty(subject)", effect: "reject", message: "Add a subject." }],
      recordTypeFields: [{ recordType: "maintenance", field: { key: "parts_cost", label: "Parts cost", type: "money", required: false } }],
    });
    expect(r.issues).toEqual([]);
    const lines = describeChange(bp, r.blueprint!);
    expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/^Adds Complaints \(Subject, Customer\)/), "New rule on complaints: Complaints need a subject.", 'Adds "Parts cost" to maintenance.']));
  });

  it("hides, renames and switches things, and refuses a key that's taken", () => {
    const r = buildChange(bp, { ...none, hideScreens: ["quotes"], renameScreens: [{ key: "delivery_notes", label: "Dispatch notes" }], addExtensions: ["moq"] });
    expect(r.issues).toEqual([]);
    expect(describeChange(bp, r.blueprint!)).toEqual(expect.arrayContaining(["Hides Quotes.", 'Renames Delivery notes to "Dispatch notes".']));
    const clash = buildChange(bp, { ...none, recordTypes: [{ key: "maintenance", label: "M", labelPlural: "Ms", module: "production", titleField: "t", fields: [{ key: "t", label: "T", type: "text", required: true }], why: "x" }] });
    expect(clash.issues[0]?.message).toMatch(/already a record type/);
  });

  it("removes a custom field when asked", () => {
    const field = bp.customFields[0]!;
    const r = buildChange(bp, { ...none, removeFields: [{ record: field.target, key: field.field.key }] });
    expect(describeChange(bp, r.blueprint!)).toEqual([expect.stringMatching(/^Removes ".*" from /)]);
  });

  it("asks back when the request isn't a change", async () => {
    const llm: Llm = { provider: "azure-openai", turn: async () => ({}) as never, json: async () => ({ value: { ...none, understood: false, question: "Do you want a report instead?" }, usage: { input: 1, output: 1, model: "f" } }) as never };
    expect(await draftChange(llm, bp, "how much did we sell")).toMatchObject({ ok: false, question: "Do you want a report instead?" });
  });
});

describe("change studio duplicates", () => {
  it("leaves out a field the document already has, but keeps a new one", () => {
    const r = buildChange(bp, {
      ...none,
      customFields: [
        { key: "vehicle_no", label: "Vehicle number", type: "text", required: false, record: "delivery_note", part: "header", showOnDocuments: true, showInProduction: false },
        { key: "driver_phone", label: "Driver phone", type: "phone", required: false, record: "delivery_note", part: "header", showOnDocuments: true, showInProduction: false },
      ],
    });
    expect(describeChange(bp, r.blueprint!)).toEqual(['Adds "Driver phone" to delivery notes.']);
    expect(r.notes.join(" ")).toMatch(/already have "Vehicle"/);
  });
});
