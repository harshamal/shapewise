import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@shapewise/ui";

/**
 * Small building blocks the purpose-built screens share, so a ledger, a
 * stock list and a QC queue read as one product: a filter bar that is a
 * plain GET form (works without JavaScript, links can be shared), headline
 * figures, tables and empty states.
 */

export const th = "h-9 px-4 text-left font-medium whitespace-nowrap text-ink-muted";
export const thNum = `${th} text-right`;
export const td = "px-4 py-2 align-top";
export const tdNum = "px-4 py-2 text-right tabular whitespace-nowrap align-top";

export function Filters({ children, keep = {}, submit = "Show" }: { children: ReactNode; keep?: Record<string, string | undefined>; submit?: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-sw border bg-surface p-3 print:hidden">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {children}
      <button type="submit" className="h-9 rounded-sw border border-border-strong px-4 text-sm hover:bg-surface-sunken">
        {submit}
      </button>
    </form>
  );
}

const control = "h-9 rounded-sw border border-border-strong bg-canvas px-2.5 text-sm outline-none focus:border-focus";

export function DateField({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="grid gap-1 text-xs text-ink-muted">
      {label}
      <input type="date" name={name} defaultValue={value} className={control} />
    </label>
  );
}

export function SelectField({ name, label, value, options, placeholder }: { name: string; label: string; value?: string; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <label className="grid min-w-48 gap-1 text-xs text-ink-muted">
      {label}
      <select name={name} defaultValue={value ?? ""} className={control}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextField({ name, label, value, placeholder }: { name: string; label: string; value?: string; placeholder?: string }) {
  return (
    <label className="grid min-w-56 flex-1 gap-1 text-xs text-ink-muted">
      {label}
      <input type="search" name={name} defaultValue={value} placeholder={placeholder} className={control} />
    </label>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid gap-px overflow-hidden rounded-sw border bg-border sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="bg-surface p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={cx("tabular mt-1 text-xl font-medium", tone === "good" && "text-success-fg", tone === "bad" && "text-danger-fg", tone === "warn" && "text-warning-fg")}>{value}</p>
      {note && <p className="mt-1 text-xs text-ink-faint">{note}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-sw border bg-surface px-6 py-12 text-center text-sm text-ink-muted">{children}</p>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-sw border bg-surface", className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

/** A link when there's somewhere to go, plain text otherwise. */
export function MaybeLink({ href, children, className }: { href?: string; children: ReactNode; className?: string }) {
  return href ? (
    <Link href={href as never} className={cx("hover:underline", className)}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

/** Tabs that are links, for screens with a few views. */
export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <nav aria-label="Views" className="flex flex-wrap gap-1 border-b print:hidden">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href as never}
          aria-current={t.key === active ? "page" : undefined}
          className={cx("-mb-px border-b-2 px-3 py-2 text-sm", t.key === active ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "good" | "bad" | "warn" | "info"; children: ReactNode }) {
  const tones = { neutral: "bg-surface-sunken text-ink-muted", good: "bg-success-bg text-success-fg", bad: "bg-danger-bg text-danger-fg", warn: "bg-warning-bg text-warning-fg", info: "bg-info-bg text-info-fg" };
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs whitespace-nowrap", tones[tone])}>{children}</span>;
}

/** Builds a URL on the current screen with some query values changed. */
export function withQuery(here: string, q: Record<string, string | undefined>, change: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...q, ...change })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${here}?${s}` : here;
}
