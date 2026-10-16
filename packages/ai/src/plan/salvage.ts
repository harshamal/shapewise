import type { Blueprint } from "@shapewise/blueprint";
import { assemble, type PlanIssue } from "./assemble";
import type { BlueprintPlan } from "./schema";

/**
 * The last line of defence: when a plan still fails after repair, remove
 * exactly the parts that fail (a field, a rule, a record type...) and try
 * again, until it assembles cleanly. If nothing specific can be blamed, fall
 * back to the preset alone. Always returns a valid blueprint and says what
 * was left out, in plain words, so the person can add it later.
 */
export interface Salvaged {
  blueprint: Blueprint;
  plan: BlueprintPlan;
  removed: string[];
  notes: string[];
}

const LISTS = ["customFields", "recordTypes", "roles", "approvals", "rules", "views"] as const;
type ListKey = (typeof LISTS)[number];

export function salvage(plan: BlueprintPlan, maxRounds = 15): Salvaged {
  let current = structuredClone(plan);
  const removed: string[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const a = assemble(current);
    if (a.blueprint) return { blueprint: a.blueprint, plan: current, removed, notes: a.notes };
    const next = removeFailing(current, a.issues, removed);
    if (!next) break;
    current = next;
  }

  // Nothing specific to remove, or it kept failing: keep only the safe parts of the plan.
  const minimal: BlueprintPlan = { ...plan, customFields: [], recordTypes: [], roles: [], approvals: [], rules: [], views: [], hideSubmodules: [], extensions: [], settings: {}, seed: {} };
  const a = assemble(minimal);
  if (a.blueprint) {
    return { blueprint: a.blueprint, plan: minimal, removed: [...removed, "Everything beyond the starting setup (it couldn't be made consistent); you can add it again in System changes."], notes: a.notes };
  }
  // The preset itself is validated by tests; reaching here means the business name or modules are unusable.
  const bare = assemble({ ...minimal, modules: [] });
  if (!bare.blueprint) throw new Error(`Even the starting setup failed: ${bare.issues.map((i) => i.message).join("; ")}`);
  return { blueprint: bare.blueprint, plan: { ...minimal, modules: [] }, removed: [...removed, "The chosen modules"], notes: bare.notes };
}

/** Remove the plan elements that issues point at. Returns null if none can be blamed. */
function removeFailing(plan: BlueprintPlan, issues: PlanIssue[], removed: string[]): BlueprintPlan | null {
  const p = structuredClone(plan);
  const drop: Record<ListKey, Set<number>> = Object.fromEntries(LISTS.map((k) => [k, new Set<number>()])) as never;
  const dropField = new Map<number, Set<number>>();
  const dropWorkflow = new Set<number>();
  let blamed = false;

  for (const issue of issues) {
    const [list, idx, sub, subIdx] = issue.planPath;
    if (typeof list !== "string" || typeof idx !== "number" || !(LISTS as readonly string[]).includes(list)) continue;
    blamed = true;
    if (list === "recordTypes") {
      const rt = p.recordTypes[idx];
      if (!rt) continue;
      if (sub === "workflow") {
        dropWorkflow.add(idx);
        continue;
      }
      if (sub === "fields" && typeof subIdx === "number" && rt.fields.length > 1 && rt.fields[subIdx]?.key !== rt.titleField) {
        (dropField.get(idx) ?? dropField.set(idx, new Set()).get(idx)!).add(subIdx);
        continue;
      }
    }
    drop[list as ListKey].add(idx);
  }
  if (!blamed) return null;

  for (const [i, fields] of dropField) {
    const rt = p.recordTypes[i]!;
    for (const j of fields) removed.push(`${rt.label}: the "${rt.fields[j]!.label}" field`);
    rt.fields = rt.fields.filter((_, j) => !fields.has(j));
  }
  for (const i of dropWorkflow) {
    const rt = p.recordTypes[i]!;
    removed.push(`${rt.label}: its status workflow`);
    rt.workflow = undefined;
  }
  for (const list of LISTS) {
    const arr = p[list] as { label?: string; key?: string }[];
    for (const i of drop[list]) removed.push(describe(list, arr[i]));
    (p as Record<ListKey, unknown[]>)[list] = arr.filter((_, i) => !drop[list].has(i));
  }
  return p;
}

function describe(list: ListKey, el: { label?: string; key?: string } | undefined): string {
  const name = el?.label ?? el?.key ?? "an item";
  const kind = { customFields: "custom field", recordTypes: "record type", roles: "role", approvals: "approval rule", rules: "rule", views: "view" }[list];
  return `The ${kind} "${name}"`;
}
