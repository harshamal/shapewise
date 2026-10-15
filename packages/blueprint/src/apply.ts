import { EXTENSION_BY_KEY, withRequirements, type ExtensionKey } from "./catalogue/extensions";
import { MODULE_BY_KEY, SUBMODULE_BY_KEY } from "./catalogue/modules";
import type { OverlayOp } from "./overlay";
import type { Blueprint, BlueprintInput } from "./schema";
import { validateBlueprint, type Issue } from "./validate";

/**
 * Applies overlay ops to a blueprint and validates the result. Nothing is
 * changed unless the whole set is valid, so a change either lands complete
 * or is refused with the reasons.
 *
 * Covers catalogue configuration (modules, submodules, extensions, settings,
 * business, grants). Element ops (add/update/remove/move) follow with the
 * change studio.
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
        role.grants = role.grants.filter((g) => g.target !== op.target);
        if (op.actions.length) role.grants.push({ target: op.target, actions: [...op.actions], scope: op.scope ?? "all" });
        summary.push(`Changed ${role.label}'s access to ${SUBMODULE_BY_KEY.get(op.target)?.label ?? op.target}`);
        break;
      }
      default:
        return fail(`"${op.op}" changes arrive with the change studio.`);
    }
  }

  bp.version = current.version + 1;
  const result = validateBlueprint(bp);
  if (!result.ok || !result.blueprint) return { ok: false, issues: result.issues.filter((i) => i.severity === "error") };
  return { ok: true, blueprint: result.blueprint, summary };
}
