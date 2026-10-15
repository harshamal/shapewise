import { describe, expect, it } from "vitest";
import { ToolDefinition, toolName } from "../src";

describe("toolName", () => {
  it("joins verb and entity key", () => {
    expect(toolName("confirm", "sales_order")).toBe("confirm_sales_order");
    expect(toolName("get_metric")).toBe("get_metric");
  });

  it("keeps long names unique and within 64 chars", () => {
    // Keys are capped at 48 chars, but verb + key can still exceed 64.
    const verb = "receive_output_into_stock";
    const [k1, k2] = ["injection_moulding_production_job_for_line_one", "injection_moulding_production_job_for_line_two"];
    expect(`${verb}_${k1}`.length).toBeGreaterThan(64);
    const a = toolName(verb, k1);
    const b = toolName(verb, k2);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).not.toBe(b);
  });

  it("rejects non snake_case input", () => {
    expect(() => toolName("Confirm", "order")).toThrow();
  });
});

describe("ToolDefinition", () => {
  it("accepts a write tool bound to a lifecycle action", () => {
    const def = {
      name: "confirm_sales_order",
      kind: "action",
      description: "Confirm a draft sales order.",
      inputSchema: { type: "object", properties: { record_id: { type: "string" } }, required: ["record_id"] },
      annotations: { title: "Confirm sales order", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      target: "sales_order",
      command: { type: "record.action", target: "sales_order", action: "confirm" },
      requires: { target: "sales_orders", action: "approve" },
      mayNeedApproval: true,
    };
    expect(ToolDefinition.safeParse(def).success).toBe(true);
  });
});
