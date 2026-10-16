import { z } from "zod";
import { EMBEDDING_DIMENSIONS, MODELS } from "./models";

/**
 * A small Gemini client over the REST API: schema-constrained JSON,
 * function calling and embeddings. Every JSON answer is parsed with the
 * same Zod schema that was sent as the response schema, so callers only
 * ever receive values that passed validation.
 */

export type Part =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }
  | { functionCall: { name: string; args?: Record<string, unknown>; id?: string }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown>; id?: string } };

export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number | "timeout" | "invalid_output" | "blocked",
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export interface GeminiOptions {
  apiKey?: string;
  /** Per request; default 90 s. */
  timeoutMs?: number;
  /** Attempts for rate limits, server errors and invalid JSON; default 3. */
  attempts?: number;
  fetch?: typeof fetch;
}

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function apiKeyFromEnv(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.Gemini_API_Key ?? process.env.GOOGLE_API_KEY;
}

/** Zod → JSON Schema that Gemini's responseJsonSchema accepts. */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export class Gemini {
  private readonly key: string;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GeminiOptions = {}) {
    const key = opts.apiKey ?? apiKeyFromEnv();
    if (!key) throw new GeminiError("No Gemini API key. Set GEMINI_API_KEY in the environment.", 401, false);
    this.key = key;
    this.timeoutMs = opts.timeoutMs ?? 90_000;
    this.attempts = opts.attempts ?? 3;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /**
   * Ask for JSON matching `schema`. Invalid or truncated JSON is retried
   * (with the validation errors fed back once), so the result always passes.
   */
  async json<T extends z.ZodType>(args: {
    model?: string;
    system?: string;
    contents: Content[];
    schema: T;
    temperature?: number;
  }): Promise<{ value: z.infer<T>; usage: Usage }> {
    const responseJsonSchema = toGeminiSchema(args.schema);
    let contents = args.contents;
    let lastProblem = "";
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      const res = await this.generate({
        model: args.model ?? MODELS.chat,
        system: args.system,
        contents,
        generationConfig: { responseMimeType: "application/json", responseJsonSchema, temperature: args.temperature ?? 0.2 },
      });
      const text = textOf(res);
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        lastProblem = res.finishReason === "MAX_TOKENS" ? "The answer was cut off." : "The answer wasn't valid JSON.";
        continue;
      }
      const parsed = args.schema.safeParse(raw);
      if (parsed.success) return { value: parsed.data, usage: res.usage };
      lastProblem = parsed.error.issues
        .slice(0, 12)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      // Show the model what was wrong with its own answer and ask again.
      contents = [
        ...args.contents,
        { role: "model", parts: [{ text }] },
        { role: "user", parts: [{ text: `That JSON doesn't match the schema:\n${lastProblem}\nReturn the corrected JSON only.` }] },
      ];
    }
    throw new GeminiError(`The model's answer didn't fit the required format. ${lastProblem}`, "invalid_output", false);
  }

  /** One turn with tools; returns the model's content to append to history verbatim (keeps thought signatures). */
  async turn(args: { model?: string; system?: string; contents: Content[]; tools: FunctionDeclaration[]; temperature?: number }) {
    const res = await this.generate({
      model: args.model ?? MODELS.chat,
      system: args.system,
      contents: args.contents,
      tools: args.tools.length ? [{ functionDeclarations: args.tools }] : undefined,
      generationConfig: { temperature: args.temperature ?? 0.3 },
    });
    return res;
  }

  async embed(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" = "SEMANTIC_SIMILARITY"): Promise<number[][]> {
    const out: number[][] = [];
    for (const text of texts) {
      const body = await this.post(`${BASE}/${MODELS.embedding}:embedContent`, {
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS,
      });
      out.push((body as { embedding: { values: number[] } }).embedding.values);
    }
    return out;
  }

  private async generate(payload: {
    model: string;
    system?: string;
    contents: Content[];
    tools?: unknown[];
    generationConfig: Record<string, unknown>;
  }): Promise<GenerateResult> {
    const body: Record<string, unknown> = { contents: payload.contents, generationConfig: payload.generationConfig };
    if (payload.system) body.systemInstruction = { parts: [{ text: payload.system }] };
    if (payload.tools) body.tools = payload.tools;
    const json = (await this.post(`${BASE}/${payload.model}:generateContent`, body)) as RawResponse;
    const cand = json.candidates?.[0];
    if (!cand?.content) {
      const reason = json.promptFeedback?.blockReason ?? cand?.finishReason ?? "no answer";
      throw new GeminiError(`The model gave no answer (${reason}).`, "blocked", false);
    }
    return {
      content: { role: "model", parts: cand.content.parts ?? [] },
      finishReason: cand.finishReason,
      usage: { input: json.usageMetadata?.promptTokenCount ?? 0, output: json.usageMetadata?.candidatesTokenCount ?? 0, model: payload.model },
    };
  }

  /** POST with timeout and retries on rate limits and server errors (exponential backoff with jitter). */
  private async post(url: string, body: unknown): Promise<unknown> {
    let last: GeminiError | undefined;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const r = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const json = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
        if (r.ok) return json;
        const retryable = r.status === 429 || r.status >= 500;
        last = new GeminiError(friendly(r.status, json.error?.message), r.status, retryable);
        if (!retryable) throw last;
      } catch (e) {
        if (e instanceof GeminiError && !e.retryable) throw e;
        last = e instanceof GeminiError ? e : new GeminiError(e instanceof Error && e.name === "TimeoutError" ? "The AI took too long to answer." : "Couldn't reach the AI service.", "timeout", true);
      }
      if (attempt < this.attempts) await sleep(Math.min(8000, 500 * 2 ** attempt) * (0.75 + Math.random() / 2));
    }
    throw last!;
  }
}

export interface Usage {
  input: number;
  output: number;
  model: string;
}

export interface GenerateResult {
  content: Content;
  finishReason?: string;
  usage: Usage;
}

interface RawResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/** The visible text of an answer (thoughts excluded). */
export function textOf(res: GenerateResult): string {
  return res.content.parts
    .filter((p): p is Extract<Part, { text: string }> => "text" in p && !p.thought)
    .map((p) => p.text)
    .join("");
}

function friendly(status: number, message = ""): string {
  if (status === 429) return "The AI service is busy or over its quota. Try again in a minute.";
  if (status === 401 || status === 403) return "The AI service refused the API key.";
  if (status === 404) return "That AI model isn't available to this key.";
  if (status >= 500) return "The AI service had a problem. Try again.";
  return `The AI service rejected the request: ${message.slice(0, 200)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
