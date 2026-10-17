import { z } from "zod";
import { LlmError, attachmentText, describeIssues, type Llm, type Message, type ModelTier, type ToolSpec, type Usage } from "./llm";
import { parsePartialJson } from "./partial-json";

/**
 * Azure OpenAI over REST (chat completions on a deployment). Uses strict
 * structured outputs: the schema is converted to strict form (every property
 * required, optional ones nullable, no extra properties), then nulls are
 * dropped and the answer is validated with the original Zod schema.
 *
 * Speed: every call streams, so text reaches the person as it is written,
 * and every call is hedged. The model answers a small turn in about three
 * seconds, but a request can wait in the service's queue for a minute or
 * more before it starts. If no token has arrived after a short wait, a
 * second identical request goes out; whichever starts first wins and the
 * others are cancelled.
 */

const API_VERSION = "2024-10-21";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface AzureConfig {
  endpoint: string;
  apiKey: string;
  /** Deployment per tier; `chat` is the default for all. */
  deployments: Partial<Record<ModelTier, string>> & { chat: string };
  /** Reasoning effort per tier, for reasoning models. A tier left out uses the deployment's default. */
  reasoning?: Partial<Record<ModelTier, ReasoningEffort>>;
  /** When to send backup requests while no token has arrived, in ms after the first. An empty list turns hedging off. */
  hedgeMs?: Partial<Record<ModelTier, number[]>>;
  timeoutMs?: number;
  attempts?: number;
  fetch?: typeof fetch;
}

const EFFORTS = new Set(["minimal", "low", "medium", "high"]);
const effort = (v: string | undefined, fallback: ReasoningEffort): ReasoningEffort => (v && EFFORTS.has(v) ? (v as ReasoningEffort) : fallback);

export function azureConfigFromEnv(): AzureConfig | undefined {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_KEY ?? process.env.AZURE_OPENAI_API_KEY;
  const chat = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!endpoint || !apiKey || !chat) return undefined;
  return {
    endpoint,
    apiKey,
    deployments: { chat, design: process.env.AZURE_OPENAI_DEPLOYMENT_DESIGN ?? chat, fast: process.env.AZURE_OPENAI_DEPLOYMENT_FAST ?? chat },
    reasoning: {
      chat: effort(process.env.AZURE_OPENAI_REASONING_CHAT, "low"),
      fast: effort(process.env.AZURE_OPENAI_REASONING_FAST, "minimal"),
      design: effort(process.env.AZURE_OPENAI_REASONING_DESIGN, "low"),
    },
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
    if (STRIP.has(k) || k === "properties") continue;
    out[k] = toStrictSchema(v);
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

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChatResult {
  message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
  finishReason?: string;
  usage: Usage;
}

const DEFAULT_HEDGE: Record<ModelTier, number[]> = { chat: [5_000, 12_000], fast: [4_000, 10_000], design: [10_000, 25_000] };

type Resolved = Required<Pick<AzureConfig, "endpoint" | "apiKey" | "deployments" | "timeoutMs" | "attempts">> & {
  reasoning?: AzureConfig["reasoning"];
  hedgeMs: Record<ModelTier, number[]>;
  fetch: typeof fetch;
};

export class AzureOpenAi implements Llm {
  readonly provider = "azure-openai" as const;
  private readonly cfg: Resolved;
  /** Set when the deployment rejects reasoning_effort (not a reasoning model). */
  private noReasoning = false;

  constructor(cfg: AzureConfig) {
    this.cfg = {
      timeoutMs: cfg.timeoutMs ?? 120_000,
      attempts: cfg.attempts ?? 3,
      fetch: cfg.fetch ?? fetch,
      endpoint: cfg.endpoint.replace(/\/+$/, ""),
      apiKey: cfg.apiKey,
      deployments: cfg.deployments,
      reasoning: cfg.reasoning,
      hedgeMs: { ...DEFAULT_HEDGE, ...(cfg.hedgeMs ?? {}) },
    };
  }

  async json<T extends z.ZodType>(args: { tier?: ModelTier; system?: string; messages: Message[]; schema: T; onPartial?: (partial: unknown) => void }): Promise<{ value: z.infer<T>; usage: Usage }> {
    const schema = toStrictSchema(stripRoot(z.toJSONSchema(args.schema, { target: "draft-2020-12", io: "input", unrepresentable: "any" })));
    let messages = toChat(args.system, args.messages);
    let problem = "";
    for (let attempt = 1; attempt <= this.cfg.attempts; attempt++) {
      let text = "";
      let shownAt = 0;
      const onDelta = args.onPartial
        ? (d: string) => {
            text += d;
            const now = Date.now();
            if (now - shownAt < 60) return;
            shownAt = now;
            const partial = parsePartialJson(text);
            if (partial !== undefined) args.onPartial!(dropNulls(partial));
          }
        : undefined;
      const res = await this.chat(args.tier ?? "chat", { messages, response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema } } }, onDelta);
      const content = res.message.content ?? "";
      let raw: unknown;
      try {
        raw = dropNulls(JSON.parse(content));
      } catch {
        problem = res.finishReason === "length" ? "The answer was cut off." : "The answer wasn't valid JSON.";
        continue;
      }
      const parsed = args.schema.safeParse(raw);
      if (parsed.success) {
        args.onPartial?.(raw);
        return { value: parsed.data, usage: res.usage };
      }
      problem = describeIssues(parsed.error.issues);
      messages = [...toChat(args.system, args.messages), { role: "assistant", content }, { role: "user", content: `That JSON breaks these rules:\n${problem}\nReturn the corrected JSON.` }];
    }
    throw new LlmError(`The model's answer didn't fit the required format. ${problem}`, "invalid_output", false);
  }

  async turn(args: { tier?: ModelTier; system?: string; messages: Message[]; tools: ToolSpec[]; onText?: (delta: string) => void }) {
    const res = await this.chat(
      args.tier ?? "chat",
      {
        messages: toChat(args.system, args.messages),
        tools: args.tools.length ? args.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) : undefined,
      },
      args.onText,
    );
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

  /** One logical call: hedged requests, retried on transient failures. */
  private async chat(tier: ModelTier, body: Record<string, unknown>, onDelta?: (d: string) => void): Promise<ChatResult> {
    let last: LlmError | undefined;
    for (let attempt = 1; attempt <= this.cfg.attempts; attempt++) {
      try {
        return await this.hedged(tier, body, onDelta);
      } catch (e) {
        last = e instanceof LlmError ? e : new LlmError("Couldn't reach the AI service.", "timeout", true);
        if (last.status === 400 && /reasoning/i.test(last.message) && !this.noReasoning) {
          this.noReasoning = true;
          attempt--;
          continue;
        }
        if (!last.retryable) throw last;
        if (attempt < this.cfg.attempts) await sleep(last.retryAfterMs ?? 800 * 2 ** attempt);
      }
    }
    throw last!;
  }

  /**
   * Sends the request, then backups at the tier's hedge times while nothing
   * has started streaming. The first request to produce output wins.
   */
  private hedged(tier: ModelTier, body: Record<string, unknown>, onDelta?: (d: string) => void): Promise<ChatResult> {
    const deployment = this.cfg.deployments[tier] ?? this.cfg.deployments.chat;
    const url = `${this.cfg.endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${API_VERSION}`;
    const reasoning = this.noReasoning ? undefined : this.cfg.reasoning?.[tier];
    const payload = JSON.stringify({ ...body, ...(reasoning ? { reasoning_effort: reasoning } : {}), stream: true, stream_options: { include_usage: true } });
    const delays = this.cfg.hedgeMs[tier] ?? [];

    return new Promise<ChatResult>((resolve, reject) => {
      const controllers: AbortController[] = [];
      const timers: ReturnType<typeof setTimeout>[] = [];
      let winner = -1;
      let inFlight = 0;
      let launched = 0;
      let settled = false;
      let lastError: unknown;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        timers.forEach(clearTimeout);
        fn();
      };
      const claim = (i: number) => {
        if (winner === -1) {
          winner = i;
          timers.forEach(clearTimeout);
          controllers.forEach((c, j) => j !== i && c.abort());
        }
        return winner === i;
      };
      const launch = () => {
        if (settled || winner !== -1 || launched > delays.length) return;
        const i = launched++;
        const ac = new AbortController();
        controllers[i] = ac;
        inFlight++;
        this.once(url, payload, deployment, ac.signal, () => claim(i), (d) => {
          if (winner === i) onDelta?.(d);
        })
          .then((r) => {
            if (claim(i)) finish(() => resolve(r));
          })
          .catch((e) => {
            lastError = e;
            if (winner === i) return finish(() => reject(e));
            // A request the service refuses outright (bad key, bad request) won't succeed as a backup either.
            if (winner === -1 && e instanceof LlmError && !e.retryable) return finish(() => reject(e));
            // Failed before streaming: send the next backup now rather than waiting for its timer.
            if (winner === -1 && launched <= delays.length) {
              clearTimeout(timers.shift());
              launch();
            }
          })
          .finally(() => {
            inFlight--;
            if (inFlight === 0 && winner === -1 && launched > delays.length) finish(() => reject(lastError));
          });
      };
      launch();
      for (const ms of delays) timers.push(setTimeout(launch, ms));
    });
  }

  /** One HTTP request. `start` runs when the answer begins and returns false if another request already won. */
  private async once(url: string, payload: string, deployment: string, signal: AbortSignal, start: () => boolean, onDelta: (d: string) => void): Promise<ChatResult> {
    let r: Response;
    try {
      r = await this.cfg.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "api-key": this.cfg.apiKey },
        body: payload,
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.cfg.timeoutMs)]),
      });
    } catch (e) {
      throw new LlmError(e instanceof Error && e.name === "TimeoutError" ? "The AI took too long to answer." : "Couldn't reach the AI service.", "timeout", true);
    }
    if (!r.ok) {
      const json = (await r.json().catch(() => ({}))) as AzureResponse;
      const wait = Number(r.headers.get("retry-after"));
      const retryable = r.status === 429 || r.status >= 500;
      throw new LlmError(friendly(r.status, json.error?.message), r.status, retryable, Number.isFinite(wait) && wait > 0 ? Math.min(60, wait) * 1000 : undefined);
    }

    if (!(r.headers.get("content-type") ?? "").includes("event-stream")) {
      const json = (await r.json().catch(() => ({}))) as AzureResponse;
      if (!start()) throw new LlmError("Superseded by a faster request.", "timeout", false);
      const choice = json.choices?.[0];
      if (!choice?.message) throw new LlmError("The model gave no answer.", "blocked", false);
      if (choice.finish_reason === "content_filter") throw new LlmError("The answer was blocked by the content filter.", "blocked", false);
      if (choice.message.content) onDelta(choice.message.content);
      return { message: choice.message, finishReason: choice.finish_reason, usage: { input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0, model: json.model ?? deployment } };
    }

    let content = "";
    let finishReason: string | undefined;
    let model = deployment;
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    let started = false;
    const tools: { id: string; function: { name: string; arguments: string } }[] = [];
    try {
      for await (const data of sseData(r.body!)) {
        if (data === "[DONE]") break;
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new LlmError(friendly(500, chunk.error.message), 500, true);
        if (chunk.model) model = chunk.model;
        if (chunk.usage) usage = { prompt_tokens: chunk.usage.prompt_tokens ?? 0, completion_tokens: chunk.usage.completion_tokens ?? 0 };
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        // The first real choice means the model has started on this request.
        if (!started) {
          started = true;
          if (!start()) throw new LlmError("Superseded by a faster request.", "timeout", false);
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const d = choice.delta;
        if (d?.content) {
          content += d.content;
          onDelta(d.content);
        }
        for (const tc of d?.tool_calls ?? []) {
          const t = (tools[tc.index] ??= { id: "", function: { name: "", arguments: "" } });
          if (tc.id) t.id = tc.id;
          if (tc.function?.name) t.function.name += tc.function.name;
          if (tc.function?.arguments) t.function.arguments += tc.function.arguments;
        }
      }
    } catch (e) {
      if (e instanceof LlmError) throw e;
      throw new LlmError(e instanceof Error && e.name === "TimeoutError" ? "The AI took too long to answer." : "The connection to the AI service dropped.", "timeout", true);
    }
    if (!started && !start()) throw new LlmError("Superseded by a faster request.", "timeout", false);
    if (finishReason === "content_filter") throw new LlmError("The answer was blocked by the content filter.", "blocked", false);
    const calls = tools.filter(Boolean);
    return {
      message: { content: content || null, tool_calls: calls.length ? calls : undefined },
      finishReason,
      usage: { input: usage.prompt_tokens, output: usage.completion_tokens, model },
    };
  }
}

interface AzureResponse {
  model?: string;
  choices?: { message?: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

interface StreamChunk {
  model?: string;
  choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
}

/** The `data:` payloads of a server-sent event stream. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith("data:")) yield buf.slice(5).trim();
}

function stripRoot(s: unknown): unknown {
  const o = { ...(s as Record<string, unknown>) };
  delete o.$schema;
  return o;
}

function toChat(system: string | undefined, messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "user") {
      const text = m.text + attachmentText(m.attachments);
      const images = (m.attachments ?? []).filter((a) => a.kind === "image" && a.dataUrl);
      out.push({ role: "user", content: images.length ? [{ type: "text", text }, ...images.map((a): ContentPart => ({ type: "image_url", image_url: { url: a.dataUrl!, detail: "auto" } }))] : text });
    } else if (m.role === "assistant")
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
