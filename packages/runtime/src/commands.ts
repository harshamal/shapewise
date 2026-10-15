import { z } from "zod";
import { CoreRecordKey, Key, Target } from "@shapewise/blueprint";

/**
 * The command contract. Every write in Shapewise, from the web app, the
 * built-in assistant, an MCP agent, an import job or the system itself, is one
 * of these commands passed to `execute(envelope)`. Nothing else writes.
 */

/* --------------------------------------------------------------------- actor */

export const Channel = z.enum(["web", "assistant", "mcp", "import", "system"]);
export type Channel = z.infer<typeof Channel>;

export const Actor = z.object({
  kind: z.enum(["user", "agent", "system"]),
  /** Firebase uid, MCP token id, or "system". */
  id: z.string().min(1).max(128),
  /** Role key from the blueprint; resolved from membership or token, never from input. */
  roleKey: z.string().min(1).max(48),
  channel: Channel,
  /** MCP client name or assistant session, for the audit log. */
  clientName: z.string().max(120).optional(),
  displayName: z.string().max(120).optional(),
});
export type Actor = z.infer<typeof Actor>;

/* ------------------------------------------------------------------ commands */

const RecordId = z.string().min(1).max(64);
/** Record data keyed by core field key or custom field id. Validated against the compiled blueprint. */
const RecordData = z.record(z.string(), z.unknown());

export const Command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("record.create"),
    /** Core record type ("invoice") or custom record type id. */
    target: Target,
    /** Field values keyed by core field key or custom field id. */
    data: RecordData,
  }),
  z.object({
    type: z.literal("record.update"),
    target: Target,
    recordId: RecordId,
    patch: RecordData,
    /** Optimistic lock; rejected with `conflict` if the record moved on. */
    expectedVersion: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal("record.delete"),
    target: Target,
    recordId: RecordId,
    reason: z.string().max(300).optional(),
  }),
  z.object({
    /**
     * Run a lifecycle action on a core record ("post" an invoice, "dispatch" a
     * delivery note, "release" a batch) or a workflow transition on a custom one.
     * The engines own what an action writes to the ledger and stock.
     */
    type: z.literal("record.action"),
    target: Target,
    recordId: RecordId,
    action: Key,
    /** Fields set together with the action (e.g. received_by when confirming delivery). */
    data: RecordData.optional(),
    expectedVersion: z.number().int().min(0).optional(),
  }),
  z.object({
    /** Turn one core record into another along a catalogue conversion (quote → sales order). */
    type: z.literal("record.convert"),
    from: CoreRecordKey,
    recordId: RecordId,
    to: CoreRecordKey,
    /** Partial conversion: line ids and quantities; omit for everything outstanding. */
    lines: z.array(z.object({ lineId: z.string().max(64), quantity: z.number().positive() })).max(500).optional(),
    data: RecordData.optional(),
  }),
  z.object({
    type: z.literal("approval.decide"),
    approvalId: z.string().min(1).max(64),
    decision: z.enum(["approve", "reject"]),
    note: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal("change.propose"),
    /** Plain-language request, e.g. "add a regrind stage after moulding". */
    request: z.string().min(3).max(2000),
  }),
  z.object({
    type: z.literal("change.apply"),
    changeId: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("change.undo"),
    changeId: z.string().min(1).max(64),
  }),
]);
export type Command = z.infer<typeof Command>;
export type CommandType = Command["type"];

export const CommandEnvelope = z.object({
  /** Unique per attempt; also the audit and outbox correlation id. */
  id: z.string().uuid(),
  tenantId: z.string().min(1).max(64),
  actor: Actor,
  command: Command,
  /** Same key → same result, no second write. Clients retrying must reuse it. */
  idempotencyKey: z.string().min(8).max(128).optional(),
  issuedAt: z.string().datetime(),
  /** Set when an approved command is re-run; skips the approval check it already passed. */
  approvalId: z.string().max(64).optional(),
});
export type CommandEnvelope = z.infer<typeof CommandEnvelope>;

/* ------------------------------------------------------------------- results */

export const ERROR_CODES = [
  "validation",
  "forbidden",
  "not_found",
  "conflict",
  "engine_rule",
  "rule_rejected",
  "rate_limited",
  "unavailable",
  "internal",
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const Issue = z.object({
  /** Path into the command input, field IDs for record data. */
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

export const CommandError = z.object({
  code: ErrorCode,
  message: z.string(),
  issues: z.array(Issue).optional(),
  /** Safe to retry unchanged (contention, unavailable). */
  retryable: z.boolean().default(false),
});
export type CommandError = z.infer<typeof CommandError>;

export const Warning = z.object({ ruleId: z.string().optional(), message: z.string() });

export const CommandResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    commandId: z.string(),
    recordId: z.string().optional(),
    version: z.number().int().optional(),
    /** Document numbers issued, journal ids posted, change ids created, etc. */
    effects: z.record(z.string(), z.unknown()).default({}),
    warnings: z.array(Warning).default([]),
  }),
  z.object({
    status: z.literal("pending_approval"),
    commandId: z.string(),
    approvalId: z.string(),
    policyId: z.string(),
    /** Plain-language reason, e.g. "Purchase orders over Rs 500,000 need the owner's approval". */
    reason: z.string(),
  }),
  z.object({
    status: z.literal("error"),
    commandId: z.string(),
    error: CommandError,
  }),
]);
export type CommandResult = z.infer<typeof CommandResult>;

/** The pipeline entry point implemented by the runtime (step 8 of the build order). */
export type Execute = (envelope: CommandEnvelope) => Promise<CommandResult>;
