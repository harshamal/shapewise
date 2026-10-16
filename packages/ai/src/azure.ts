import { z } from "zod";
import { LlmError, describeIssues, type Llm, type Message, type ModelTier, type ToolSpec, type Usage } from "./llm";

/**
 * Azure OpenAI over REST (chat completions on a deployment). Uses strict
 * structured outputs: the schema is converted to strict form (every property
 * required, optional ones nullable, no extra properties), then nulls are
 * dropped and the answer is validated with the original Zod schema.
 */

const API_VERSION = "2024-10-21";

export interface AzureConfig {
  endpoint: string;
  apiKey: string;
  /** Deployment per tier; `chat` is the default for all. */
  deployments: Partial<Record<ModelTier, string>> & { chat: string };
  timeoutMs?: number;
  attempts?: number;
  fetch?: typeof fetch;
}

export function azureConfigFromEnv(): AzureConfig | undefined {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_KEY ?? process.env.AZURE_OPENAI_API_KEY;
  const chat = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!endpoint || !apiKey || !chat) return undefined;
  return {
    endpoint,
    apiKey,
    deployments: { chat, design: process.env.AZURE_OPENAI_DEPLOYMENT_DESIGN ?? chat, fast: process.env.AZURE_OPENAI_DEPLOYMENT_FAST ?? chat },
  };
}

/** Keywords strict mode refuses; Zod still enforces them on the answer. */
const STRIP = new Set(["$schema", "minLength", "maxLength", "default", "pattern", "format", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]);

/** JSON Schema → OpenAI strict-mode schema. */
export function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (!node || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (STRIP.has(k)) continue;
    if (k === "properties") continue;
    out[k] = k === "additionalProperties" && typeof v === "object" ? toStrictSchema(v) : toStrictSchema(v);
  }
  if (src.type === "object" || src.properties) {
    const props = (src.properties ?? {}) as Record<string, unknown>;
    const required = new Set((src.required as string[] | undefined) ?? []);
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, required.has(k) ? toStrictSchema(v) : nullable(toStrictSchema(v))]));
    out.required = Object.keys(props);
    out.additionalProperties = false;
    out.type = "object";
  }
  return out;
}

function nullable(schema: unknown): unknown {
  const s = schema as Record<string, unknown>;
  if (typeof s.type === "string" && !s.anyOf) {
    const out: Record<string, unknown> = { ...s, type: [s.type, "null"] };
    if (Array.isArray(s.enum)) out.enum = [...s.enum, null];
    return out;
  }
  return { anyOf: [s, { type: "null" }] };
}

/** Optional values come back as null in strict mode; remove them before validating. */
export function dropNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, dropNulls(x)]));
  return v;
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export class AzureOpenAi implements Llm {
  readonly provider = "azure-openai" as const;
  private readonly cfg: Required<Omit<AzureConfig, "fetch">> & { fetch: typeof fetch };

  constructor(cfg: AzureConfig) {
    this.cfg = { timeoutMs: 120_000, attempts: 3, fetch: fetch, ...cfg, endpoint: cfg.endpoint.replace(/\/+$/, "") } as never;
  }

  async json<T extends z.ZodType>(args: { tier?: ModelTier; system?: string; messages: Message[]; schema: T }): Promise<{ value: z.infer<T>; usage: Usage }> {
    const schema = toStrictSchema(stripRoot(z.toJSONSchema(args.schema, { target: "draft-2020-12", io: "input", unrepresentable: "any" })));
    let messages = toChat(args.system, args.messages);
    let problem = "";
    for (let attempt = 1; attempt <= this.cfg.attempts; attempt++) {
      const res = await this.chat(args.tier ?? "chat", { messages, response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema } } });
      const text = res.message.content ?? "";
      let raw: unknown;
      try {
        raw = dropNulls(JSON.parse(text));
      } catch {
        problem = res.finishReason === "length" ? "The answer was cut off." : "The answer wasn't valid JSON.";
        continue;
      }
      const parsed = args.schema.safeParse(raw);
      if (parsed.success) return { value: parsed.data, usage: res.usage };
      problem = describeIssues(parsed.error.issues);
      messages = [...toChat(args.system, args.messages), { role: "assistant", content: text }, { role: "user", content: `That JSON breaks these rules:\n${problem}\nReturn the corrected JSON.` }];
    }
    throw new LlmError(`The model's answer didn't fit the required format. ${problem}`, "invalid_output", false);
  }

  async turn(args: { tier?: ModelTier; system?: string; messages: Message[]; tools: ToolSpec[] }) {
    const res = await this.chat(args.tier ?? "chat", {
      messages: toChat(args.system, args.messages),
      tools: args.tools.length ? args.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) : undefined,
    });
    const calls = (res.message.tool_calls ?? []).map((c) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(c.function.arguments || "{}");
      } catch {
        parsed = { _invalid: c.function.arguments };
      }
      return { id: c.id, name: c.function.name, args: parsed };
    });
    return { message: { role: "assistant" as const, text: res.message.content ?? "", toolCalls: calls.length ? calls : undefined }, usage: res.usage };
  }

  private async chat(tier: ModelTier, body: Record<string, unknown>) {
    const deployment = this.cfg.deployments[tier] ?? this.cfg.deployments.chat;
    const url = `${this.cfg.endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${API_VERSION}`;
    let last: LlmError | undefined;
    for (let attempt = 1; attempt <= this.cfg.attempts; attempt++) {
      try {
        const r = await this.cfg.fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "api-key": this.cfg.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
        });
        const json = (await r.json().catch(() => ({}))) as AzureResponse;
        if (r.ok) {
          const choice = json.choices?.[0];
          if (!choice?.message) throw new LlmError("The model gave no answer.", "blocked", false);
          if (choice.finish_reason === "content_filter") throw new LlmError("The answer was blocked by the content filter.", "blocked", false);
          return {
            message: choice.message,
            finishReason: choice.finish_reason,
            usage: { input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0, model: json.model ?? deployment },
          };
        }
        const retryable = r.status === 429 || r.status >= 500;
        last = new LlmError(friendly(r.status, json.error?.message), r.status, retryable);
        if (!retryable) throw last;
        const wait = Number(r.headers.get("retry-after"));
        if (attempt < this.cfg.attempts) await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(60, wait) * 1000 : 800 * 2 ** attempt);
      } catch (e) {
        if (e instanceof LlmError && !e.retryable) throw e;
        last = e instanceof LlmError ? e : new LlmError(e instanceof Error && e.name === "TimeoutError" ? "The AI took too long to answer." : "Couldn't reach the AI service.", "timeout", true);
        if (attempt < this.cfg.attempts) await sleep(800 * 2 ** attempt);
      }
    }
    throw last!;
  }
}

interface AzureResponse {
  model?: string;
  choices?: { message?: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

function stripRoot(s: unknown): unknown {
  const o = { ...(s as Record<string, unknown>) };
  delete o.$schema;
  return o;
}

function toChat(system: string | undefined, messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "assistant")
      out.push({
        role: "assistant",
        content: m.text || null,
        tool_calls: m.toolCalls?.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })),
      });
    else out.push({ role: "tool", tool_call_id: m.callId, content: JSON.stringify(m.result).slice(0, 60_000) });
  }
  return out;
}

function friendly(status: number, message = ""): string {
  if (status === 429) return "The AI service is busy or over its limit. Try again in a minute.";
  if (status === 401 || status === 403) return "The AI service refused the key.";
  if (status === 404) return "That AI deployment doesn't exist.";
  if (status >= 500) return "The AI service had a problem. Try again.";
  return `The AI service rejected the request: ${message.slice(0, 300)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
