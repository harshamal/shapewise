import { z } from "zod";
import { EntityId, Key } from "@shapewise/blueprint";
import type { CommandType } from "@shapewise/runtime";

/**
 * The tool manifest contract. Tools are generated once per blueprint version
 * and served unchanged to both MCP clients and the built-in assistant. Each
 * write tool maps 1:1 onto a runtime command, so tools never write directly.
 */

/** MCP tool names: lowercase snake_case, at most 64 chars (portable across MCP clients). */
export const ToolName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export type ToolName = z.infer<typeof ToolName>;

export const TOOL_KINDS = [
  /** Read: list/search records of one entity. */
  "list",
  /** Read: one record by id. */
  "get",
  /** Read: built-in metric or aggregate. */
  "metric",
  "create",
  "update",
  "delete",
  /** Workflow transition, e.g. confirm_sales_order. */
  "transition",
  /** Engine action, e.g. receive_output_production_job. */
  "action",
  /** Blueprint change request (always goes through preview + owner approval). */
  "change",
] as const;
export const ToolKind = z.enum(TOOL_KINDS);
export type ToolKind = z.infer<typeof ToolKind>;

/** MCP tool annotations (hints to clients; enforcement happens in the runtime). */
export const ToolAnnotations = z.object({
  title: z.string().max(120),
  readOnlyHint: z.boolean(),
  destructiveHint: z.boolean(),
  idempotentHint: z.boolean(),
  openWorldHint: z.literal(false),
});

/** Where a write tool's arguments go in the command. */
export const CommandTemplate = z.object({
  type: z.custom<CommandType>((v) => typeof v === "string"),
  entity: EntityId.optional(),
  /** transition id or engine action key the tool is bound to. */
  target: z.string().max(64).optional(),
});

export const ToolDefinition = z.object({
  name: ToolName,
  kind: ToolKind,
  description: z.string().min(1).max(1024),
  /** JSON Schema (draft 2020-12) object for the arguments, keyed by field *key* for readability. */
  inputSchema: z.record(z.string(), z.unknown()),
  annotations: ToolAnnotations,
  entity: EntityId.optional(),
  /** Absent for read tools. */
  command: CommandTemplate.optional(),
  /** Permission the actor's role needs, e.g. "create" or "transition:confirm". */
  requires: z.string().max(80),
  /** The runtime will park this for approval for at least some inputs. */
  mayNeedApproval: z.boolean(),
});
export type ToolDefinition = z.infer<typeof ToolDefinition>;

export const ToolManifest = z.object({
  tenantId: z.string().min(1).max(64),
  blueprintVersion: z.number().int().min(1),
  generatedAt: z.string().datetime(),
  tools: z.array(ToolDefinition).max(400),
});
export type ToolManifest = z.infer<typeof ToolManifest>;

/**
 * Tool names are `<verb>_<entity key>`, e.g. list_sales_order, confirm_sales_order,
 * receive_output_production_job. Long names are truncated with a short hash so they
 * stay unique and within the MCP limit.
 */
export function toolName(verb: string, entityKey?: string): ToolName {
  Key.parse(verb);
  if (entityKey) Key.parse(entityKey);
  const full = entityKey ? `${verb}_${entityKey}` : verb;
  if (full.length <= 64) return full;
  return `${full.slice(0, 57)}_${shortHash(full)}`;
}

function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).padStart(6, "0").slice(0, 6);
}
