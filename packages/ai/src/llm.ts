import type { z } from "zod";

/**
 * The provider-neutral interface every AI feature uses. Onboarding and the
 * assistant never talk to Gemini or Azure directly, so switching providers
 * is a configuration change (see provider.ts).
 */

export type Role = "user" | "assistant";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls?: ToolCall[]; /** provider-specific data to send back verbatim */ raw?: unknown }
  | { role: "tool"; callId: string; name: string; result: unknown };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface Usage {
  input: number;
  output: number;
  model: string;
}

/** Which kind of model a call needs; each provider maps it to a concrete model or deployment. */
export type ModelTier = "chat" | "design" | "fast";

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number | "timeout" | "invalid_output" | "blocked" | "config",
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface Llm {
  readonly provider: "gemini" | "azure-openai";
  /** JSON matching `schema`, validated; retried with the problems fed back. */
  json<T extends z.ZodType>(args: { tier?: ModelTier; system?: string; messages: Message[]; schema: T; temperature?: number }): Promise<{ value: z.infer<T>; usage: Usage }>;
  /** One turn that may call tools. */
  turn(args: { tier?: ModelTier; system?: string; messages: Message[]; tools: ToolSpec[] }): Promise<{ message: Extract<Message, { role: "assistant" }>; usage: Usage }>;
}

/** Validation problems as short lines for feeding back to a model. */
export function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[], max = 12): string {
  return issues
    .slice(0, max)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}
