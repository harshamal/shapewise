import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AzureOpenAi, BlueprintPlan, dropNulls, toStrictSchema } from "../src";

const Schema = z.object({ preset: z.enum(["food", "plastics"]), note: z.string().max(10).optional(), tags: z.array(z.object({ key: z.string(), hint: z.string().optional() })).max(3) });

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const answer = (content: string | null, tool_calls?: unknown) => ({ status: 200, body: { model: "gpt-test", choices: [{ message: { content, tool_calls }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } } });
const client = (f: ReturnType<typeof fakeFetch>) => new AzureOpenAi({ endpoint: "https://x.example/", apiKey: "k", deployments: { chat: "dep" }, fetch: f.impl });

describe("strict schema conversion", () => {
  it("requires every property, makes optional ones nullable and forbids extras", () => {
    const s = toStrictSchema(z.toJSONSchema(Schema)) as Record<string, any>;
    expect(s.required).toEqual(["preset", "note", "tags"]);
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.note.type).toEqual(["string", "null"]);
    expect(s.properties.tags.items.required).toEqual(["key", "hint"]);
    expect(JSON.stringify(s)).not.toMatch(/maxLength|maxItems|\$schema/);
  });

  it("converts the whole Blueprint Plan schema without leaving optional properties out of required", () => {
    const check = (node: any): void => {
      if (!node || typeof node !== "object") return;
      if (node.properties) {
        expect(node.additionalProperties).toBe(false);
        expect(new Set(node.required)).toEqual(new Set(Object.keys(node.properties)));
      }
      Object.values(node).forEach(check);
    };
    check(toStrictSchema(z.toJSONSchema(BlueprintPlan, { io: "input" })));
  });

  it("turns nulls back into missing values", () => {
    expect(dropNulls({ a: null, b: [{ c: null, d: 1 }] })).toEqual({ b: [{ d: 1 }] });
  });
});

describe("AzureOpenAi", () => {
  it("returns validated JSON and calls the deployment", async () => {
    const f = fakeFetch([answer('{"preset":"food","note":null,"tags":[{"key":"a","hint":null}]}')]);
    const r = await client(f).json({ messages: [{ role: "user", text: "hi" }], schema: Schema, system: "sys" });
    expect(r.value).toEqual({ preset: "food", tags: [{ key: "a" }] });
    expect(f.calls[0]!.url).toBe("https://x.example/openai/deployments/dep/chat/completions?api-version=2024-10-21");
    expect((f.calls[0]!.body.messages as { role: string }[])[0]!.role).toBe("system");
  });

  it("feeds limits that strict mode can't express back to the model", async () => {
    const f = fakeFetch([answer('{"preset":"food","note":"far too long a note","tags":[]}'), answer('{"preset":"food","note":"short","tags":[]}')]);
    const r = await client(f).json({ messages: [{ role: "user", text: "hi" }], schema: Schema });
    expect(r.value.note).toBe("short");
    const second = f.calls[1]!.body.messages as { content: string }[];
    expect(second.at(-1)!.content).toMatch(/note/);
  });

  it("returns tool calls with parsed arguments", async () => {
    const f = fakeFetch([answer(null, [{ id: "c1", type: "function", function: { name: "search_records", arguments: '{"record":"invoice"}' } }])]);
    const r = await client(f).turn({ messages: [{ role: "user", text: "overdue?" }], tools: [{ name: "search_records", description: "d", parameters: { type: "object", properties: {} } }] });
    expect(r.message.toolCalls).toEqual([{ id: "c1", name: "search_records", args: { record: "invoice" } }]);
  });
});

const sse = (chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
const delta = (content?: string, extra: Record<string, unknown> = {}) => ({ model: "gpt-test", choices: [{ delta: { content, ...extra }, finish_reason: null }] });

describe("AzureOpenAi streaming", () => {
  it("streams JSON as it is written and returns the validated whole", async () => {
    const impl = (async () => sse([delta('{"preset":"fo'), delta('od","note":"hi"'), delta(',"tags":[]}'), { choices: [], usage: { prompt_tokens: 5, completion_tokens: 4 } }])) as unknown as typeof fetch;
    const seen: unknown[] = [];
    const llm = new AzureOpenAi({ endpoint: "https://x.example", apiKey: "k", deployments: { chat: "dep" }, fetch: impl, hedgeMs: { chat: [] } });
    const r = await llm.json({ messages: [{ role: "user", text: "hi" }], schema: Schema, onPartial: (p) => seen.push(p) });
    expect(r.value).toEqual({ preset: "food", note: "hi", tags: [] });
    expect(r.usage).toEqual({ input: 5, output: 4, model: "gpt-test" });
    expect(seen.at(-1)).toEqual({ preset: "food", note: "hi", tags: [] });
  });

  it("assembles tool calls that arrive in pieces", async () => {
    const impl = (async () =>
      sse([
        delta(undefined, { tool_calls: [{ index: 0, id: "c1", function: { name: "search_", arguments: '{"rec' } }] }),
        delta(undefined, { tool_calls: [{ index: 0, function: { name: "records", arguments: 'ord":"invoice"}' } }] }),
      ])) as unknown as typeof fetch;
    const llm = new AzureOpenAi({ endpoint: "https://x.example", apiKey: "k", deployments: { chat: "dep" }, fetch: impl, hedgeMs: { chat: [] } });
    const r = await llm.turn({ messages: [{ role: "user", text: "x" }], tools: [{ name: "search_records", description: "d", parameters: { type: "object", properties: {} } }] });
    expect(r.message.toolCalls).toEqual([{ id: "c1", name: "search_records", args: { record: "invoice" } }]);
  });

  it("sends a backup when the first request is stuck in the queue, and keeps whichever starts first", async () => {
    let n = 0;
    const aborted: number[] = [];
    const impl = ((_url: string, init: RequestInit) => {
      const i = n++;
      if (i === 0)
        return new Promise((_, reject) => {
          init.signal!.addEventListener("abort", () => (aborted.push(i), reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
        });
      return Promise.resolve(sse([delta("fast answer")]));
    }) as unknown as typeof fetch;
    const llm = new AzureOpenAi({ endpoint: "https://x.example", apiKey: "k", deployments: { chat: "dep" }, fetch: impl, hedgeMs: { chat: [20] } });
    const text: string[] = [];
    const r = await llm.turn({ messages: [{ role: "user", text: "x" }], tools: [], onText: (d) => text.push(d) });
    expect(r.message.text).toBe("fast answer");
    expect(text).toEqual(["fast answer"]);
    expect(n).toBe(2);
    expect(aborted).toEqual([0]);
  });

  it("doesn't send backups for a request the service refuses", async () => {
    let n = 0;
    const impl = (async () => (n++, new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 }))) as unknown as typeof fetch;
    const llm = new AzureOpenAi({ endpoint: "https://x.example", apiKey: "k", deployments: { chat: "dep" }, fetch: impl, hedgeMs: { chat: [5, 10] } });
    await expect(llm.turn({ messages: [{ role: "user", text: "x" }], tools: [] })).rejects.toThrow(/rejected the request/);
    expect(n).toBe(1);
  });

  it("asks for low reasoning effort and streaming", async () => {
    const bodies: Record<string, unknown>[] = [];
    const impl = (async (_u: string, init: RequestInit) => (bodies.push(JSON.parse(String(init.body))), sse([delta("ok")]))) as unknown as typeof fetch;
    const llm = new AzureOpenAi({ endpoint: "https://x.example", apiKey: "k", deployments: { chat: "dep" }, fetch: impl, reasoning: { chat: "low" } });
    await llm.turn({ messages: [{ role: "user", text: "x", attachments: [{ name: "p.png", mime: "image/png", kind: "image", dataUrl: "data:image/png;base64,AA" }] }], tools: [] });
    expect(bodies[0]).toMatchObject({ reasoning_effort: "low", stream: true, stream_options: { include_usage: true } });
    expect((bodies[0]!.messages as { content: unknown }[])[0]!.content).toEqual([{ type: "text", text: "x" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA", detail: "auto" } }]);
  });
});
