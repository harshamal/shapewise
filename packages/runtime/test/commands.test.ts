import { describe, expect, it } from "vitest";
import { CommandEnvelope, CommandResult } from "../src";

const envelope = {
  id: "7d3f8a1e-2b4c-4d5e-9f6a-1b2c3d4e5f60",
  tenantId: "t_demo",
  actor: { kind: "agent", id: "tok_abc", roleKey: "supervisor", channel: "mcp", clientName: "ADK demo" },
  issuedAt: "2026-10-16T08:00:00.000Z",
  idempotencyKey: "job-42-stage-2",
};

describe("command envelope", () => {
  it("accepts each command type", () => {
    const commands = [
      { type: "record.create", entity: "ent_customer", data: { fld_cname: "Perera Stores" } },
      { type: "record.update", entity: "ent_customer", recordId: "r1", patch: { fld_cphone: "0771234567" }, expectedVersion: 3 },
      { type: "record.delete", entity: "ent_customer", recordId: "r1" },
      { type: "record.transition", entity: "ent_order", recordId: "r2", transition: "tr_conf" },
      { type: "engine.action", binding: "production.job", action: "record_scrap", entity: "ent_job", recordId: "r3", input: { qty: 12 } },
      { type: "approval.decide", approvalId: "a1", decision: "approve" },
      { type: "change.propose", request: "Add a regrind stage after moulding" },
      { type: "change.apply", changeId: "c1" },
      { type: "change.undo", changeId: "c1" },
    ];
    for (const command of commands) {
      const r = CommandEnvelope.safeParse({ ...envelope, command });
      expect(r.success, `${command.type}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
    }
  });

  it("rejects unknown engine bindings and bad entity ids", () => {
    expect(CommandEnvelope.safeParse({ ...envelope, command: { type: "engine.action", binding: "x.y", action: "go", entity: "ent_job", input: {} } }).success).toBe(false);
    expect(CommandEnvelope.safeParse({ ...envelope, command: { type: "record.create", entity: "customer", data: {} } }).success).toBe(false);
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
