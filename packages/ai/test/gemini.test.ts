import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Gemini, GeminiError, toGeminiSchema } from "../src/gemini";

/** A fake fetch that replays canned responses and records requests. */
function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const answer = (text: string, finishReason = "STOP") => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } });

const Schema = z.object({ preset: z.enum(["plastics", "food"]), count: z.number().int() });

describe("Gemini.json", () => {
  it("sends the schema and returns validated JSON", async () => {
    const f = fakeFetch([answer('{"preset":"food","count":2}')]);
    const g = new Gemini({ apiKey: "k", fetch: f.impl });
    const r = await g.json({ contents: [{ role: "user", parts: [{ text: "hi" }] }], schema: Schema, system: "be brief" });
    expect(r.value).toEqual({ preset: "food", count: 2 });
    const cfg = f.calls[0]!.body.generationConfig as Record<string, unknown>;
    expect(cfg.responseMimeType).toBe("application/json");
    expect(JSON.stringify(cfg.responseJsonSchema)).toContain('"enum":["plastics","food"]');
    expect(f.calls[0]!.body.systemInstruction).toEqual({ parts: [{ text: "be brief" }] });
  });

  it("feeds validation errors back and accepts the corrected answer", async () => {
    const f = fakeFetch([answer('{"preset":"bakery","count":2}'), answer('{"preset":"food","count":2}')]);
    const g = new Gemini({ apiKey: "k", fetch: f.impl });
    const r = await g.json({ contents: [{ role: "user", parts: [{ text: "hi" }] }], schema: Schema });
    expect(r.value.preset).toBe("food");
    const second = f.calls[1]!.body.contents as { parts: { text: string }[] }[];
    expect(second.at(-1)!.parts[0]!.text).toMatch(/preset/);
  });

  it("gives up with a clear error after repeated bad output", async () => {
    const f = fakeFetch([answer("not json"), answer("{"), answer('{"x":1}')]);
    const g = new Gemini({ apiKey: "k", fetch: f.impl });
    await expect(g.json({ contents: [], schema: Schema })).rejects.toMatchObject({ status: "invalid_output" });
  });

  it("retries rate limits and server errors, not bad requests", async () => {
    const ok = fakeFetch([{ status: 503, body: {} }, answer('{"preset":"food","count":1}')]);
    await expect(new Gemini({ apiKey: "k", fetch: ok.impl }).json({ contents: [], schema: Schema })).resolves.toBeTruthy();
    const bad = fakeFetch([{ status: 400, body: { error: { message: "bad field" } } }]);
    await expect(new Gemini({ apiKey: "k", fetch: bad.impl }).json({ contents: [], schema: Schema })).rejects.toBeInstanceOf(GeminiError);
    expect(bad.calls).toHaveLength(1);
  });

  it("refuses to start without a key", () => {
    const saved = { a: process.env.GEMINI_API_KEY, b: process.env.Gemini_API_Key, c: process.env.GOOGLE_API_KEY };
    delete process.env.GEMINI_API_KEY;
    delete process.env.Gemini_API_Key;
    delete process.env.GOOGLE_API_KEY;
    expect(() => new Gemini()).toThrow(/No Gemini API key/);
    Object.assign(process.env, Object.fromEntries(Object.entries({ GEMINI_API_KEY: saved.a, Gemini_API_Key: saved.b, GOOGLE_API_KEY: saved.c }).filter(([, v]) => v)));
  });
});

describe("toGeminiSchema", () => {
  it("drops $schema and keeps enums", () => {
    const s = toGeminiSchema(Schema);
    expect(s.$schema).toBeUndefined();
    expect(JSON.stringify(s)).toContain("plastics");
  });
});
