/**
 * A live onboarding interview with scripted answers, printing each question
 * and the answer controls it offers.
 *   tsx evals/interview.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OPENING, createLlm, interviewTurn, type InterviewState } from "../src";

const envPath = fileURLToPath(new URL("../../../apps/web/.env.local", import.meta.url));
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
}

// Free-text answers, used in order whenever a question has no options; otherwise the "person" taps.
const typed = [
  "Ruhunu Bakers in Galle. We bake cakes, bread and short eats and supply hotels and a few supermarkets.",
  "Hotels get 30 days credit; walk-in customers pay cash",
  "Me, a shop manager, two bakers and a delivery driver",
  "Anything over Rs 50,000 needs my approval",
  "We're VAT registered",
];
const TURNS = 9;

const llm = createLlm();
let state: InterviewState = { history: [{ role: "assistant", text: OPENING }], profile: {} };
let a = typed.shift()!;
for (let turn = 0; turn < TURNS; turn++) {
  const t0 = Date.now();
  const r = await interviewTurn(llm, state, a);
  state = r;
  console.log(`\n> ${a}`);
  console.log(`  [${r.prompt.topicLabel}] ${r.prompt.note}`);
  console.log(`  Q: ${r.prompt.question}`);
  console.log(`  ${r.prompt.input.kind}: ${r.prompt.input.options.join(" · ") || "—"}   (${r.prompt.input.placeholder})`);
  console.log(`  ready=${r.ready}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (r.ready) break;
  const { kind, options } = r.prompt.input;
  a = kind === "multi" ? options.slice(0, 3).join(", ") : kind !== "text" ? options[0]! : (typed.shift() ?? "Nothing else");
}
console.log("\nProfile:", JSON.stringify(state.profile, null, 2));
