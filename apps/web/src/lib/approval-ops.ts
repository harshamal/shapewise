import type { OverlayOp } from "@shapewise/blueprint";

/** An approval rule as the settings screen and the AI draft it. */
export interface ApprovalRuleInput {
  label: string;
  target: string;
  action: string;
  stages: { name: string; minAmount: number; roles: string[]; requireAll: boolean }[];
}

const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

/** The settings change that adds a rule, or replaces one (same id kept). */
export function approvalOps(rule: ApprovalRuleInput, replace?: string): OverlayOp[] {
  const value = {
    id: replace ?? `apr_${rid()}`,
    label: rule.label.trim().slice(0, 60) || "Approval",
    target: rule.target,
    action: rule.action,
    enabled: true,
    stages: [...rule.stages]
      .sort((a, b) => a.minAmount - b.minAmount)
      .map((s) => ({ id: `aps_${rid()}`, name: s.name.trim().slice(0, 60) || "Approval", minAmount: Math.max(0, Math.round(s.minAmount)), roles: s.roles, requireAll: s.requireAll })),
  };
  return replace ? [{ op: "remove", id: replace }, { op: "add", collection: "approvals", value }] : [{ op: "add", collection: "approvals", value }];
}

/** Money in the workspace currency, as people write it. */
export function money(n: number, currency: string): string {
  if (currency === "LKR") return `Rs ${n.toLocaleString("en-LK")}`;
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
