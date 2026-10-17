"use client";

import { useState } from "react";
import { COUNTRIES, SIZE_LABEL, TEAM_SIZES, TURNOVER_BANDS } from "@shapewise/blueprint";
import { FIELD_LABEL, LIST_FIELDS, SECTIONS, derive, displayValue, progress, type BusinessProfile } from "@shapewise/ai/client";
import { cx } from "@shapewise/ui";

type Key = keyof BusinessProfile;

/** Chosen from the app's own questions; changed on the review screen, not as text. */
const FIXED = new Set<Key>(["reports", "reportPlaces"]);

const filled = (p: BusinessProfile, k: Key) => {
  const v = p[k];
  return Array.isArray(v) ? v.length > 0 || (k === "taxRegistrations" && Boolean(p.taxConfirmed)) : v !== undefined && v !== "";
};

/** The sections with how far each has got, as a vertical rail. */
export function ProgressRail({ profile, current }: { profile: BusinessProfile; current?: string }) {
  const sections = progress(profile);
  const done = sections.reduce((n, s) => n + s.done, 0);
  const total = sections.reduce((n, s) => n + s.total, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <nav aria-label="Interview progress" className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-muted">Progress</span>
          <span className="tabular text-ink-faint">{pct}%</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-sunken">
          <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ol className="relative space-y-1">
        {sections.map((s) => {
          const complete = s.done >= s.total;
          const active = s.key === current;
          return (
            <li key={s.key} className={cx("flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors", active && "bg-surface-sunken")}>
              <span
                aria-hidden="true"
                className={cx(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] transition-colors duration-300",
                  complete ? "border-accent bg-accent text-accent-ink" : active ? "border-ink text-ink" : "border-border-strong text-ink-faint",
                )}
              >
                {complete ? (
                  <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m2.5 6.5 2.2 2.2L9.5 3.8" />
                  </svg>
                ) : active ? (
                  <span className="size-1.5 rounded-full bg-ink" />
                ) : null}
              </span>
              <span className={cx("flex-1", complete || active ? "text-ink" : "text-ink-muted")}>{s.label}</span>
              <span className="tabular text-xs text-ink-faint">
                {s.done}/{s.total}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** What code has worked out from the facts: size class and taxes, with reasons. */
export function DerivedCard({ profile }: { profile: BusinessProfile }) {
  if (!profile.country) return null;
  const d = derive(profile);
  const confirmed = Boolean(profile.taxConfirmed || profile.taxRegistrations?.length);
  const t = d.tax.settings;
  const on = [t.vatRegistered && "VAT", t.ssclRegistered && "SSCL", t.wht && "WHT"].filter(Boolean) as string[];
  return (
    <section className="rounded-2xl border bg-surface p-4 animate-rise">
      <h3 className="text-[11px] tracking-[0.08em] text-ink-faint uppercase">Worked out for you</h3>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-ink-muted">Size</dt>
          <dd className="mt-0.5">{d.size ? `${SIZE_LABEL[d.size]} business` : "Not yet"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Taxes{confirmed ? "" : " (likely)"}</dt>
          <dd className="mt-0.5 flex flex-wrap gap-1">
            {on.length ? (
              on.map((x) => (
                <span key={x} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-ink">
                  {x}
                </span>
              ))
            ) : (
              <span>None</span>
            )}
          </dd>
        </div>
      </dl>
      {(d.tax.warnings.length > 0 || d.tax.reasons.length > 0) && (
        <ul className="mt-3 space-y-1 border-t pt-3 text-xs leading-relaxed">
          {d.tax.warnings.map((w) => (
            <li key={w} className="text-warning-fg">
              {w}
            </li>
          ))}
          {d.tax.reasons.slice(0, 3).map((r) => (
            <li key={r} className="text-ink-muted">
              {r}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-ink-faint">Based on the 2026 rules. Confirm with your accountant.</p>
    </section>
  );
}

/**
 * Everything learned so far, by section. Any value can be corrected in
 * place; the next question takes the change into account.
 */
export function ProfilePanel({ profile, onChange }: { profile: BusinessProfile; onChange: (p: BusinessProfile) => void }) {
  const [editing, setEditing] = useState<Key | null>(null);
  const sections = SECTIONS.filter((s) => s.key !== "making" || profile.makesThings !== false);
  const anything = (Object.keys(profile) as Key[]).some((k) => filled(profile, k));

  return (
    <div className="space-y-4">
      <DerivedCard profile={profile} />
      {!anything ? (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-ink-faint">What you tell me shows up here, and you can change any of it.</p>
      ) : (
        sections.map((s) => {
          const keys = s.fields.filter((k) => filled(profile, k) || editing === k);
          const missing = s.needs.filter((k) => k !== "taxConfirmed" && !filled(profile, k) && !keys.includes(k));
          if (!keys.length && !missing.length) return null;
          if (!keys.length && s.key !== "basics") return null;
          return (
            <section key={s.key} className="rounded-2xl border bg-surface animate-rise">
              <h3 className="border-b px-4 py-2.5 text-[11px] tracking-[0.08em] text-ink-faint uppercase">{s.label}</h3>
              <dl className="divide-y">
                {keys.map((k) =>
                  editing === k ? (
                    <Editor key={k} field={k} profile={profile} onDone={(p) => (p && onChange(p), setEditing(null))} />
                  ) : (
                    <button key={k} type="button" onClick={() => !FIXED.has(k) && setEditing(k)} className="group block w-full px-4 py-2.5 text-left transition-colors hover:bg-surface-sunken/60">
                      <dt className="flex items-center justify-between text-xs text-ink-muted">
                        {FIELD_LABEL[k]}
                        <span className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100">{FIXED.has(k) ? "Change in the review" : "Edit"}</span>
                      </dt>
                      <dd className="mt-0.5 text-sm leading-relaxed text-ink">{displayValue(profile, k)}</dd>
                    </button>
                  ),
                )}
              </dl>
            </section>
          );
        })
      )}
    </div>
  );
}

function Editor({ field, profile, onDone }: { field: Key; profile: BusinessProfile; onDone: (p?: BusinessProfile) => void }) {
  const isList = (LIST_FIELDS as Key[]).includes(field);
  const current = profile[field];
  const [text, setText] = useState(isList ? ((current as string[] | undefined) ?? []).join("\n") : typeof current === "string" ? current : "");
  const [regs, setRegs] = useState<string[]>(profile.taxRegistrations ?? []);
  const save = (value: unknown) => onDone({ ...profile, [field]: value });

  const select = (options: readonly { key?: string; code?: string; label?: string; name?: string }[]) => (
    <select
      autoFocus
      defaultValue={String(current ?? "")}
      onChange={(e) => save(e.target.value || undefined)}
      onBlur={() => onDone()}
      className="h-9 w-full rounded-lg border border-border-strong bg-surface px-2 text-sm outline-none focus:border-focus"
    >
      {options.map((o) => (
        <option key={o.key ?? o.code} value={o.key ?? o.code}>
          {o.label ?? o.name}
        </option>
      ))}
    </select>
  );

  let control: React.ReactNode;
  if (field === "country") control = select(COUNTRIES);
  else if (field === "teamSize") control = select(TEAM_SIZES);
  else if (field === "turnover") control = select(TURNOVER_BANDS);
  else if (field === "makesThings")
    control = (
      <div className="flex gap-2">
        {[true, false].map((v) => (
          <button key={String(v)} type="button" onClick={() => save(v)} className={cx("h-8 rounded-full border px-3 text-sm", profile.makesThings === v ? "border-accent bg-accent-soft" : "border-border-strong")}>
            {v ? "Yes" : "No"}
          </button>
        ))}
      </div>
    );
  else if (field === "taxRegistrations")
    control = (
      <div className="space-y-2">
        {(["vat", "sscl", "wht"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={regs.includes(k)} onChange={(e) => setRegs((r) => (e.target.checked ? [...r, k] : r.filter((x) => x !== k)))} className="size-4 accent-[var(--sw-accent)]" />
            {{ vat: "VAT", sscl: "SSCL", wht: "Withholding tax" }[k]}
          </label>
        ))}
        <SaveRow onSave={() => onDone({ ...profile, taxRegistrations: regs as BusinessProfile["taxRegistrations"], taxConfirmed: true })} onCancel={() => onDone()} />
      </div>
    );
  else
    control = (
      <div className="space-y-2">
        <textarea
          autoFocus
          rows={isList ? Math.min(8, Math.max(3, text.split("\n").length + 1)) : 2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onDone();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(isList ? lines(text) : text.trim() || undefined);
          }}
          className="w-full resize-none rounded-lg border border-border-strong bg-surface px-2.5 py-2 text-sm leading-relaxed outline-none focus:border-focus"
        />
        {isList && <p className="text-[11px] text-ink-faint">One per line.</p>}
        <SaveRow onSave={() => save(isList ? lines(text) : text.trim() || undefined)} onCancel={() => onDone()} />
      </div>
    );

  return (
    <div className="bg-surface-sunken/50 px-4 py-3 animate-fade">
      <p className="mb-2 text-xs text-ink-muted">{FIELD_LABEL[field]}</p>
      {control}
    </div>
  );
}

const lines = (t: string) =>
  t
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function SaveRow({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onSave} className="h-8 rounded-full bg-ink px-3.5 text-[13px] text-canvas hover:opacity-90">
        Save
      </button>
      <button type="button" onClick={onCancel} className="h-8 rounded-full px-3 text-[13px] text-ink-muted hover:bg-surface-sunken">
        Cancel
      </button>
    </div>
  );
}
