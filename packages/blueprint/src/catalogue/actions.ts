import { z } from "zod";

/**
 * Permission actions, the same eight SyncBooks uses. Each submodule lists only
 * the actions that apply to it, so a role editor never offers "post" on a
 * report or "file" on an invoice.
 */
export const PERM_ACTIONS = ["view", "create", "edit", "approve", "post", "void", "file", "manage"] as const;
export const PermAction = z.enum(PERM_ACTIONS);
export type PermAction = z.infer<typeof PermAction>;

export const PERM_ACTION_HINTS: Record<PermAction, string> = {
  view: "See records",
  create: "Add new records",
  edit: "Change drafts and record progress",
  approve: "Approve or release",
  post: "Post to the ledger or stock",
  void: "Void, cancel or reverse",
  file: "File a tax return",
  manage: "Full control: delete, settings and admin actions",
};

/** Common action sets. */
export const A = {
  readOnly: ["view"],
  master: ["view", "create", "edit", "manage"],
  draftOnly: ["view", "create", "edit", "approve", "void", "manage"],
  posting: ["view", "create", "edit", "approve", "post", "void", "manage"],
} as const satisfies Record<string, readonly PermAction[]>;
