import { EXTENSION_BY_KEY, withRequirements, type ExtensionKey } from "./catalogue/extensions";
import { MODULE_BY_KEY, SUBMODULE_BY_KEY } from "./catalogue/modules";
import { REPORT_BY_KEY } from "./catalogue/reports";
import type { OverlayOp } from "./overlay";
import type { Blueprint, BlueprintInput } from "./schema";
import { validateBlueprint, type Issue } from "./validate";

/**
 * Applies overlay ops to a blueprint and validates the result. Nothing is
 * changed unless the whole set is valid, so a change either lands complete
 * or is refused with the reasons.
 *
 * Covers catalogue configuration (modules, submodules, extensions, settings,
 * business, grants) and element ops (add/update/remove/move) on approvals,
 * their stages, rules and views. Records, fields and workflows follow with
 * the change studio.
 */
export type ApplyResult = { ok: true; blueprint: Blueprint; summary: string[] } | { ok: false; issues: Issue[] };

export function applyOps(current: Blueprint, ops: readonly OverlayOp[]): ApplyResult {
  const bp = structuredClone(current) as BlueprintInput & Blueprint;
  const summary: string[] = [];
  const fail = (message: string, path: Issue["path"] = []): ApplyResult => ({ ok: false, issues: [{ path, message, severity: "error" }] });

  for (const op of ops) {
    switch (op.op) {
      case "set_extension": {
        const ext = EXTENSION_BY_KEY[op.key];
        if (op.enabled) {
          const missing = ext.needsModules.filter((m) => !bp.modules.some((x) => x.key === m && x.enabled));
          if (missing.length) return fail(`"${ext.name}" needs the ${missing.map((m) => MODULE_BY_KEY.get(m)?.label ?? m).join(" and ")} module.`, ["extensions"]);
          const add = withRequirements([op.key]).filter((k) => !bp.extensions.includes(k));
          bp.extensions = [...bp.extensions, ...add];
          summary.push(`Switched on ${add.map((k) => EXTENSION_BY_KEY[k].name).join(", ")}`);
        } else {
          // Switching off also switches off anything that needs it.
          const off = new Set<ExtensionKey>([op.key]);
          for (let grew = true; grew; ) {
            grew = false;
            for (const k of bp.extensions) if (!off.has(k) && EXTENSION_BY_KEY[k].requires.some((r) => off.has(r))) (off.add(k), (grew = true));
          }
          bp.extensions = bp.extensions.filter((k) => !off.has(k));
          summary.push(`Switched off ${[...off].map((k) => EXTENSION_BY_KEY[k].name).join(", ")}`);
        }
        break;
      }
      case "set_setting": {
        const [group, key] = op.path.split(".") as [string, string];
        const settings = bp.settings as unknown as Record<string, Record<string, unknown>>;
        if (!(group in settings)) return fail(`Unknown settings group "${group}".`, ["settings", group]);
        settings[group] = { ...settings[group], [key]: op.value };
        summary.push(`Set ${group} › ${key}`);
        break;
      }
      case "set_business":
        bp.business = { ...bp.business, ...(op.patch as Partial<Blueprint["business"]>) };
        summary.push("Updated organisation details");
        break;
      case "set_module": {
        const cat = MODULE_BY_KEY.get(op.key);
        if (!cat) return fail(`Unknown module "${op.key}".`, ["modules"]);
        let m = bp.modules.find((x) => x.key === op.key);
        if (!m) bp.modules.push((m = { key: op.key, enabled: true, submodules: [] }));
        if (op.enabled !== undefined) m.enabled = op.enabled;
        if (op.label !== undefined) m.label = op.label ?? undefined;
        if (op.order !== undefined) m.order = op.order;
        if (op.enabled === false) {
          // Extensions that need the module go with it.
          bp.extensions = bp.extensions.filter((k) => !EXTENSION_BY_KEY[k].needsModules.includes(op.key));
        }
        summary.push(`${op.enabled === false ? "Switched off" : "Updated"} ${cat.label}`);
        break;
      }
      case "set_submodule": {
        const sub = SUBMODULE_BY_KEY.get(op.key);
        if (!sub) return fail(`Unknown submodule "${op.key}".`, ["modules"]);
        let m = bp.modules.find((x) => x.key === sub.module);
        if (!m) bp.modules.push((m = { key: sub.module, enabled: true, submodules: [] }));
        const subs = (m.submodules ??= []);
        let s = subs.find((x) => x.key === op.key);
        if (!s) subs.push((s = { key: op.key }));
        if (op.enabled !== undefined) s.enabled = op.enabled;
        if (op.label !== undefined) s.label = op.label ?? undefined;
        if (op.order !== undefined) s.order = op.order;
        summary.push(`${op.enabled === false ? "Hid" : op.enabled ? "Showed" : "Updated"} ${sub.label}`);
        break;
      }
      case "set_grant": {
        const role = bp.roles.find((r) => r.id === op.role);
        if (!role) return fail(`Unknown role "${op.role}".`, ["roles"]);
        if (role.owner) return fail("The owner always has full access.", ["roles"]);
        role.grants = role.grants.filter((g) => g.target !== op.target);
        if (op.actions.length) role.grants.push({ target: op.target, actions: [...op.actions], scope: op.scope ?? "all" });
        summary.push(`Changed ${role.label}'s access to ${SUBMODULE_BY_KEY.get(op.target)?.label ?? op.target}`);
        break;
      }
      case "set_report": {
        const reports = (bp.reports ??= []) as { key: string; places: string[]; roles?: string[] }[];
        const i = reports.findIndex((r) => r.key === op.key);
        if (!op.places.length) {
          if (i >= 0) reports.splice(i, 1);
          summary.push(`Unpinned ${REPORT_BY_KEY.get(op.key)?.label ?? op.key}`);
          break;
        }
        const value = { key: op.key, places: [...new Set(op.places)], roles: op.roles };
        if (i >= 0) reports[i] = value;
        else reports.push(value);
        summary.push(`Placed ${REPORT_BY_KEY.get(op.key)?.label ?? op.key}`);
        break;
      }
      case "add": {
        if (op.collection === "approvalStages") {
          const parent = bp.approvals.find((a) => a.id === op.parent);
          if (!parent) return fail(`Unknown approval "${op.parent}".`, ["approvals"]);
          insert(parent.stages as unknown as Element[], op.value as Element, op.after);
          summary.push(`Added a stage to ${parent.label}`);
          break;
        }
        if (!ELEMENT_COLLECTIONS.has(op.collection)) return fail(`"${op.collection}" changes arrive with the change studio.`, [op.collection]);
        const list = ((bp as unknown as Record<string, Element[] | undefined>)[op.collection] ??= []);
        const value = op.value as Element;
        if (typeof value.id !== "string") return fail("A new element needs an id.", [op.collection]);
        if (findElement(bp, value.id)) return fail(`"${value.id}" already exists.`, [op.collection]);
        insert(list, value, op.after);
        summary.push(`Added ${String(value.label ?? value.name ?? value.id)}`);
        break;
      }
      case "update": {
        const hit = findElement(bp, op.id);
        if (!hit) return fail(`Nothing with id "${op.id}".`);
        const { id: _ignored, ...patch } = op.patch;
        Object.assign(hit.element, patch);
        summary.push(`Changed ${String(hit.element.label ?? hit.element.name ?? op.id)}`);
        break;
      }
      case "remove": {
        const hit = findElement(bp, op.id);
        if (!hit) return fail(`Nothing with id "${op.id}".`);
        hit.list.splice(hit.list.indexOf(hit.element), 1);
        summary.push(`Removed ${String(hit.element.label ?? hit.element.name ?? op.id)}`);
        break;
      }
      case "move": {
        const hit = findElement(bp, op.id);
        if (!hit) return fail(`Nothing with id "${op.id}".`);
        hit.list.splice(hit.list.indexOf(hit.element), 1);
        insert(hit.list, hit.element, op.after ?? undefined, op.after === null);
        summary.push(`Moved ${String(hit.element.label ?? hit.element.name ?? op.id)}`);
        break;
      }
      default:
        return fail(`"${op.op}" changes arrive with the change studio.`);
    }
  }

  bp.version = current.version + 1;
  const result = validateBlueprint(bp);
  if (!result.ok || !result.blueprint) return { ok: false, issues: result.issues.filter((i) => i.severity === "error") };
  return { ok: true, blueprint: result.blueprint, summary: compact(summary) };
}

/** "Changed Sales's access to Quotes; ...to Invoices; ..." becomes "Changed Sales's access to 9 screens". */
function compact(summary: string[]): string[] {
  const out: string[] = [];
  const grants = new Map<string, number>();
  for (const line of summary) {
    const m = /^(Changed .+'s access to) /.exec(line);
    if (m) grants.set(m[1]!, (grants.get(m[1]!) ?? 0) + 1);
    else out.push(line);
  }
  for (const [prefix, n] of grants) out.push(n === 1 ? summary.find((l) => l.startsWith(prefix))! : `${prefix} ${n} screens`);
  return out;
}

type Element = Record<string, unknown> & { id: string };

/**
 * Top level collections whose elements carry their own id and can be added,
 * changed and removed directly. Records, fields and workflows need the
 * change studio, which checks the data that already uses them.
 */
const ELEMENT_COLLECTIONS = new Set(["approvals", "rules", "views", "roles", "dashboard"]);

/** Finds an element by id in the editable collections, including approval stages. */
function findElement(bp: Blueprint, id: string): { list: Element[]; element: Element } | undefined {
  const root = bp as unknown as Record<string, Element[] | undefined>;
  for (const c of ELEMENT_COLLECTIONS) {
    const list = root[c] ?? [];
    const element = list.find((e) => e.id === id);
    if (element) return { list, element };
  }
  for (const a of bp.approvals) {
    const list = a.stages as unknown as Element[];
    const element = list.find((s) => s.id === id);
    if (element) return { list, element };
  }
  return undefined;
}

function insert(list: Element[], value: Element, after?: string, first = false) {
  if (first) return void list.unshift(value);
  const i = after ? list.findIndex((e) => e.id === after) : -1;
  if (i >= 0) list.splice(i + 1, 0, value);
  else list.push(value);
}
