import { z } from "zod";
import type { Llm, Usage } from "../llm";
import { undash } from "../onboarding/interview";

/**
 * Plain words → one approval rule ("purchase orders over Rs 500,000 need the
 * owner, and over Rs 2 million the owner and the accountant"). The model
 * picks from the workspace's real screens, actions and roles (enums), code
 * checks the action belongs to the screen and the amounts make sense, and
 * the person sees the rule in a sentence before anything changes.
 */

export interface ApprovalChoices {
  currency: string;
  targets: { target: string; label: string; hasAmount: boolean; actions: { key: string; label: string }[] }[];
  roles: { id: string; label: string }[];
}

export interface ApprovalDraft {
  label: string;
  target: string;
  action: string;
  stages: { name: string; minAmount: number; roles: string[]; requireAll: boolean }[];
  /** The rule in one plain sentence. */
  summary: string;
}

export type DraftResult = { ok: true; draft: ApprovalDraft; usage: Usage[] } | { ok: false; question: string; usage: Usage[] };

const nonEmpty = (xs: string[]) => xs as [string, ...string[]];

function schemaFor(c: ApprovalChoices) {
  return z.object({
    understood: z.boolean().describe("false when this isn't an approval rule, or it's too unclear to set up"),
    question: z.string().max(220).describe("when not understood: one short question back, in plain words. Empty otherwise"),
    label: z.string().max(60).describe("a short name for the rule, e.g. Large purchase orders"),
    target: z.enum(nonEmpty(c.targets.map((t) => t.target))),
    action: z.string().max(40).describe("one of the target's action keys"),
    stages: z
      .array(
        z.object({
          name: z.string().max(40).describe("who signs at this level, e.g. Manager, Owner"),
          minAmount: z.number().min(0).describe("applies from this amount; 0 for always. Only for screens with amounts"),
          roles: z.array(z.enum(nonEmpty(c.roles.map((r) => r.id)))).min(1).max(5),
          requireAll: z.boolean().describe("true only when one person from EACH role must approve"),
        }),
      )
      .max(5),
    summary: z.string().max(260).describe("the rule in one plain sentence, as the owner would say it"),
  });
}

function system(c: ApprovalChoices): string {
  const targets = c.targets
    .map((t) => `- ${t.target}: ${t.label}${t.hasAmount ? " (has an amount)" : " (no amount)"}. Actions: ${t.actions.map((a) => `${a.key} (${a.label})`).join(", ")}`)
    .join("\n");
  const roles = c.roles.map((r) => `- ${r.id}: ${r.label}`).join("\n");
  return `You turn an owner's description of an approval rule into a structured rule for their business system.
An approval holds an action on one screen (for example issuing a purchase order) until the right people approve it. Stages are separate sign offs, one after another, and each stage applies from its amount upwards. So "over 2 million the accountant, over 5 million the owner too" is two stages: the accountant from 2000000, then the owner from 5000000. Never repeat a role from an earlier stage. Several roles in one stage means any one of them can sign, unless they say all of them must (requireAll).

Rules:
- Pick the screen and action that match what they mean: "purchases" usually means purchase orders being issued; "sales" or "orders" means sales orders being confirmed; "payments" means payments made being posted; "write offs", "refunds" and "voids" are those actions.
- Amounts are in ${c.currency}, in full units ("Rs 2 million" is 2000000).
- Screens marked (no amount) can't have amounts; use 0.
- Use only the role ids listed. If they name a person or job that isn't a role, pick the closest role and say so in the summary.
- If they describe more than one rule, set up the first and say in the summary that the rest can be added next.
- If it isn't an approval rule or you can't tell which screen they mean, set understood false and ask one short question.
- Plain sentences. Never use dashes as punctuation.

Screens:
${targets}

Roles:
${roles}`;
}

/** Problems code finds in a draft, for the model to fix. */
export function checkDraft(d: Omit<ApprovalDraft, "summary"> & { summary?: string }, c: ApprovalChoices): string[] {
  const t = c.targets.find((x) => x.target === d.target);
  if (!t) return [`"${d.target}" isn't one of the screens.`];
  const problems: string[] = [];
  if (!t.actions.some((a) => a.key === d.action)) problems.push(`"${d.action}" isn't an action on ${t.label}. Use one of: ${t.actions.map((a) => a.key).join(", ")}.`);
  if (!d.stages.length) problems.push("A rule needs at least one stage with someone to approve.");
  return problems;
}

/** Sorts stages by amount and clears amounts on screens without one. */
export function tidyDraft(d: ApprovalDraft, c: ApprovalChoices): ApprovalDraft {
  const t = c.targets.find((x) => x.target === d.target);
  const stages = [...d.stages]
    .map((s) => ({ ...s, name: undash(s.name.trim()) || "Approval", minAmount: t?.hasAmount ? Math.round(s.minAmount) : 0, roles: [...new Set(s.roles)] }))
    .sort((a, b) => a.minAmount - b.minAmount);
  // Someone who signed at an earlier stage doesn't sign again; a stage left with nobody goes.
  const seen = new Set<string>();
  const distinct = stages.flatMap((s) => {
    const roles = s.roles.filter((r) => !seen.has(r));
    roles.forEach((r) => seen.add(r));
    return roles.length ? [{ ...s, roles }] : [];
  });
  return { ...d, label: undash(d.label.trim()) || "Approval", summary: undash(d.summary.trim()), stages: distinct };
}

export async function draftApproval(llm: Llm, choices: ApprovalChoices, request: string): Promise<DraftResult> {
  const schema = schemaFor(choices);
  const usage: Usage[] = [];
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const { value, usage: u } = await llm.json({
      tier: "chat",
      system: system(choices),
      messages: [{ role: "user", text: `${request.slice(0, 1000)}${feedback}` }],
      schema,
    });
    usage.push(u);
    if (!value.understood) return { ok: false, question: undash(value.question || "Which screen should this approval apply to?"), usage };
    const problems = checkDraft(value, choices);
    if (!problems.length) return { ok: true, draft: tidyDraft(value, choices), usage };
    feedback = `\n\n(Your last answer had problems: ${problems.join(" ")} Fix them.)`;
  }
  return { ok: false, question: "I couldn't match that to a screen and action. Which screen should wait for approval, and when?", usage };
}
