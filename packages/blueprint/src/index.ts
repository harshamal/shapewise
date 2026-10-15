import { z } from "zod";
import { Blueprint } from "./schema";
import { OverlayOp } from "./overlay";

export * from "./ids";
export * from "./fields";
export * from "./catalogue";
export * from "./settings";
export * from "./seed";
export * from "./schema";
export * from "./overlay";
export * from "./validate";
export * from "./presets";
export * from "./navigation";
export * from "./expr";
export * from "./apply";

/** JSON Schema for Gemini structured output when generating a whole blueprint. */
export function blueprintJsonSchema() {
  return z.toJSONSchema(Blueprint, { target: "draft-2020-12", io: "input" });
}

/** JSON Schema for Gemini structured output when generating a change as overlay ops. */
export function overlayOpsJsonSchema() {
  return z.toJSONSchema(z.object({ summary: z.string().max(200), ops: z.array(OverlayOp).min(1).max(200) }), {
    target: "draft-2020-12",
    io: "input",
  });
}
