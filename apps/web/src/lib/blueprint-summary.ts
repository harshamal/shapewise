import { CORE_RECORDS, EXTENSION_BY_KEY, MODULES, navigation, type Blueprint, type CoreRecordKey } from "@shapewise/blueprint";

/** A blueprint in plain words, for the onboarding review screen. */
export interface BlueprintSummary {
  name: string;
  industry?: string;
  modules: { label: string; screens: string[] }[];
  extensions: string[];
  recordTypes: { label: string; fields: string[]; statuses: string[] }[];
  customFields: { record: string; label: string; where: string }[];
  roles: { label: string; description?: string }[];
  approvals: string[];
  rules: string[];
  machines: string[];
}

export function summarise(bp: Blueprint): BlueprintSummary {
  const recordLabel = (t: string) => (t in CORE_RECORDS ? CORE_RECORDS[t as CoreRecordKey].labelPlural : (bp.entities.find((e) => e.id === t)?.labelPlural ?? t));
  const roleLabel = (id: string) => bp.roles.find((r) => r.id === id)?.label ?? id;
  const nav = navigation(bp).flatMap((s) => s.modules);
  return {
    name: bp.business.name,
    industry: bp.business.industry,
    modules: MODULES.filter((m) => !m.core && bp.modules.some((c) => c.key === m.key && c.enabled)).map((m) => ({ label: m.label, screens: nav.find((n) => n.key === m.key)?.submodules.map((s) => s.label) ?? [] })),
    extensions: bp.extensions.map((k) => EXTENSION_BY_KEY[k].name),
    recordTypes: bp.entities.map((e) => ({ label: e.labelPlural, fields: e.fields.map((f) => f.label), statuses: e.workflow?.states.map((s) => s.label) ?? [] })),
    customFields: bp.customFields.map((c) => ({ record: recordLabel(c.target), label: c.field.label, where: c.part === "line" ? "on each line" : "" })),
    roles: bp.roles.map((r) => ({ label: r.label, description: r.description })),
    approvals: bp.approvals.map((a) => `${a.label}: ${a.stages.map((s) => `${s.roles.map(roleLabel).join(" or ")}${s.minAmount ? ` from Rs ${s.minAmount.toLocaleString("en-LK")}` : ""}`).join(", then ")}`),
    rules: bp.rules.map((r) => r.label),
    machines: bp.seed.production.resources.map((r) => r.name),
  };
}
