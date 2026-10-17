import { COUNTRY_BY_CODE, CORE_RECORDS, SIZE_LABEL, sizePolicy, type Blueprint, type CoreRecordKey } from "@shapewise/blueprint";
import { withoutImageData, type Llm, type Usage } from "../llm";
import { assemble, type AssemblyContext, type PlanIssue } from "../plan/assemble";
import { salvage } from "../plan/salvage";
import { BlueprintPlan } from "../plan/schema";
import { withAnalytics } from "./analytics";
import { catalogueBrief } from "./brief";
import { derive, type BusinessProfile } from "./profile";

/**
 * Profile → blueprint: design, assemble, repair up to three times, salvage.
 * Whatever the model does, the result is a valid blueprint, with a record of
 * how it got there for the review screen and the evals.
 *
 * Country, taxes and size controls are decided in code (jurisdiction.ts) and
 * applied by the assembler; the model is told them so the rest of the
 * design fits, but it can't change them.
 */

const SYSTEM = `You design business software setups for Shapewise, for small and medium businesses, most in Sri Lanka.
You write a Blueprint Plan (JSON) that configures Shapewise's fixed catalogue for one business.

Rules:
- Start from the closest preset and switch on only the modules and extensions the business needs.
- Core records (invoice, sales_order, batch, ...) already exist with their fields and workflows. Never recreate them as record types; add custom fields to them instead.
- Custom fields: part "line" only on records listed with "custom fields on: header+line"; everything else is "header".
- Add a record type only for something no core record covers (e.g. delivery runs, machine maintenance, customer complaints). Keep fields few and useful.
- Use field keys in snake_case. Reference other records by their key (core record key or a record type key from this plan).
- Expressions may only use field keys that exist on that record (core fields listed below, or fields you add).
- Approvals: add one only for a rule the person described in "approvals", on an action marked (approvable) for that record, amounts in the local currency, stages in increasing amount. Otherwise leave approvals empty; the owner sets them up later.
- Rules: "set" only on fields people fill in, never on status or totals the system works out.
- Roles: reuse owner, manager, accountant, sales, stores, supervisor, qc; add a role only for a distinct job. Never include owner in roles (it always has everything).
- Role grants: "area" is a submodule key from the list below (invoices, items, batches, pos_terminal, ...), a recordTypes key, or a module key to grant all of its screens.
- Select fields compare with their option values exactly (item.type is 'goods' or 'service').
- Leave settings.tax empty: taxes are set from the business's registrations.
- Fit the setup to the size of the business (given below).
- Labels and assumptions are plain words. Never use dashes as punctuation.
- Put what you assumed (not told) in "assumptions", written to the owner as "you" in one plain sentence each, saying what you set up because of it ("You keep everything in one store, so there is one warehouse to start with."). Never "they" or "the business". Only things worth checking; at most six.
- Prefer a smaller, correct setup over a large, speculative one.

${catalogueBrief()}`;

export interface DesignResult {
  blueprint: Blueprint;
  plan: BlueprintPlan;
  firstPassValid: boolean;
  repairRounds: number;
  removed: string[];
  notes: string[];
  /** Why each tax is on or off, and anything that doesn't match the rules. */
  taxReasons: string[];
  taxWarnings: string[];
  issuesSeen: PlanIssue[][];
  usage: Usage[];
}

/** Live progress while the design is written, for the building screen. */
export type DesignProgress =
  | { stage: "designing"; modules: string[]; extensions: string[]; recordTypes: string[]; customFields: string[]; roles: string[]; approvals: string[]; rules: string[] }
  | { stage: "checking" }
  | { stage: "repairing"; round: number; problems: number }
  | { stage: "finishing" };

/** What code decides about this business, for the assembler and the prompt. */
export function contextFor(profile: BusinessProfile): { ctx: AssemblyContext; brief: string } {
  const d = derive(profile);
  const policy = sizePolicy(d.size);
  const country = profile.country ? COUNTRY_BY_CODE.get(profile.country) : undefined;
  const brief = [
    `Country: ${country?.name ?? "Sri Lanka"} (currency ${country?.currency ?? "LKR"}).`,
    d.size ? `Size: ${SIZE_LABEL[d.size]}. ${policy.guidance}` : "",
    `Taxes (decided already): ${d.tax.reasons.join(" ") || "none"}`,
  ]
    .filter(Boolean)
    .join("\n");
  // Approvals start empty: the template's defaults rarely fit, and the owner sets them up after seeing the system.
  return { ctx: { country, tax: d.tax, sizeSettings: policy.settings, presetApprovals: false }, brief };
}

/** The valid choices for the records a set of problems touches, so a repair doesn't have to guess. */
export function repairHints(plan: BlueprintPlan, issues: PlanIssue[]): string {
  const records = new Set<string>();
  for (const i of issues) {
    const [group, index] = i.planPath;
    const el = typeof index === "number" ? (plan as unknown as Record<string, { record?: string }[]>)[String(group)]?.[index] : undefined;
    if (el?.record) records.add(el.record);
  }
  const lines = [...records].flatMap((r) => {
    if (r in CORE_RECORDS) {
      const c = CORE_RECORDS[r as CoreRecordKey];
      const custom = plan.customFields.filter((f) => f.record === r).map((f) => f.key);
      const actions = c.lifecycle?.actions.map((a) => `${a.key}${a.approvable ? "(approvable)" : ""}`).join(", ") ?? "none";
      return [`- ${r}: fields ${[...c.fields.filter((f) => !f.system).map((f) => f.key), ...custom].join(", ")}; system fields (read only) ${c.fields.filter((f) => f.system).map((f) => f.key).join(", ") || "none"}; statuses ${c.lifecycle?.states.map((s) => s.key).join(", ") ?? "none"}; actions ${actions}; custom fields on ${c.customFields.join("+") || "nothing"}`];
    }
    const rt = plan.recordTypes.find((x) => x.key === r);
    return rt ? [`- ${r}: fields ${rt.fields.map((f) => f.key).join(", ")}; statuses ${rt.workflow?.states.map((s) => s.key).join(", ") ?? "none"}; actions ${rt.workflow?.transitions.map((t) => t.key).join(", ") ?? "none"}`] : [];
  });
  return lines.length ? `\n\nValid choices for the records involved:\n${lines.join("\n")}` : "";
}

const labels = (xs: unknown, key = "label") => (Array.isArray(xs) ? xs.map((x) => (x && typeof x === "object" ? String((x as Record<string, unknown>)[key] ?? "") : String(x))).filter(Boolean) : []);

export async function designBlueprint(
  llm: Llm,
  profile: BusinessProfile,
  opts: { maxRepairs?: number; onProgress?: (p: DesignProgress) => void; attachments?: string } = {},
): Promise<DesignResult> {
  const usage: Usage[] = [];
  const issuesSeen: PlanIssue[][] = [];
  const { ctx, brief } = contextFor(profile);
  const progress = opts.onProgress;
  const first = await llm.json({
    tier: "design",
    system: SYSTEM,
    messages: withoutImageData([{ role: "user", text: `Design the setup for this business.\n${brief}\n\nProfile (JSON):\n${JSON.stringify(profile, null, 1)}${opts.attachments ?? ""}` }]),
    schema: BlueprintPlan,
    temperature: 0.2,
    onPartial: progress
      ? (raw) => {
          const v = raw as Partial<Record<keyof BlueprintPlan, unknown>>;
          progress({
            stage: "designing",
            modules: labels(v.modules),
            extensions: labels(v.extensions),
            recordTypes: labels(v.recordTypes),
            customFields: labels(v.customFields),
            roles: labels(v.roles),
            approvals: labels(v.approvals),
            rules: labels(v.rules),
          });
        }
      : undefined,
  });
  usage.push(first.usage);
  progress?.({ stage: "checking" });

  let plan = first.value;
  let a = assemble(plan, ctx);
  const firstPassValid = Boolean(a.blueprint);
  let rounds = 0;

  while (!a.blueprint && rounds < (opts.maxRepairs ?? 3)) {
    rounds++;
    issuesSeen.push(a.issues);
    progress?.({ stage: "repairing", round: rounds, problems: a.issues.length });
    const fixed = await llm.json({
      tier: "design",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          text:
            `This plan has problems. Fix each one and return the whole corrected plan. Change nothing else.\n\n` +
            `Problems (path into the plan: message):\n${a.issues.map((i) => `- ${i.planPath.join(".") || "(general)"}: ${i.message}`).join("\n")}` +
            repairHints(plan, a.issues) +
            `\n\nPlan (JSON):\n${JSON.stringify(plan)}`,
        },
      ],
      schema: BlueprintPlan,
      temperature: 0.1,
    });
    usage.push(fixed.usage);
    plan = fixed.value;
    a = assemble(plan, ctx);
  }

  progress?.({ stage: "finishing" });
  const taxReasons = ctx.tax?.reasons ?? [];
  const taxWarnings = ctx.tax?.warnings ?? [];
  if (a.blueprint) {
    const r = withAnalytics(a.blueprint, profile);
    return { blueprint: r.blueprint, plan, firstPassValid, repairRounds: rounds, removed: [], notes: [...a.notes, ...r.notes], taxReasons, taxWarnings, issuesSeen, usage };
  }
  issuesSeen.push(a.issues);
  const s = salvage(plan, ctx);
  const r = withAnalytics(s.blueprint, profile);
  return { blueprint: r.blueprint, plan: s.plan, firstPassValid, repairRounds: rounds, removed: s.removed, notes: [...s.notes, ...r.notes], taxReasons, taxWarnings, issuesSeen, usage };
}
