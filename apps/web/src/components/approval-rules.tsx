"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ApprovalDraft } from "@shapewise/ai";
import { Button, cx } from "@shapewise/ui";
import { changeSettings, draftApprovalRule } from "@/app/w/[tenant]/actions";
import { approvalOps, money, type ApprovalRuleInput } from "@/lib/approval-ops";
import type { SettingsData } from "@/lib/settings-data";

type Rule = SettingsData["approvals"][number];

const EXAMPLES = ["Purchase orders over Rs 500,000 need the owner", "Payments over Rs 1 million need the accountant, then the owner", "Credit notes always need the manager"];

/**
 * Approval rules: which action on which screen waits for whom, from what
 * amount. Describe one in plain words and the AI drafts it for you to
 * confirm, or set it up by hand. Every change goes through the same
 * validated settings path as the rest of Settings.
 */
export function ApprovalRules({ data }: { data: SettingsData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [editing, setEditing] = useState<{ rule: ApprovalRuleInput; replace?: string } | null>(null);
  const c = data.approvalChoices;

  const apply = (ops: Parameters<typeof changeSettings>[1], done?: () => void) =>
    start(async () => {
      const r = await changeSettings(data.tenant, ops);
      setStatus({ ok: r.ok, message: r.ok ? "Saved." : (r.message ?? "Not saved.") });
      if (r.ok) done?.();
      router.refresh();
    });

  const blank = (): ApprovalRuleInput => {
    const t = c.targets.find((x) => x.target === "purchase_order") ?? c.targets[0]!;
    const owner = c.roles[0]!;
    return { label: "", target: t.target, action: t.actions[0]!.key, stages: [{ name: owner.label, minAmount: 0, roles: [owner.id], requireAll: false }] };
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h4 className="text-sm font-medium">Screens that need approval</h4>
        <p className="text-xs text-ink-muted">Switch on a screen and the owner approves every one. Then refine it below with amounts and other approvers.</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {c.targets.map((t) => {
            const step = t.actions.find((x) => x.key !== "create");
            const rules = data.approvals.filter((a) => a.target === t.target);
            const on = rules.some((r) => r.enabled);
            return (
              <li key={t.target} className="flex items-center gap-2 rounded-sw border bg-surface px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {t.label}
                  {step && <span className="text-xs text-ink-faint"> · before {step.label.toLowerCase()}</span>}
                </span>
                {rules.length > 1 && <span className="text-[11px] text-ink-faint">{rules.length} rules</span>}
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${t.label} needs approval`}
                  disabled={!data.canManage || pending || !step}
                  onClick={() => {
                    const owner = c.roles.find((r) => data.permissions.roles.find((x) => x.id === r.id)?.owner) ?? c.roles[0]!;
                    apply(
                      on
                        ? rules.map((r) => ({ op: "remove" as const, id: r.id }))
                        : approvalOps({ label: `${t.label} approval`, target: t.target, action: step!.key, stages: [{ name: owner.label, minAmount: 0, roles: [owner.id], requireAll: false }] }),
                    );
                  }}
                  className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50", on ? "bg-accent" : "bg-border-strong")}
                >
                  <span className={cx("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-200", on && "translate-x-4")} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {data.canManage && <Describe data={data} disabled={pending} onConfirm={(ops) => apply(ops)} onEdit={(rule) => setEditing({ rule })} />}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Rules</h4>
          {data.canManage && !editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing({ rule: blank() })}>
              Add by hand
            </Button>
          )}
        </div>
        {editing && (
          <Editor
            data={data}
            initial={editing.rule}
            busy={pending}
            onCancel={() => setEditing(null)}
            onSave={(rule) => apply(approvalOps(rule, editing.replace), () => setEditing(null))}
          />
        )}
        {data.approvals.length === 0 && !editing ? (
          <p className="rounded-sw border border-dashed px-4 py-6 text-center text-sm text-ink-muted">Nothing needs approval yet. Describe a rule above, or add one by hand.</p>
        ) : (
          <ul className="space-y-2">
            {data.approvals.map((a) => (
              <RuleCard
                key={a.id}
                rule={a}
                currency={c.currency}
                canManage={data.canManage}
                busy={pending}
                onToggle={(on) => apply([{ op: "update", id: a.id, patch: { enabled: on } }])}
                onRemove={() => apply([{ op: "remove", id: a.id }])}
                onEdit={() => setEditing({ rule: { label: a.label, target: a.target, action: a.action, stages: a.stages.map((s) => ({ name: s.name, minAmount: s.minAmount, roles: s.roleIds, requireAll: s.requireAll })) }, replace: a.id })}
              />
            ))}
          </ul>
        )}
      </section>
      {status && (
        <p role={status.ok ? "status" : "alert"} className={cx("rounded-sw px-3 py-2 text-sm", status.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>
          {status.message}
        </p>
      )}
    </div>
  );
}

function sentence(r: { label?: string; stages: { minAmount: number; roles: string[]; requireAll: boolean }[] }, roleLabel: (id: string) => string, currency: string, hasAmount: boolean) {
  return r.stages
    .map((s, i) => {
      const who = s.roles.map(roleLabel).join(s.requireAll ? " and " : " or ");
      const from = hasAmount && s.minAmount > 0 ? `from ${money(s.minAmount, currency)}` : i === 0 ? "always" : "";
      return `${who}${from ? ` ${from}` : ""}`;
    })
    .join(", then ");
}

/** Describe a rule; the AI drafts it; the person confirms. */
function Describe({ data, disabled, onConfirm, onEdit }: { data: SettingsData; disabled: boolean; onConfirm: (ops: NonNullable<Awaited<ReturnType<typeof draftApprovalRule>>["ops"]>) => void; onEdit: (r: ApprovalRuleInput) => void }) {
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof draftApprovalRule>> | null>(null);
  const c = data.approvalChoices;
  const roleLabel = (id: string) => c.roles.find((r) => r.id === id)?.label ?? id;
  const ask = (t = text) => {
    if (t.trim().length < 3) return;
    setResult(null);
    start(async () => setResult(await draftApprovalRule(data.tenant, t)));
  };
  const d: ApprovalDraft | undefined = result?.draft;
  const target = d && c.targets.find((t) => t.target === d.target);

  return (
    <section className="space-y-3 rounded-xl border bg-surface p-4">
      <div>
        <h4 className="text-sm font-medium">Describe a rule</h4>
        <p className="mt-0.5 text-xs text-ink-muted">Say which screen, when, and who signs. The AI sets it up and shows it to you before anything changes.</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
        className="flex gap-2"
      >
        <input
          aria-label="Describe an approval rule"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Purchase orders over Rs 500,000 need the owner"
          className="h-9 min-w-0 flex-1 rounded-sw border border-border-strong bg-surface px-3 text-sm outline-none focus:border-focus"
        />
        <Button type="submit" variant="primary" disabled={busy || disabled || text.trim().length < 3}>
          {busy ? "Drafting…" : "Draft it"}
        </Button>
      </form>
      {!result && !busy && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setText(e);
                ask(e);
              }}
              className="rounded-full border border-border-strong px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
            >
              {e}
            </button>
          ))}
        </div>
      )}
      {busy && <p className="animate-shimmer text-sm">Working out the rule</p>}
      {result && !result.ok && <p className="text-sm text-danger-fg">{result.message}</p>}
      {result?.question && <p className="rounded-sw bg-surface-sunken px-3 py-2 text-sm">{result.question}</p>}
      {d && target && result?.ops && (
        <div className="rounded-xl border border-accent/40 bg-accent-soft p-3.5 animate-pop">
          <p className="text-[11px] tracking-[0.06em] text-ink-muted uppercase">
            {target.label} · {target.actions.find((a) => a.key === d.action)?.label ?? d.action}
          </p>
          <p className="mt-0.5 text-sm font-medium">{d.label}</p>
          <p className="mt-1 text-sm">{sentence(d, roleLabel, c.currency, target.hasAmount)}</p>
          {d.summary && <p className="mt-1 text-xs text-ink-muted">{d.summary}</p>}
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={disabled}
              onClick={() => {
                onConfirm(result.ops!);
                setResult(null);
                setText("");
              }}
            >
              Add this rule
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onEdit({ label: d.label, target: d.target, action: d.action, stages: d.stages });
                setResult(null);
              }}
            >
              Adjust
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function RuleCard({ rule: a, currency, canManage, busy, onToggle, onRemove, onEdit }: { rule: Rule; currency: string; canManage: boolean; busy: boolean; onToggle: (on: boolean) => void; onRemove: () => void; onEdit: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={cx("rounded-sw border bg-surface px-4 py-3 text-sm transition-opacity", !a.enabled && "opacity-60")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{a.label}</p>
          <p className="text-ink-muted">
            {a.record} · when someone tries to {a.actionLabel.toLowerCase()}
            {a.channels && ` · only from ${a.channels.join(", ")}`}
            {a.when && (
              <>
                {" "}
                · if <code className="text-[13px]">{a.when}</code>
              </>
            )}
          </p>
          <ol className="mt-2 flex flex-wrap items-center gap-1.5">
            {a.stages.map((s, i) => (
              <li key={s.id} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-xs text-ink-faint">then</span>}
                <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs">
                  {s.roles.join(s.requireAll ? " and " : " or ")}
                  {s.minAmount > 0 ? ` from ${money(s.minAmount, currency)}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
        {canManage && (
          <label className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" checked={a.enabled} disabled={busy} onChange={(e) => onToggle(e.target.checked)} className="size-4 accent-[var(--sw-accent)]" />
            On
          </label>
        )}
      </div>
      {canManage && (
        <div className="mt-2 flex gap-1">
          <button type="button" onClick={onEdit} disabled={busy} className="h-7 rounded-md px-2 text-xs text-ink-muted hover:bg-surface-sunken hover:text-ink">
            Edit
          </button>
          {confirming ? (
            <>
              <button type="button" onClick={onRemove} disabled={busy} className="h-7 rounded-md px-2 text-xs text-danger-fg hover:bg-danger-bg">
                Remove this rule
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="h-7 rounded-md px-2 text-xs text-ink-muted hover:bg-surface-sunken">
                Keep it
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} disabled={busy} className="h-7 rounded-md px-2 text-xs text-ink-muted hover:bg-surface-sunken hover:text-ink">
              Remove
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Set a rule up by hand: screen, action, then stages by amount with who signs. */
function Editor({ data, initial, busy, onCancel, onSave }: { data: SettingsData; initial: ApprovalRuleInput; busy: boolean; onCancel: () => void; onSave: (r: ApprovalRuleInput) => void }) {
  const c = data.approvalChoices;
  const [rule, setRule] = useState<ApprovalRuleInput>(initial);
  const target = c.targets.find((t) => t.target === rule.target) ?? c.targets[0]!;
  const setStage = (i: number, patch: Partial<ApprovalRuleInput["stages"][number]>) => setRule((r) => ({ ...r, stages: r.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const valid = rule.stages.length > 0 && rule.stages.every((s) => s.roles.length > 0);
  const field = "h-9 w-full rounded-sw border border-border-strong bg-surface px-2.5 text-sm outline-none focus:border-focus";

  return (
    <div className="space-y-4 rounded-xl border bg-surface p-4 animate-fade">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-ink-muted">
          Name
          <input value={rule.label} onChange={(e) => setRule({ ...rule, label: e.target.value })} placeholder="e.g. Large purchase orders" className={cx(field, "mt-1")} />
        </label>
        <label className="block text-xs text-ink-muted">
          Screen
          <select
            value={rule.target}
            onChange={(e) => {
              const t = c.targets.find((x) => x.target === e.target.value)!;
              setRule({ ...rule, target: t.target, action: t.actions[0]!.key, stages: rule.stages.map((s) => ({ ...s, minAmount: t.hasAmount ? s.minAmount : 0 })) });
            }}
            className={cx(field, "mt-1")}
          >
            {c.targets.map((t) => (
              <option key={t.target} value={t.target}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-ink-muted">
          When someone tries to
          <select value={rule.action} onChange={(e) => setRule({ ...rule, action: e.target.value })} className={cx(field, "mt-1")}>
            {target.actions.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ol className="space-y-2">
        {rule.stages.map((s, i) => (
          <li key={i} className="rounded-lg border bg-canvas p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs text-ink-muted">{i === 0 ? "First" : "Then"}</span>
              {target.hasAmount ? (
                <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                  from
                  <input
                    inputMode="decimal"
                    value={s.minAmount ? String(s.minAmount) : ""}
                    placeholder="0 (always)"
                    onChange={(e) => setStage(i, { minAmount: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })}
                    className="h-8 w-32 rounded-sw border border-border-strong bg-surface px-2 text-sm tabular outline-none focus:border-focus"
                  />
                  {data.approvalChoices.currency}
                </label>
              ) : (
                <span className="text-xs text-ink-faint">every time ({target.label.toLowerCase()} have no amount)</span>
              )}
              {rule.stages.length > 1 && (
                <button type="button" onClick={() => setRule({ ...rule, stages: rule.stages.filter((_, j) => j !== i) })} className="ml-auto text-xs text-ink-faint hover:text-danger-fg">
                  Remove stage
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Who approves">
              {c.roles.map((r) => {
                const on = s.roles.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setStage(i, { roles: on ? s.roles.filter((x) => x !== r.id) : [...s.roles, r.id], name: s.name || r.label })}
                    className={cx("h-7 rounded-full border px-2.5 text-xs transition-colors", on ? "border-accent bg-accent-soft text-ink" : "border-border-strong text-ink-muted hover:text-ink")}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            {s.roles.length > 1 && (
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                <input type="checkbox" checked={s.requireAll} onChange={(e) => setStage(i, { requireAll: e.target.checked })} className="size-3.5 accent-[var(--sw-accent)]" />
                One person from each role must approve
              </label>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {rule.stages.length < 5 && (
          <Button size="sm" variant="ghost" onClick={() => setRule({ ...rule, stages: [...rule.stages, { name: "", minAmount: (rule.stages.at(-1)?.minAmount ?? 0) * 4 || 0, roles: [], requireAll: false }] })}>
            Add a higher level
          </Button>
        )}
        <span className="ml-auto" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !valid}
          onClick={() =>
            onSave({
              ...rule,
              label: rule.label.trim() || `${target.label} ${target.actions.find((a) => a.key === rule.action)?.label.toLowerCase() ?? ""}`.trim(),
              stages: rule.stages.map((st) => ({ ...st, name: st.name || st.roles.map((id) => c.roles.find((r) => r.id === id)?.label ?? "").join(" or ") })),
            })
          }
        >
          Save rule
        </Button>
      </div>
    </div>
  );
}
