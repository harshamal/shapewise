import { MODULES, SECTIONS, type SubmoduleKind } from "./catalogue/modules";
import type { CoreRecordKey } from "./catalogue/records";
import type { Blueprint } from "./schema";
import { Resolved } from "./validate";

/**
 * The navigation a business sees: catalogue sections → enabled modules →
 * enabled submodules, with the blueprint's labels and order applied and custom
 * record types placed in their modules. Permissions are applied on top of
 * this per person.
 */
export interface NavSubmodule {
  key: string;
  label: string;
  kind: SubmoduleKind | "custom";
  /** Core record listed here. */
  record?: CoreRecordKey;
  /** Custom record type id. */
  entity?: string;
}

export interface NavModule {
  key: string;
  label: string;
  icon: string;
  submodules: NavSubmodule[];
}

export interface NavSection {
  key: string;
  label: string;
  modules: NavModule[];
}

export function navigation(bp: Blueprint): NavSection[] {
  const r = new Resolved(bp);
  const byOrder = <T extends { order: number; index: number }>(a: T, b: T) => a.order - b.order || a.index - b.index;

  const modules: (NavModule & { section: string; order: number; index: number })[] = [];

  MODULES.forEach((m, index) => {
    if (!r.modules.has(m.key)) return;
    const cfg = bp.modules.find((c) => c.key === m.key);
    const subs = m.submodules
      .map((s, i) => {
        const sc = cfg?.submodules.find((c) => c.key === s.key);
        return { key: s.key, label: sc?.label ?? s.label, kind: s.kind, record: s.record, order: sc?.order ?? i * 10, index: i, on: r.submoduleEnabled(s.key) };
      })
      .filter((s) => s.on);
    const customs = entitiesIn(m.key, subs.length);
    modules.push({
      key: m.key,
      label: cfg?.label ?? m.label,
      icon: m.icon,
      section: m.section,
      order: cfg?.order ?? index * 10,
      index,
      submodules: [...subs, ...customs].sort(byOrder).map(({ key, label, kind, record, entity }: NavSubmodule & { order: number }) => ({ key, label, kind, record, entity })),
    });
  });

  bp.customModules.forEach((m, i) => {
    const customs = entitiesIn(m.id, 0);
    if (!customs.length) return;
    modules.push({ key: m.key, label: m.label, icon: m.icon ?? "folder", section: m.section, order: m.order ?? 500 + i, index: MODULES.length + i, submodules: customs.map(({ order: _o, index: _i, ...s }) => s) });
  });

  return SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    modules: modules.filter((m) => m.section === s.key).sort(byOrder).map(({ key, label, icon, submodules }) => ({ key, label, icon, submodules })),
  })).filter((s) => s.modules.length > 0);

  function entitiesIn(module: string, after: number) {
    return bp.entities
      .filter((e) => e.module === module)
      .map((e, i) => ({ key: e.key, label: e.labelPlural, kind: "custom" as const, entity: e.id, order: e.order ?? (after + i) * 10 + 5, index: after + i }));
  }
}

/** Find a submodule (or custom record type) by module and submodule key. */
export function findNav(sections: NavSection[], moduleKey: string, subKey?: string) {
  for (const s of sections) {
    const m = s.modules.find((x) => x.key === moduleKey);
    if (!m) continue;
    const sub = subKey ? m.submodules.find((x) => x.key === subKey) : m.submodules[0];
    return { module: m, submodule: sub };
  }
  return undefined;
}
