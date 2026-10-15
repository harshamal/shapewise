import "server-only";
import {
  CHART_TEMPLATES,
  CORE_RECORDS,
  EXTENSIONS,
  MODULE_BY_KEY,
  SUBMODULE_BY_KEY,
  type Blueprint,
  type CoreRecordKey,
  type Seed,
  type Settings,
} from "@shapewise/blueprint";
import type { Workspace } from "./workspace";

/**
 * Everything the settings popup shows, as plain data. Built on the server
 * from the live blueprint; changes go back through applyOps.
 */
export interface SettingsData {
  tenant: string;
  canManage: boolean;
  tabs: { key: string; label: string }[];
  business: Blueprint["business"];
  settings: Settings;
  chartLabel: string;
  extensions: {
    key: string;
    name: string;
    summary: string;
    details: string[];
    category: string;
    on: boolean;
    requires: string[];
    blockedBy: string[];
  }[];
  roles: { id: string; label: string; description?: string; owner: boolean; grants: { label: string; actions: string[]; scope: string }[] }[];
  approvals: { id: string; label: string; record: string; action: string; when?: string; channels?: string[]; stages: { name: string; minAmount: number; roles: string[]; requireAll: boolean }[] }[];
  customFields: { record: string; part: string; label: string; type: string; onDocuments: boolean; inProduction: boolean }[];
  numbering: { record: string; pattern: string; custom: boolean }[];
  seed: Seed;
  version: number;
}

export function settingsData(ws: Workspace): SettingsData {
  const { bp, compiled } = ws;
  const roleLabel = (id: string) => bp.roles.find((r) => r.id === id)?.label ?? id;
  const recordLabel = (t: string) => (t in CORE_RECORDS ? CORE_RECORDS[t as CoreRecordKey].labelPlural : (bp.entities.find((e) => e.id === t)?.labelPlural ?? t));
  const admin = ws.sections.find((s) => s.key === "admin")?.modules[0]?.submodules ?? [];
  const on = new Set(bp.extensions);
  const modulesOn = new Set(bp.modules.filter((m) => m.enabled).map((m) => m.key));

  return {
    tenant: ws.tenant,
    canManage: compiled.can(ws.actor.roleKey, "extensions", "manage"),
    tabs: admin.map((s) => ({ key: s.key, label: s.label })),
    business: bp.business,
    settings: bp.settings,
    chartLabel: CHART_TEMPLATES[bp.settings.accounting.chartTemplate].label,
    extensions: EXTENSIONS.map((e) => ({
      key: e.key,
      name: e.name,
      summary: e.summary,
      details: [...e.details],
      category: e.category,
      on: on.has(e.key),
      requires: e.requires.map((r) => EXTENSIONS.find((x) => x.key === r)!.name),
      blockedBy: e.needsModules.filter((m) => !modulesOn.has(m) && !MODULE_BY_KEY.get(m)?.core).map((m) => MODULE_BY_KEY.get(m)?.label ?? m),
    })),
    roles: bp.roles.map((r) => ({
      id: r.id,
      label: r.label,
      description: r.description,
      owner: Boolean(r.owner),
      grants: r.grants.map((g) => ({
        label: g.target === "*" ? "Everything" : (SUBMODULE_BY_KEY.get(g.target)?.label ?? bp.entities.find((e) => e.id === g.target || e.key === g.target)?.labelPlural ?? g.target),
        actions: [...g.actions],
        scope: typeof g.scope === "object" ? (g.scope.kind === "own" ? "Own records" : "Some records") : "All records",
      })),
    })),
    approvals: bp.approvals.map((a) => ({
      id: a.id,
      label: a.label,
      record: recordLabel(a.target),
      action: a.action,
      when: a.when,
      channels: a.channels,
      stages: a.stages.map((s) => ({ name: s.name, minAmount: s.minAmount, roles: s.roles.map(roleLabel), requireAll: s.requireAll })),
    })),
    customFields: bp.customFields.map((c) => ({ record: recordLabel(c.target), part: c.part, label: c.field.label, type: c.field.type, onDocuments: c.showOnDocuments, inProduction: c.showInProduction })),
    numbering: [...compiled.targets.values()]
      .filter((t) => t.numbering)
      .map((t) => ({ record: t.labelPlural, pattern: t.numbering!, custom: bp.settings.general.numbering.some((n) => n.record === t.target) })),
    seed: bp.seed,
    version: bp.version,
  };
}
