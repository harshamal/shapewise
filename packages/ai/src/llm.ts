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

/**
 * A file the person attached. Documents arrive as extracted text (PDF, Excel,
 * CSV, text); photos and scans as an image the model looks at directly.
 */
export interface Attachment {
  name: string;
  mime: string;
  kind: "text" | "image";
  /** Extracted text, for documents. */
  text?: string;
  /** data: URL, for images. Dropped from the history after the turn it was sent in. */
  dataUrl?: string;
  /** Pages or sheets read, for showing the person. */
  pages?: number;
}

export type Message =
  | { role: "user"; text: string; attachments?: Attachment[] }
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
    /** How long the service asked us to wait before trying again. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface Llm {
  readonly provider: "gemini" | "azure-openai";
  /** JSON matching `schema`, validated; retried with the problems fed back. */
  json<T extends z.ZodType>(args: {
    tier?: ModelTier;
    system?: string;
    messages: Message[];
    schema: T;
    temperature?: number;
    /** Streams the answer as it is written (a best effort parse, for display only). Providers that can't stream never call it. */
    onPartial?: (partial: unknown) => void;
  }): Promise<{ value: z.infer<T>; usage: Usage }>;
  /** One turn that may call tools. `onText` streams the reply text as it is written. */
  turn(args: { tier?: ModelTier; system?: string; messages: Message[]; tools: ToolSpec[]; onText?: (delta: string) => void }): Promise<{ message: Extract<Message, { role: "assistant" }>; usage: Usage }>;
}

/** Documents as text for the model, plus a placeholder for images it already saw in an earlier turn. */
export function attachmentText(attachments: readonly Attachment[] | undefined): string {
  if (!attachments?.length) return "";
  return attachments
    .map((a) => (a.kind === "text" ? `\n\n[Attached document: ${a.name}]\n${a.text ?? ""}\n[End of ${a.name}]` : a.dataUrl ? "" : `\n\n[Attached image: ${a.name}, seen earlier]`))
    .join("");
}

/** The history without image data, so it stays small going back and forth with the browser. */
export function withoutImageData(messages: Message[]): Message[] {
  return messages.map((m) => (m.role === "user" && m.attachments?.some((a) => a.dataUrl) ? { ...m, attachments: m.attachments.map(({ dataUrl: _d, ...a }) => a) } : m));
}

/** Validation problems as short lines for feeding back to a model. */
export function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[], max = 12): string {
  return issues
    .slice(0, max)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}
