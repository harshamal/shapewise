/** Latency probe: one small structured call and one streamed call, per reasoning effort. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const envPath = fileURLToPath(new URL("../../../apps/web/.env.local", import.meta.url));
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
}
const ep = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/+$/, "");
const dep = process.env.AZURE_OPENAI_DEPLOYMENT!;
const ver = process.argv[2] ?? "2024-10-21";
async function go(effort: string | undefined, stream: boolean) {
  const t0 = Date.now();
  const body: Record<string, unknown> = { messages: [{ role: "system", content: "You interview a bakery owner to set up software. Reply in JSON." }, { role: "user", content: "We are Lanka Bakes, cakes and short eats for cafes in Colombo." }], response_format: { type: "json_schema", json_schema: { name: "a", strict: true, schema: { type: "object", additionalProperties: false, required: ["note", "question", "options"], properties: { note: { type: "string" }, question: { type: "string" }, options: { type: "array", items: { type: "string" } } } } } } };
  if (effort) body.reasoning_effort = effort;
  if (stream) body.stream = true;
  const r = await fetch(`${ep}/openai/deployments/${dep}/chat/completions?api-version=${ver}`, { method: "POST", headers: { "content-type": "application/json", "api-key": process.env.AZURE_OPENAI_KEY! }, body: JSON.stringify(body) });
  if (!stream) { const j: any = await r.json(); return `${effort ?? "default"} status ${r.status} ${((Date.now() - t0) / 1000).toFixed(1)}s model ${j.model} out ${j.usage?.completion_tokens} reasoning ${j.usage?.completion_tokens_details?.reasoning_tokens} ${j.error?.message?.slice(0, 120) ?? ""}`; }
  const reader = r.body!.getReader(); let first = 0; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; const s = new TextDecoder().decode(value); if (!first && s.includes('"content":"')) first = Date.now(); n += s.length; }
  return `stream ${effort ?? "default"} status ${r.status} first token ${((first - t0) / 1000).toFixed(1)}s total ${((Date.now() - t0) / 1000).toFixed(1)}s`;
}
for (const e of [undefined, "low", "minimal", "none"]) console.log(await go(e, false).catch((x) => `${e} error ${x}`));
console.log(await go("low", true).catch((x) => `stream error ${x}`));
