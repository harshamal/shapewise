import { SUBMODULE_BY_KEY, navigation, type Blueprint, type OverlayOp, type PermAction } from "@shapewise/blueprint";

/**
 * Role permissions as levels an owner understands (None, View, Edit,
 * Approve, Full), mapped onto the actions each screen actually has. Browser
 * safe: the review edits a draft blueprint, Settings sends the same changes
 * to the server.
 */

export const LEVELS = ["none", "view", "edit", "approve", "full"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABEL: Record<Level, string> = { none: "None", view: "View", edit: "Edit", approve: "Approve", full: "Full" };
export const LEVEL_HINT: Record<Level, string> = {
  none: "Can't open it",
  view: "Can look, can't change",
  edit: "Can add and change drafts",
  approve: "Can also approve, post and file",
  full: "Everything, including voiding and setup",
};

const WANT: Record<Exclude<Level, "full">, readonly PermAction[]> = {
  none: [],
  view: ["view"],
  edit: ["view", "create", "edit"],
  approve: ["view", "create", "edit", "approve", "post", "file"],
};

/** The actions a level grants on a screen that has these actions. */
export function actionsFor(level: Level, available: readonly PermAction[]): PermAction[] {
  return level === "full" ? [...available] : available.filter((a) => WANT[level].includes(a));
}

/** The highest level whose actions the role fully has on this screen. */
export function levelOf(granted: ReadonlySet<PermAction>, available: readonly PermAction[]): Level {
  let best: Level = "none";
  let size = 0;
  for (const l of LEVELS) {
    const need = actionsFor(l, available);
    // A level only counts as higher when it grants more here (on a read-only screen, Full is just View).
    if (need.length > size && need.every((a) => granted.has(a))) (best = l), (size = need.length);
  }
  return best;
}

export interface PermissionScreen {
  /** Grant target: a submodule key, or a custom record type id. */
  target: string;
  label: string;
  actions: PermAction[];
}

export interface PermissionModel {
  roles: { id: string; label: string; owner: boolean; description?: string; grants: { target: string; actions: PermAction[] }[] }[];
  modules: { key: string; label: string; screens: PermissionScreen[] }[];
}

const ENTITY_ACTIONS: PermAction[] = ["view", "create", "edit", "approve", "void", "manage"];

export function permissionModel(bp: Blueprint): PermissionModel {
  const modules = navigation(bp)
    .flatMap((s) => s.modules)
    .filter((m) => m.key !== "settings")
    .map((m) => ({
      key: m.key,
      label: m.label,
      screens: m.submodules.map((s) => ({ target: s.entity ?? s.key, label: s.label, actions: s.entity ? ENTITY_ACTIONS : [...(SUBMODULE_BY_KEY.get(s.key)?.actions ?? ["view"])] })),
    }))
    .filter((m) => m.screens.length);
  return {
    roles: bp.roles.map((r) => ({ id: r.id, label: r.label, owner: Boolean(r.owner), description: r.description, grants: r.grants.map((g) => ({ target: g.target, actions: [...g.actions] })) })),
    modules,
  };
}

/** What a role has on one screen, counting an "everything" grant. */
export function grantedOn(role: PermissionModel["roles"][number], target: string): Set<PermAction> {
  const all = role.grants.find((g) => g.target === "*");
  return new Set([...(all?.actions ?? []), ...(role.grants.find((g) => g.target === target)?.actions ?? [])]);
}

/**
 * The changes that give a role a level on some screens. A role that had
 * "everything" is first spelled out screen by screen, so lowering one screen
 * doesn't lower the rest.
 */
export function levelOps(model: PermissionModel, roleId: string, targets: readonly string[], level: Level): OverlayOp[] {
  const role = model.roles.find((r) => r.id === roleId);
  if (!role || role.owner) return [];
  const screens = model.modules.flatMap((m) => m.screens);
  const ops: OverlayOp[] = [];
  const star = role.grants.find((g) => g.target === "*");
  if (star) {
    ops.push({ op: "set_grant", role: roleId, target: "*", actions: [] });
    for (const s of screens) if (!targets.includes(s.target)) ops.push({ op: "set_grant", role: roleId, target: s.target, actions: s.actions.filter((a) => grantedOn(role, s.target).has(a)) });
  }
  for (const t of targets) {
    const s = screens.find((x) => x.target === t);
    if (s) ops.push({ op: "set_grant", role: roleId, target: t, actions: actionsFor(level, s.actions) });
  }
  return ops;
}

/** A new role with no access yet. */
export function addRoleOp(label: string): OverlayOp {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "role";
  return { op: "add", collection: "roles", value: { id: `rol_${key.replace(/_/g, "").slice(0, 14)}${Math.random().toString(36).slice(2, 6)}`, key: /^[a-z]/.test(key) ? key : `r_${key}`, label: label.trim().slice(0, 60), grants: [] } };
}
