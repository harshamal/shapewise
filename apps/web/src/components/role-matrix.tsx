"use client";

import { Fragment, useState } from "react";
import type { OverlayOp } from "@shapewise/blueprint";
import { cx } from "@shapewise/ui";
import { LEVELS, LEVEL_HINT, LEVEL_LABEL, addRoleOp, grantedOn, levelOf, levelOps, type Level, type PermissionModel } from "@/lib/permissions";

const TONE: Record<Level, string> = {
  none: "text-ink-faint",
  view: "text-ink-muted",
  edit: "text-ink",
  approve: "text-ink",
  full: "text-ink",
};

/**
 * Who can do what: a role per row, a module per column, each cell a level.
 * Open a module to set its screens one by one. The owner always has full
 * access. Every change goes through `onChange` as blueprint changes, so
 * the review and Settings validate it the same way.
 */
export function RoleMatrix({ model, onChange, busy, canEdit = true }: { model: PermissionModel; onChange: (ops: OverlayOp[]) => void; busy?: boolean; canEdit?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const roles = [...model.roles].sort((a, b) => Number(b.owner) - Number(a.owner));

  const moduleLevel = (role: PermissionModel["roles"][number], m: PermissionModel["modules"][number]): Level | "mixed" => {
    const levels = new Set(m.screens.map((s) => levelOf(grantedOn(role, s.target), s.actions)));
    return levels.size === 1 ? [...levels][0]! : "mixed";
  };
  const mod = open ? model.modules.find((m) => m.key === open) : undefined;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-2xl border bg-surface">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 z-10 bg-surface px-4 py-2.5 text-xs font-medium text-ink-muted">Role</th>
              {model.modules.map((m) => (
                <th key={m.key} className="px-2 py-2 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setOpen(open === m.key ? null : m.key)}
                    aria-expanded={open === m.key}
                    className={cx("rounded-md px-1.5 py-1 transition-colors hover:bg-surface-sunken", open === m.key ? "text-ink" : "text-ink-muted")}
                    title="Set screen by screen"
                  >
                    {m.label}
                    <span aria-hidden="true" className="ml-1 text-ink-faint">
                      {open === m.key ? "▴" : "▾"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <Fragment key={r.id}>
                <tr className="group border-b last:border-0">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.label}</span>
                      {r.owner && <span className="rounded-full bg-accent-soft px-1.5 text-[10px]">Owner</span>}
                      {canEdit && !r.owner && (
                        removing === r.id ? (
                          <span className="flex items-center gap-1 text-[11px]">
                            <button type="button" disabled={busy} onClick={() => (onChange([{ op: "remove", id: r.id }]), setRemoving(null))} className="text-danger-fg hover:underline">
                              Remove
                            </button>
                            <button type="button" onClick={() => setRemoving(null)} className="text-ink-faint hover:underline">
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setRemoving(r.id)} className="text-[11px] text-ink-faint opacity-0 transition-opacity hover:text-danger-fg focus:opacity-100 group-hover:opacity-100" aria-label={`Remove ${r.label}`}>
                            Remove
                          </button>
                        )
                      )}
                    </div>
                  </td>
                  {model.modules.map((m) => {
                    const lvl = r.owner ? "full" : moduleLevel(r, m);
                    return (
                      <td key={m.key} className="px-2 py-1.5">
                        {r.owner || !canEdit ? (
                          <span className={cx("px-1.5", lvl === "mixed" ? "text-ink-muted" : TONE[lvl])}>{lvl === "mixed" ? "Mixed" : LEVEL_LABEL[lvl]}</span>
                        ) : (
                          <LevelSelect
                            value={lvl}
                            disabled={busy}
                            label={`${r.label} on ${m.label}`}
                            onChange={(l) =>
                              onChange(
                                levelOps(
                                  model,
                                  r.id,
                                  m.screens.map((s) => s.target),
                                  l,
                                ),
                              )
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {mod && (
        <div className="overflow-x-auto rounded-2xl border bg-surface animate-fade">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <p className="text-sm font-medium">{mod.label}, screen by screen</p>
            <button type="button" onClick={() => setOpen(null)} className="text-xs text-ink-faint hover:text-ink">
              Close
            </button>
          </div>
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead>
              <tr className="border-b text-xs text-ink-muted">
                <th className="px-4 py-2 font-medium">Screen</th>
                {roles.map((r) => (
                  <th key={r.id} className="px-2 py-2 font-medium">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mod.screens.map((s) => (
                <tr key={s.target} className="border-b last:border-0">
                  <td className="px-4 py-1.5">{s.label}</td>
                  {roles.map((r) => {
                    const lvl = r.owner ? "full" : levelOf(grantedOn(r, s.target), s.actions);
                    return (
                      <td key={r.id} className="px-2 py-1">
                        {r.owner || !canEdit ? (
                          <span className={cx("px-1.5", TONE[lvl])}>{LEVEL_LABEL[lvl]}</span>
                        ) : (
                          <LevelSelect value={lvl} disabled={busy} label={`${r.label} on ${s.label}`} onChange={(l) => onChange(levelOps(model, r.id, [s.target], l))} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canEdit &&
          (adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim().length < 2) return;
                onChange([addRoleOp(name)]);
                setName("");
                setAdding(false);
              }}
              className="flex items-center gap-2"
            >
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Delivery driver" aria-label="New role name" className="h-8 w-48 rounded-sw border border-border-strong bg-surface px-2.5 text-sm outline-none focus:border-focus" />
              <button type="submit" disabled={busy || name.trim().length < 2} className="h-8 rounded-full bg-ink px-3 text-xs text-canvas disabled:opacity-50">
                Add role
              </button>
              <button type="button" onClick={() => setAdding(false)} className="text-xs text-ink-faint hover:text-ink">
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="rounded-full border border-dashed border-border-strong px-3 py-1 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink">
              + Add a role
            </button>
          ))}
        <p className="text-xs text-ink-faint">
          {LEVELS.filter((l) => l !== "none")
            .map((l) => `${LEVEL_LABEL[l]}: ${LEVEL_HINT[l].toLowerCase()}`)
            .join(" · ")}
        </p>
      </div>
    </div>
  );
}

function LevelSelect({ value, onChange, disabled, label }: { value: Level | "mixed"; onChange: (l: Level) => void; disabled?: boolean; label: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Level)}
      className={cx(
        "h-7 rounded-md border border-transparent bg-transparent px-1 text-[13px] outline-none transition-colors hover:border-border-strong focus:border-focus",
        value === "mixed" ? "text-ink-muted" : TONE[value],
      )}
    >
      {value === "mixed" && <option value="mixed">Mixed</option>}
      {LEVELS.map((l) => (
        <option key={l} value={l} title={LEVEL_HINT[l]}>
          {LEVEL_LABEL[l]}
        </option>
      ))}
    </select>
  );
}
