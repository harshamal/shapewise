import type { Blueprint } from "@shapewise/blueprint";
import type { Llm, Usage } from "../llm";
import { assemble, type PlanIssue } from "../plan/assemble";
import { salvage } from "../plan/salvage";
import { BlueprintPlan } from "../plan/schema";
import { catalogueBrief } from "./brief";
import type { BusinessProfile } from "./profile";

/**
 * Profile → blueprint: design, assemble, repair up to three times, salvage.
 * Whatever the model does, the result is a valid blueprint, with a record of
 * how it got there for the review screen and the evals.
 */

const SYSTEM = `You design business software setups for Shapewise, for Sri Lankan SMEs.
You write a Blueprint Plan (JSON) that configures Shapewise's fixed catalogue for one business.

Rules:
- Start from the closest preset and switch on only the modules and extensions the business needs.
- Core records (invoice, sales_order, batch, ...) already exist with their fields and workflows. Never recreate them as record types; add custom fields to them instead.
- Add a record type only for something no core record covers (e.g. delivery runs, machine maintenance, customer complaints). Keep fields few and useful.
- Use field keys in snake_case. Reference other records by their key (core record key or a record type key from this plan).
- Expressions may only use field keys that exist on that record (core fields listed below, or fields you add).
- Approvals: only on actions marked approvable, amounts in rupees, stages in increasing amount.
- Roles: reuse owner, manager, accountant, sales, stores, supervisor, qc; add a role only for a distinct job.
- Put what you assumed (not told) in "assumptions" in plain words.
- Prefer a smaller, correct setup over a large, speculative one.

${catalogueBrief()}`;

export interface DesignResult {
  blueprint: Blueprint;
  plan: BlueprintPlan;
  firstPassValid: boolean;
  repairRounds: number;
  removed: string[];
  notes: string[];
  issuesSeen: PlanIssue[][];
  usage: Usage[];
}

export async function designBlueprint(llm: Llm, profile: BusinessProfile, opts: { maxRepairs?: number } = {}): Promise<DesignResult> {
  const usage: Usage[] = [];
  const issuesSeen: PlanIssue[][] = [];
  const first = await llm.json({
    tier: "design",
    system: SYSTEM,
    messages: [{ role: "user", text: `Design the setup for this business. Profile (JSON):\n${JSON.stringify(profile, null, 1)}` }],
    schema: BlueprintPlan,
    temperature: 0.2,
  });
  usage.push(first.usage);

  let plan = first.value;
  let a = assemble(plan);
  const firstPassValid = Boolean(a.blueprint);
  let rounds = 0;

  while (!a.blueprint && rounds < (opts.maxRepairs ?? 3)) {
    rounds++;
    issuesSeen.push(a.issues);
    const fixed = await llm.json({
      tier: "design",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          text:
                `This plan has problems. Fix each one and return the whole corrected plan. Change nothing else.\n\n` +
                `Problems (path into the plan: message):\n${a.issues.map((i) => `- ${i.planPath.join(".") || "(general)"}: ${i.message}`).join("\n")}\n\n` +
                `Plan (JSON):\n${JSON.stringify(plan)}`,
        },
      ],
      schema: BlueprintPlan,
      temperature: 0.1,
    });
    usage.push(fixed.usage);
    plan = fixed.value;
    a = assemble(plan);
  }

  if (a.blueprint) return { blueprint: a.blueprint, plan, firstPassValid, repairRounds: rounds, removed: [], notes: a.notes, issuesSeen, usage };
  issuesSeen.push(a.issues);
  const s = salvage(plan);
  return { blueprint: s.blueprint, plan: s.plan, firstPassValid, repairRounds: rounds, removed: s.removed, notes: s.notes, issuesSeen, usage };
}
