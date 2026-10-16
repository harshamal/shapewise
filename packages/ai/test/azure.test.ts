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
