import { z } from "zod";
import { COUNTRIES, COUNTRY_BY_CODE, LK_TAX, SIZE_LABEL, TEAM_SIZES, TURNOVER_BANDS, findCountry, sizePolicy } from "@shapewise/blueprint";
import { withoutImageData, type Attachment, type Llm, type Message, type Usage } from "../llm";
import { PLACE_OPTIONS, suggestReports } from "./analytics";
import { ProfileUpdate, derive, mergeProfile, profileReady, type BusinessProfile, type Section } from "./profile";

/**
 * The onboarding interview. Two kinds of question:
 *
 * - Facts with fixed answers (country, team size, yearly sales, tax
 *   registrations) are asked by code. They need no model call, so they
 *   appear instantly, and code derives the size class and taxes from them.
 * - Everything about how the business runs is asked by the model, which
 *   replies and updates the profile in one structured answer.
 *
 * Every question carries an answer control (choices, a multi select, a
 * yes/no) so most answers are a tap.
 */

export const TOPICS = ["business", "products", "customers", "production", "stock", "documents", "team", "tracking", "wrap_up"] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_SECTION: Record<Topic, Section["key"]> = {
  business: "basics",
  products: "selling",
  customers: "selling",
  production: "making",
  stock: "buying",
  documents: "paperwork",
  team: "people",
  tracking: "paperwork",
  wrap_up: "paperwork",
};

export const TOPIC_LABEL: Record<Topic, string> = {
  business: "Your business",
  products: "What you sell",
  customers: "Customers",
  production: "Making",
  stock: "Stock",
  documents: "Paperwork",
  team: "Your team",
  tracking: "Details you track",
  wrap_up: "Ready to build",
};

export const FACTS = ["country", "teamSize", "turnover", "taxes", "reports", "reportPlaces"] as const;
export type Fact = (typeof FACTS)[number];

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

/** The model's answer. Field order matters: note and question stream first, the profile last. */
export const InterviewTurn = z.object({
  note: z
    .string()
    .max(260)
    .describe("one short sentence showing you understood the last answer: what you'll set up because of it. Never filler. Empty on the first turn"),
  question: z.string().min(1).max(220).describe("exactly one clear, short question"),
  topic: z.enum(TOPICS).describe("what this question is about"),
  input: AnswerInput,
  profile: ProfileUpdate.describe("only what the latest answer (or attachment) adds or corrects. Leave everything else empty"),
  enoughToDesign: z.boolean().describe("true when you could design a sensible first setup"),
});
export type InterviewTurn = z.infer<typeof InterviewTurn>;

/** What the browser shows for one assistant turn. */
export interface InterviewPrompt {
  note: string;
  question: string;
  topic: Topic;
  section: Section["key"];
  /** The topic in plain words, shown above the question. */
  topicLabel: string;
  input: AnswerInput;
  /** Set when code asks this question; the answer goes back with it. */
  fact?: Fact;
  /** Options to show already picked (multi only). */
  preselected?: string[];
}

const SYSTEM = `You set up business software for small and medium businesses by interviewing the owner. Most are in Sri Lanka.
You are a sharp, experienced operations consultant: calm, precise, warm, never chatty. No jargon (never say module, entity, schema, blueprint, field).

Style: plain sentences. Never use dashes as punctuation (no em dash, no en dash, no spaced hyphen); use a comma, a full stop or "and" instead.

Every turn:
- note: one sentence that proves you understood, naming the consequence for their setup ("Each order will carry its delivery date, so nothing slips."). No praise, no filler, no repeating their words back. Vary how notes open.
- question: exactly ONE question. Short. Concrete.
- input: make answering a tap whenever you can.
  - Lists (products, steps, machines, documents, roles, checks) → multi, with the likely answers for THIS kind of business.
  - Either/or (make to order or for stock, cash or credit) → single.
  - Something you can infer → state it and ask confirm, options like "Yes, that's right" / "Not quite".
  - Names and anything you can't guess → text, with a realistic placeholder.
  Options are plain words, specific to their trade and country (a bakery: "Birthday cakes", "Bread", "Short eats"; documents: "Delivery note", "GRN", "Quotation"). Never offer "Other"; they can always type.
- profile: only what this answer adds or corrects, in their words. To correct a list, put the wrong items in remove.

The app asks country, number of people, yearly sales and tax registrations itself. Never ask about those. If the person mentions them anyway, record them.

Cover, in roughly this order, skipping what doesn't apply:
1. Basics: the business name and what it does.
2. Selling: products or services, who buys, how they sell (counter, wholesale, online, delivery, contracts), cash or credit and the usual days.
3. Buying and stock: main suppliers, how stock is kept (stores, lots, expiry), shops or branches.
4. Making (only if they make things): the steps, machines, quality checks.
5. People: who will use the system and what each of them does.
6. Paperwork: documents they use today, extra details they record, what goes wrong today.

Be smart:
- Infer what you safely can and confirm it instead of asking open questions. A garment factory makes things; a pharmacy tracks expiry; a hardware shop sells on credit to contractors.
- If one answer covers several topics, record all of it and move on. Never ask for something already in the profile.
- If they answer something else, record it, then ask again more simply or move on. Never repeat a question word for word.
- Fit the questions to the size of the business: a one person shop needs few questions about people; a medium or large business has separate jobs worth naming.
- Never ask about approvals or sign off limits. They depend on the screen, the action and the amount, so the owner sets them up later in Governance, by hand or by describing them to the assistant. If the person mentions one anyway, record it in approvals.
- Documents and photos they attach (price lists, invoices, catalogues, job cards): read them closely and record the products, customers, suppliers, documents and details you find. Say briefly in the note what you picked up.

Eight to twelve turns is usually enough. When you have enough: topic wrap_up, a note summarising the setup in one sentence, ask if there's anything else before you build, kind confirm with options like "Build it" / "One more thing".`;

export interface InterviewState {
  history: Message[];
  profile: BusinessProfile;
  /** A model question held back while code asks its fact questions. */
  deferred?: InterviewPrompt;
}

export interface InterviewInput {
  message: string;
  attachments?: Attachment[];
  /** The fact question this message answers, if any. */
  answering?: Fact;
}

export interface InterviewResult extends InterviewState {
  prompt: InterviewPrompt;
  ready: boolean;
  usage: Usage[];
  /** Answered without a model call. */
  instant: boolean;
}

/** What's still unknown, so the model spends its questions where they matter. */
export function profileGaps(p: BusinessProfile): string[] {
  const gaps: string[] = [];
  const empty = (v: unknown) => v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  if (empty(p.businessName)) gaps.push("business name");
  if (empty(p.whatTheyDo)) gaps.push("what they do");
  if (empty(p.products)) gaps.push("products");
  if (empty(p.customers)) gaps.push("who buys");
  if (empty(p.salesChannels)) gaps.push("how they sell");
  if (empty(p.paymentTerms)) gaps.push("cash or credit");
  if (p.makesThings === undefined) gaps.push("whether they make things");
  if (p.makesThings && empty(p.productionSteps)) gaps.push("production steps");
  if (p.makesThings && empty(p.qualityChecks)) gaps.push("quality checks");
  if (empty(p.stockPractices)) gaps.push("how stock is kept");
  if (empty(p.team)) gaps.push("who will use the system");
  if (empty(p.documents)) gaps.push("documents used today");
  return gaps;
}

/** Remove dashes used as punctuation from text shown to the person. Hyphens inside words stay. */
export function undash(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+-\s+/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/^,\s*/, "");
}

/** The assistant turn as plain text for the conversation history, including what it offered. */
export function promptText(p: Pick<InterviewPrompt, "note" | "question" | "input">): string {
  const offered = p.input.kind !== "text" && p.input.options.length ? `\n(Offered: ${p.input.options.join(" · ")})` : "";
  return `${p.note ? `${p.note}\n` : ""}${p.question}${offered}`;
}

/** Tidy the model's answer control so the UI never shows a broken one. */
export function cleanInput(input: AnswerInput): AnswerInput {
  const seen = new Set<string>();
  const options = input.options.map((o) => undash(o.trim())).filter((o) => o && !/^other\b/i.test(o) && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase()));
  const placeholder = undash(input.placeholder);
  if (input.kind === "text" || options.length < 2) return { kind: "text", options: [], placeholder };
  return { ...input, options, placeholder };
}

/* ------------------------------------------------------- fact questions */

const TAX_OPTION = { vat: "VAT", sscl: "SSCL", wht: "Withholding tax" } as const;
const NONE_OPTION = "Not registered for any";
const MAIN_COUNTRIES = ["LK", "MV", "IN", "AE", "SG", "AU", "GB", "US"];

/** The next fact code should ask, once the basics are known. */
export function nextFact(p: BusinessProfile): Fact | undefined {
  if (!p.businessName || !p.whatTheyDo) return undefined;
  if (!p.country) return "country";
  if (!p.teamSize) return "teamSize";
  const taxRules = COUNTRY_BY_CODE.get(p.country)?.taxRules;
  if (taxRules && !p.turnover) return "turnover";
  if (taxRules && !p.taxConfirmed && !p.taxRegistrations?.length) return "taxes";
  // Reports once there's enough to suggest well: what they sell, whether they make things, and who works there.
  if (profileReady(p) && (p.team?.length || p.documents?.length)) {
    if (!p.reportsConfirmed) return "reports";
    if (!p.reportPlaces?.length) return "reportPlaces";
  }
  return undefined;
}

export function factPrompt(fact: Fact, p: BusinessProfile, note = ""): InterviewPrompt {
  const base = { fact, section: "size" as const, topic: "business" as const, note };
  switch (fact) {
    case "country":
      return {
        ...base,
        topicLabel: "Where you are",
        question: "Which country do you operate in?",
        input: { kind: "single", options: MAIN_COUNTRIES.map((c) => COUNTRY_BY_CODE.get(c)!.name), placeholder: "e.g. Sri Lanka" },
      };
    case "teamSize":
      return {
        ...base,
        topicLabel: "Size",
        question: "How many people work in the business, including you?",
        input: { kind: "single", options: TEAM_SIZES.map((t) => t.label), placeholder: "e.g. 12 people" },
      };
    case "turnover":
      return {
        ...base,
        topicLabel: "Size",
        note: note || "This decides which taxes apply and how much control the setup needs. It stays private to your workspace.",
        question: "Roughly what are your sales in a year?",
        input: { kind: "single", options: TURNOVER_BANDS.map((t) => t.label), placeholder: "e.g. about Rs 80 million" },
      };
    case "reports": {
      const s = suggestReports(p).slice(0, 8);
      return {
        ...base,
        section: "reports",
        topicLabel: "Reports",
        note: note || "Here's what businesses like yours usually keep an eye on. I've ticked the ones I'd start with.",
        question: "Which of these do you want to keep an eye on?",
        input: { kind: "multi", options: s.map((x) => x.asks), placeholder: "e.g. how much each van delivered this week" },
        preselected: s.slice(0, 5).map((x) => x.asks),
      };
    }
    case "reportPlaces":
      return {
        ...base,
        section: "reports",
        topicLabel: "Reports",
        note,
        question: "Where do you want to see them?",
        input: { kind: "multi", options: PLACE_OPTIONS.map((o) => o.label), placeholder: "e.g. on my phone every morning" },
        preselected: PLACE_OPTIONS.slice(0, 2).map((o) => o.label),
      };
    case "taxes": {
      const d = derive({ ...p, taxConfirmed: false, taxRegistrations: undefined });
      const pre = [d.tax.settings.vatRegistered && TAX_OPTION.vat, d.tax.settings.ssclRegistered && TAX_OPTION.sscl].filter(Boolean) as string[];
      const band = TURNOVER_BANDS.find((t) => t.key === p.turnover);
      const why = pre.length
        ? `At ${band?.label.toLowerCase().replace(/^rs/, "Rs")} a year you're above the ${pre.includes("VAT") ? `VAT threshold (Rs ${LK_TAX.vat.annualThreshold! / 1e6} million)` : ""}${pre.length === 2 ? " and the " : ""}${pre.includes("SSCL") ? `SSCL threshold (Rs ${LK_TAX.sscl.annualThreshold! / 1e6} million)` : ""}, so I've ticked ${pre.length === 2 ? "both" : "it"}.`
        : "You're under the VAT and SSCL thresholds, so registration isn't required, though some businesses register by choice.";
      return {
        ...base,
        topicLabel: "Taxes",
        note: note ? `${note} ${why}` : why,
        question: "Which taxes is the business registered for?",
        input: { kind: "multi", options: [TAX_OPTION.vat, TAX_OPTION.sscl, TAX_OPTION.wht, NONE_OPTION], placeholder: "e.g. VAT and SSCL" },
        preselected: pre,
      };
    }
  }
}

const has = (text: string, label: string) => text.toLowerCase().includes(label.toLowerCase());

/** Apply a fact answer. Returns a problem to ask again with when the answer doesn't fit. */
export function applyFact(fact: Fact, answer: string, p: BusinessProfile): { profile: BusinessProfile; problem?: string } {
  const a = answer.trim();
  switch (fact) {
    case "country": {
      const c = findCountry(a);
      if (!c) return { profile: p, problem: `I don't have built in rules for ${a} yet. Pick the closest of these and you can set your own tax rates later.` };
      return { profile: mergeProfile(p, { country: c.code }) };
    }
    case "teamSize": {
      const byLabel = TEAM_SIZES.find((t) => t.label.toLowerCase() === a.toLowerCase());
      const n = Number(/\d+/.exec(a)?.[0]);
      const t = byLabel ?? (/just me|only me|myself/i.test(a) ? TEAM_SIZES[0] : Number.isFinite(n) && n > 0 ? TEAM_SIZES.find((x) => n <= x.max) : undefined);
      if (!t) return { profile: p, problem: "I didn't catch the number. Pick the closest." };
      return { profile: mergeProfile(p, { teamSize: t.key }) };
    }
    case "turnover": {
      const byLabel = TURNOVER_BANDS.find((t) => t.label.toLowerCase() === a.toLowerCase());
      const m = /([\d.,]+)\s*(m|mn|million|b|bn|billion|k|lakhs?|crore)?/i.exec(a.replace(/rs\.?/i, ""));
      let rs: number | undefined;
      if (m) {
        const n = Number(m[1]!.replace(/,/g, ""));
        const unit = (m[2] ?? "").toLowerCase();
        rs = n * (unit.startsWith("b") ? 1e9 : unit.startsWith("m") ? 1e6 : unit === "k" ? 1e3 : unit.startsWith("lakh") ? 1e5 : unit === "crore" ? 1e7 : n < 10_000 ? 1e6 : 1);
      }
      const t = byLabel ?? (rs !== undefined ? TURNOVER_BANDS.find((x) => rs! < x.max) : undefined);
      if (!t) return { profile: p, problem: "A rough band is fine. Pick the closest." };
      return { profile: mergeProfile(p, { turnover: t.key }) };
    }
    case "reports": {
      const offered = suggestReports(p);
      const picked = offered.filter((s) => has(a, s.asks)).map((s) => s.key);
      // Whatever they typed that isn't one of the offered questions is kept as a wish for the design and for later.
      const rest = offered.reduce((t, s) => t.replace(s.asks, ""), a).replace(/\b(and|,)\b/gi, " ").replace(/[,\s]+/g, " ").trim();
      return { profile: mergeProfile(p, { reports: picked, reportWishes: rest.length > 3 ? [rest] : undefined, reportsConfirmed: true }) };
    }
    case "reportPlaces": {
      const places = PLACE_OPTIONS.filter((o) => has(a, o.label)).map((o) => o.place);
      const guess = places.length ? places : /email|mail|phone|morning/i.test(a) ? ["email_daily"] : ["dashboard", "module"];
      return { profile: mergeProfile(p, { reportPlaces: guess }) };
    }
    case "taxes": {
      const regs = has(a, NONE_OPTION) || /^(none|no|not registered)/i.test(a) ? [] : (Object.entries(TAX_OPTION) as [keyof typeof TAX_OPTION, string][]).filter(([k, label]) => has(a, label) || has(a, k)).map(([k]) => k);
      return { profile: mergeProfile(p, { taxRegistrations: regs, taxConfirmed: true }) };
    }
  }
}

/** One line on what code concluded from the facts, used as the note on the next question. */
function factsSummary(p: BusinessProfile): string {
  const d = derive(p);
  const parts: string[] = [];
  if (d.size) parts.push(`${SIZE_LABEL[d.size]} business${d.countryName ? ` in ${d.countryName}` : ""}`);
  const taxes = [d.tax.settings.vatRegistered && "VAT", d.tax.settings.ssclRegistered && "SSCL", d.tax.settings.wht && "withholding tax"].filter(Boolean);
  const list = taxes.length > 1 ? `${taxes.slice(0, -1).join(", ")} and ${taxes.at(-1)}` : taxes[0];
  if (COUNTRY_BY_CODE.get(p.country ?? "")?.taxRules) parts.push(list ? `invoices will handle ${list}` : "no tax registrations for now");
  else if (p.country) parts.push("taxes start off and you can add your own rates");
  const line = parts.join(", ");
  const warn = d.tax.warnings[0];
  return line ? `${line[0]!.toUpperCase()}${line.slice(1)}.${warn ? ` ${warn}` : ""}` : "";
}

/* ------------------------------------------------------------ one turn */

function systemFor(p: BusinessProfile): string {
  const d = derive(p);
  const facts = [
    d.countryName && `Country: ${d.countryName}.`,
    d.size && `Size: ${SIZE_LABEL[d.size]} (${sizePolicy(d.size).guidance})`,
    p.taxConfirmed || p.taxRegistrations?.length ? `Taxes: ${d.tax.reasons.join(" ")}` : undefined,
  ].filter(Boolean);
  const gaps = profileGaps(p);
  return `${SYSTEM}\n\nProfile so far (JSON): ${JSON.stringify(p)}\n${facts.length ? `Known from the app: ${facts.join(" ")}\n` : ""}Still unknown: ${gaps.length ? gaps.join(", ") : "nothing important"}.`;
}

function toPrompt(v: InterviewTurn): InterviewPrompt {
  return { note: undash(v.note.trim()), question: undash(v.question.trim()), topic: v.topic, section: TOPIC_SECTION[v.topic], topicLabel: TOPIC_LABEL[v.topic], input: cleanInput(v.input) };
}

/** What the browser can show while the model is still writing. */
export interface PartialPrompt {
  note?: string;
  question?: string;
}

export async function interviewTurn(llm: Llm, state: InterviewState, input: InterviewInput, onPartial?: (p: PartialPrompt) => void): Promise<InterviewResult> {
  const message = input.message.slice(0, 4000);
  let profile = state.profile;
  let history: Message[] = withoutImageData(state.history);

  /* A fact answer: code only, no model call, unless it was the last fact and nothing is held back. */
  if (input.answering) {
    const r = applyFact(input.answering, message, profile);
    const asked = factPrompt(input.answering, profile);
    if (r.problem) return { history, profile, deferred: state.deferred, prompt: { ...asked, note: r.problem }, ready: false, usage: [], instant: true };
    profile = r.profile;
    history = [...history, { role: "assistant", text: asked.question }, { role: "user", text: message }];
    const next = nextFact(profile);
    if (next) return { history, profile, deferred: state.deferred, prompt: factPrompt(next, profile), ready: false, usage: [], instant: true };
    if (state.deferred) {
      const prompt = { ...state.deferred, note: factsSummary(profile) };
      return { history: [...history, { role: "assistant", text: promptText(prompt) }], profile, prompt, ready: false, usage: [], instant: true };
    }
    return modelTurn(llm, history, profile, factsSummary(profile), onPartial);
  }

  history = [...history, { role: "user", text: message, attachments: input.attachments?.length ? input.attachments : undefined }];
  return modelTurn(llm, history, profile, undefined, onPartial);
}

async function modelTurn(llm: Llm, history: Message[], profile: BusinessProfile, leadNote: string | undefined, onPartial?: (p: PartialPrompt) => void): Promise<InterviewResult> {
  // If code may ask a fact next, the model's question could be held back, so only its note is streamed.
  const factsPending = nextFact({ ...profile, businessName: profile.businessName ?? "x", whatTheyDo: profile.whatTheyDo ?? "x" }) !== undefined;
  const { value, usage } = await llm.json({
    tier: "chat",
    system: systemFor(profile),
    messages: history,
    schema: InterviewTurn,
    temperature: 0.4,
    onPartial: onPartial
      ? (raw) => {
          const v = raw as Partial<InterviewTurn>;
          if (typeof v.note === "string") onPartial({ note: undash(v.note), question: !factsPending && typeof v.question === "string" ? undash(v.question) : undefined });
        }
      : undefined,
  });
  const merged = mergeProfile(profile, value.profile);
  let prompt = toPrompt(value);
  if (leadNote) prompt = { ...prompt, note: [leadNote, prompt.note].filter(Boolean).join(" ") };
  const fact = nextFact(merged);
  const shown = fact ? factPrompt(fact, merged, prompt.note) : prompt;
  return {
    history: [...withoutImageData(history), { role: "assistant", text: promptText(shown) }],
    profile: merged,
    deferred: fact ? prompt : undefined,
    prompt: shown,
    // Code, not the model, has the final say on readiness.
    ready: !fact && value.enoughToDesign && profileReady(merged),
    usage: [usage],
    instant: false,
  };
}

export const OPENING_PROMPT: InterviewPrompt = {
  note: "",
  question: "Tell me about your business",
  topic: "business",
  section: "basics",
  topicLabel: "Your business",
  input: { kind: "text", options: [], placeholder: "e.g. Lanka Bakes. We make cakes and short eats for cafés around Colombo" },
};

export const OPENING = "Tell me about your business: what it's called, what you make or sell, and who buys from you.";

export const COUNTRY_NAMES = COUNTRIES.map((c) => c.name);
