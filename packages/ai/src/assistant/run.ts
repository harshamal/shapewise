import { withoutImageData, type Attachment, type Llm, type Message, type Usage } from "../llm";
import { undash } from "../onboarding/interview";
import { runTool, toolSpecs, visibleTargets, type Proposal, type ToolContext } from "./tools";

/**
 * The workspace assistant: one Gemini/OpenAI model made specific to a
 * business by its blueprint (system prompt), its live data (tools) and the
 * person's role (what the tools can see). Nothing is trained or stored in
 * the model.
 */

export interface AssistantResult {
  reply: string;
  /** Two or three likely next questions, for the person to tap. */
  suggestions: string[];
  messages: Message[];
  proposals: Proposal[];
  toolsUsed: { name: string; args: unknown; ok: boolean }[];
  usage: Usage[];
}

const MAX_TOOL_ROUNDS = 6;

/** What the panel can show while the assistant works. */
export type AssistantEvent = { type: "tool"; name: string; record?: string; ok: boolean } | { type: "text"; delta: string } | { type: "round" };

export function systemPrompt(ctx: ToolContext): string {
  const { bp } = ctx.compiled;
  const role = bp.roles.find((r) => r.key === ctx.roleKey);
  const records = [...visibleTargets(ctx).entries()]
    .map(([key, t]) => {
      const fields = t.fields
        .filter((f) => !["longtext", "file", "image"].includes(f.type))
        .map((f) => `${f.key}:${f.type}${f.type === "ref" && f.to ? `→${f.to}` : ""}${f.options ? `(${f.options.map((o) => o.value).join("|")})` : ""}`)
        .join(", ");
      const statuses = t.states.length ? ` | statuses: ${t.states.map((s) => s.key).join(", ")}` : "";
      const actions = t.actions.length ? ` | actions: ${t.actions.map((a) => a.key).join(", ")}` : "";
      const lines = t.lines ? ` | lines: ${t.lines.fields.map((f) => f.key).join(", ")}` : "";
      return `- ${key} (${t.labelPlural}): ${fields}${statuses}${actions}${lines}`;
    })
    .join("\n");
  const rules = bp.rules.map((r) => `- ${r.label}`).join("\n");
  const approvals = bp.approvals.map((a) => `- ${a.label}: ${a.action} on ${a.target} → ${a.stages.map((s) => `${s.name}${s.minAmount ? ` from Rs ${s.minAmount.toLocaleString("en-LK")}` : ""}`).join(", then ")}`).join("\n");

  return `You are the assistant inside Shapewise for ${bp.business.name}${bp.business.industry ? ` (${bp.business.industry})` : ""}.
Today is ${ctx.today}. Currency: ${bp.business.currency} (write amounts as Rs 1,234.50). The person you're helping has the role "${role?.label ?? ctx.roleKey}".

How to answer:
- Use the tools to look at real data before answering anything about records, totals or trends. Never guess or invent numbers, names or ids.
- Be brief and concrete. Use short lists or small tables for several records. Mention record numbers or names so the person can find them.
- If a tool returns an error, fix the call (it says what was wrong) and try again.
- To create or change anything, use propose_change. It is not done until the person confirms; say what it will do, never that it's done.
- If the person asks for something their role can't see or do, say so plainly.
- Lead with the answer (the number, the name, the yes/no), then the detail. Use **bold** for the key figure. No preamble, no "Sure!".
- Plain sentences. Never use dashes as punctuation (no em dash, en dash or spaced hyphen).
- Documents and photos the person attaches (a supplier bill, a price list, an order): read them closely. If they describe something to record, look up the matching customer, vendor or items with the tools, then offer it with propose_change.
- When you need several lookups that don't depend on each other, call the tools together in one turn.
- Finish with one final line exactly like: Next: <question> | <question> | <question>
  Two or three short follow-ups the person is most likely to want next, written as they'd type them, specific to what you just found (e.g. "Remind Perera Stores", "Show invoices over Rs 100,000"). Don't mention this line.
- Filters use Shapewise expressions over field keys: status = 'posted' and due_date < today(); customer.name = 'X'; contains(lower(name), 'cake').

Record types this person can see (key: fields | statuses | actions | lines):
${records || "(none)"}
${rules ? `\nBusiness rules in force:\n${rules}` : ""}${approvals ? `\nApproval rules:\n${approvals}` : ""}`;
}

export async function runAssistant(
  llm: Llm,
  ctx: ToolContext,
  history: Message[],
  question: string,
  opts: { attachments?: Attachment[]; onEvent?: (e: AssistantEvent) => void } = {},
): Promise<AssistantResult> {
  const messages: Message[] = [...withoutImageData(history), { role: "user", text: question.slice(0, 4000), attachments: opts.attachments?.length ? opts.attachments : undefined }];
  const emit = opts.onEvent;
  const tools = toolSpecs(ctx);
  const system = systemPrompt(ctx);
  const proposals: Proposal[] = [];
  const toolsUsed: AssistantResult["toolsUsed"] = [];
  const usage: Usage[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // On the last round, no tools: the model must answer with what it has.
    if (round > 0) emit?.({ type: "round" });
    const res = await llm.turn({ tier: "chat", system, messages, tools: round < MAX_TOOL_ROUNDS ? tools : [], onText: emit ? (delta) => emit({ type: "text", delta }) : undefined });
    usage.push(res.usage);
    messages.push(res.message);
    const calls = res.message.toolCalls ?? [];
    if (!calls.length) {
      const { reply, suggestions } = splitSuggestions(res.message.text);
      return { reply: undash(reply) || "I couldn't find an answer to that.", suggestions: suggestions.map(undash), messages: withoutImageData(messages), proposals, toolsUsed, usage };
    }
    // Independent lookups run together; results go back in the order the model asked.
    const results = await Promise.all(calls.map((call) => runTool(ctx, call.name, call.args, proposals)));
    calls.forEach((call, i) => {
      const result = results[i];
      const ok = !(result && typeof result === "object" && "error" in result);
      toolsUsed.push({ name: call.name, args: call.args, ok });
      emit?.({ type: "tool", name: call.name, record: (call.args as { record?: string }).record, ok });
      messages.push({ role: "tool", callId: call.id, name: call.name, result });
    });
  }
  return { reply: "That took too many steps. Try asking more specifically.", suggestions: [], messages: withoutImageData(messages), proposals, toolsUsed, usage };
}

/** Pull the trailing "Next: a | b | c" line off a reply. */
export function splitSuggestions(text: string): { reply: string; suggestions: string[] } {
  const m = /(?:^|\n)\s*\**next\**\s*:\s*\**\s*(.+?)\s*$/i.exec(text.trimEnd());
  if (!m) return { reply: text.trim(), suggestions: [] };
  const suggestions = m[1]!
    .split("|")
    .map((s) => s.trim().replace(/^["'“]|["'”]$/g, ""))
    .filter((s) => s.length > 1 && s.length <= 80)
    .slice(0, 3);
  return { reply: text.slice(0, m.index).trim(), suggestions };
}
