import { z } from "zod";
import type { Llm, Message } from "../llm";
import { BusinessProfile, mergeProfile, profileReady } from "./profile";

/**
 * One turn of the onboarding interview. The model replies to the person and
 * updates the business profile in the same structured answer; code merges
 * the profile and decides when there's enough to design.
 *
 * Every turn carries an answer control (choices, a multi-select, a yes/no)
 * so most answers are a tap rather than typing.
 */

export const TOPICS = ["business", "products", "customers", "production", "stock", "documents", "team", "approvals", "tracking", "taxes", "wrap_up"] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABEL: Record<Topic, string> = {
  business: "Your business",
  products: "What you sell",
  customers: "Customers",
  production: "Production",
  stock: "Stock",
  documents: "Paperwork",
  team: "Your team",
  approvals: "Approvals",
  tracking: "Details you track",
  taxes: "Taxes",
  wrap_up: "Ready to build",
};

export const AnswerInput = z.object({
  kind: z
    .enum(["text", "single", "multi", "confirm"])
    .describe("text: open answer only. single: pick one option. multi: pick any that apply (lists like products, steps, documents). confirm: yes/no on something you inferred"),
  options: z
    .array(z.string().min(1).max(48))
    .max(8)
    .describe("2 to 8 short answers the person can tap, in their words and specific to this business (not generic). Empty for text"),
  placeholder: z.string().max(90).describe("a realistic example answer for the text box, specific to this business, starting with 'e.g.'"),
});
export type AnswerInput = z.infer<typeof AnswerInput>;

export const InterviewTurn = z.object({
  note: z
    .string()
    .max(240)
    .describe("one short sentence showing you understood the last answer: an implication or what you'll set up because of it. Never filler ('Great!', 'Thanks for sharing'). Empty on the first turn"),
  question: z.string().min(1).max(220).describe("exactly one clear, short question"),
  topic: z.enum(TOPICS).describe("what this question is about"),
  input: AnswerInput,
  profile: BusinessProfile.describe("everything learned so far, including from earlier turns"),
  enoughToDesign: z.boolean().describe("true when you could design a sensible first setup"),
});
export type InterviewTurn = z.infer<typeof InterviewTurn>;

/** What the browser shows for one assistant turn. */
export interface InterviewPrompt {
  note: string;
  question: string;
  topic: Topic;
  /** The topic in plain words, shown above the question. */
  topicLabel: string;
  input: AnswerInput;
}

const SYSTEM = `You set up business software for small and medium businesses in Sri Lanka by interviewing the owner.
You are a sharp, experienced operations consultant: calm, precise, warm, never chatty. No jargon (never say module, entity, schema, blueprint, field).

Every turn:
- note: one sentence that proves you understood — name the consequence for their setup ("Each order will carry its delivery date, so nothing slips."). No praise, no filler, no repeating their words back. Vary how notes open; don't start every one with "Since you".
- question: exactly ONE question. Short. Concrete.
- input: make answering a tap whenever you can.
  - Lists (products, steps, machines, documents, roles, checks) → multi, with the likely answers for THIS kind of business.
  - Either/or (make to order vs. stock, cash vs. credit) → single.
  - Something you can infer from what they said → state the inference and ask confirm, options like "Yes, that's right" / "Not quite".
  - Names and anything you can't guess → text, with a realistic placeholder.
  Options are in plain words, specific to their trade and Sri Lanka (e.g. a bakery: "Birthday cakes", "Bread", "Short eats"; documents: "Delivery note", "GRN", "Quotation"). Never offer "Other" — they can always type.

Be smart about order and coverage:
- Infer what you safely can and confirm it instead of asking open questions. A garment factory makes things; a pharmacy tracks expiry; a hardware shop sells on credit to contractors.
- Skip topics that don't apply (no production for a pure trader; no approvals for a one-person shop).
- If one answer covers several topics, record all of it and move on. Never ask for something already in the profile.
- If they answer something other than what you asked, record it, then ask again more simply or move on. Never repeat a question word for word.
- Prefer the questions that change the setup most: what they sell and to whom, whether they make things, how stock works, who uses the system and who approves what.
Topics: what they do and sell; who buys and how; production (steps, machines, quality checks); stock (stores, lots, expiry); documents they use today; who will use the system; approvals with amounts; extra details they track; taxes (VAT, SSCL, WHT).

Record only what they told you or confirmed, in their words. Six to ten turns is usually enough.
When you have enough: topic wrap_up, a note summarising the shape of the setup in one sentence, ask if there's anything else before you build, kind confirm with options like "Build it" / "One more thing".`;

export interface InterviewState {
  history: Message[];
  profile: BusinessProfile;
}

/** What's still unknown, so the model spends its questions where they matter. */
export function profileGaps(p: BusinessProfile): string[] {
  const gaps: string[] = [];
  const empty = (v: unknown) => v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  if (empty(p.businessName)) gaps.push("business name");
  if (empty(p.whatTheyDo)) gaps.push("what they do");
  if (empty(p.products)) gaps.push("products");
  if (empty(p.customers)) gaps.push("customers and how they buy");
  if (p.makesThings === undefined) gaps.push("whether they make things");
  if (p.makesThings && empty(p.productionSteps)) gaps.push("production steps");
  if (p.makesThings && empty(p.qualityChecks)) gaps.push("quality checks");
  if (empty(p.stockPractices)) gaps.push("how stock is kept");
  if (empty(p.documents)) gaps.push("documents used today");
  if (empty(p.team)) gaps.push("who will use the system");
  if (empty(p.approvals)) gaps.push("approvals");
  if (empty(p.taxes)) gaps.push("taxes");
  return gaps;
}

/** The assistant turn as plain text for the conversation history, including what it offered. */
export function promptText(p: Pick<InterviewPrompt, "note" | "question" | "input">): string {
  const offered = p.input.kind !== "text" && p.input.options.length ? `\n(Offered: ${p.input.options.join(" · ")})` : "";
  return `${p.note ? `${p.note}\n` : ""}${p.question}${offered}`;
}

/** Tidy the model's answer control so the UI never shows a broken one. */
export function cleanInput(input: AnswerInput): AnswerInput {
  const seen = new Set<string>();
  const options = input.options.map((o) => o.trim()).filter((o) => o && !/^other\b/i.test(o) && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase()));
  if (input.kind === "text" || options.length < 2) return { kind: "text", options: [], placeholder: input.placeholder };
  return { ...input, options };
}

export async function interviewTurn(llm: Llm, state: InterviewState, message: string): Promise<InterviewState & { prompt: InterviewPrompt; ready: boolean }> {
  const history: Message[] = [...state.history, { role: "user", text: message.slice(0, 4000) }];
  const gaps = profileGaps(state.profile);
  const { value } = await llm.json({
    tier: "chat",
    system: `${SYSTEM}\n\nProfile so far (JSON): ${JSON.stringify(state.profile)}\nStill unknown: ${gaps.length ? gaps.join(", ") : "nothing important"}.`,
    messages: history,
    schema: InterviewTurn,
    temperature: 0.4,
  });
  const profile = mergeProfile(state.profile, value.profile);
  const prompt: InterviewPrompt = { note: value.note.trim(), question: value.question.trim(), topic: value.topic, topicLabel: TOPIC_LABEL[value.topic], input: cleanInput(value.input) };
  return {
    history: [...history, { role: "assistant", text: promptText(prompt) }],
    profile,
    prompt,
    // Code, not the model, has the final say on readiness.
    ready: value.enoughToDesign && profileReady(profile),
  };
}

export const OPENING_PROMPT: InterviewPrompt = {
  note: "I'll shape your system around how your business actually runs — a few quick questions, most of them a tap.",
  question: "What's the business called, and what do you make or sell?",
  topic: "business",
  topicLabel: TOPIC_LABEL.business,
  input: { kind: "text", options: [], placeholder: "e.g. Lanka Bakes — cakes and short eats for cafés around Colombo" },
};

export const OPENING = promptText(OPENING_PROMPT);
