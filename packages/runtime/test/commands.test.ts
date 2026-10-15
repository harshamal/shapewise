import { describe, expect, it } from "vitest";
import { CommandEnvelope, CommandResult } from "../src";

const envelope = {
  id: "7d3f8a1e-2b4c-4d5e-9f6a-1b2c3d4e5f60",
  tenantId: "t_demo",
  actor: { kind: "agent", id: "tok_abc", roleKey: "supervisor", channel: "mcp", clientName: "ADK demo" },
  issuedAt: "2026-10-16T08:00:00.000Z",
  idempotencyKey: "batch-42-release",
};

describe("command envelope", () => {
  it("accepts each command type", () => {
    const commands = [
      { type: "record.create", target: "customer", data: { name: "Perera Stores" } },
      { type: "record.create", target: "ent_maint", data: { fld_mtitle: "Replace heater band" } },
      { type: "record.update", target: "customer", recordId: "r1", patch: { phone: "0771234567" }, expectedVersion: 3 },
      { type: "record.delete", target: "ent_maint", recordId: "r1" },
      { type: "record.action", target: "invoice", recordId: "r2", action: "post" },
      { type: "record.action", target: "batch", recordId: "r3", action: "release", data: { qc_note: "ok" } },
      { type: "record.convert", from: "quote", recordId: "r4", to: "sales_order" },
      { type: "record.convert", from: "sales_order", recordId: "r5", to: "delivery_note", lines: [{ lineId: "l1", quantity: 500 }] },
      { type: "approval.decide", approvalId: "a1", decision: "approve" },
      { type: "change.propose", request: "Add a regrind step after moulding" },
      { type: "change.apply", changeId: "c1" },
      { type: "change.undo", changeId: "c1" },
    ];
    for (const command of commands) {
      const r = CommandEnvelope.safeParse({ ...envelope, command });
      expect(r.success, `${command.type}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
    }
  });

  it("rejects unknown record types", () => {
    expect(CommandEnvelope.safeParse({ ...envelope, command: { type: "record.create", target: "spaceship", data: {} } }).success).toBe(false);
    expect(CommandEnvelope.safeParse({ ...envelope, command: { type: "record.convert", from: "quote", recordId: "r", to: "ent_x" } }).success).toBe(false);
  });
});

describe("command result", () => {
  it("defaults effects and warnings on ok", () => {
    const r = CommandResult.parse({ status: "ok", commandId: envelope.id });
    expect(r).toMatchObject({ effects: {}, warnings: [] });
  });

  it("parses a parked command", () => {
    const r = CommandResult.parse({ status: "pending_approval", commandId: envelope.id, approvalId: "a1", policyId: "apr_bigso", reason: "Large orders need the owner" });
    expect(r.status).toBe("pending_approval");
  });
});
