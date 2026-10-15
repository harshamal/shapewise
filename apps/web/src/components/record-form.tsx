"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { Button, Checkbox, Input, Select, Textarea, cx } from "@shapewise/ui";
import type { ActionResult } from "@/app/w/[tenant]/actions";
import { formatMoney, isNumeric, type FieldSpec, type FormSpec, type ListSpec } from "@/lib/format";

type Value = string | boolean | string[];
type Row = Record<string, Value>;
type Options = Record<string, { value: string; label: string }[]>;

/**
 * One form for every record type: header fields, line items and child lists,
 * all driven by the compiled blueprint. The pipeline re-validates everything;
 * this only makes entry pleasant and shows its answers next to the fields.
 */
export function RecordForm({
  spec,
  initial,
  options,
  me,
  currency,
  submitLabel,
  cancelHref,
  detailBase,
  save,
}: {
  spec: FormSpec;
  initial: { header: Row; lists: Record<string, Row[]> };
  options: Options;
  me: { id: string; name: string };
  currency: string;
  submitLabel: string;
  cancelHref: string;
  /** Where a saved record lives: `${detailBase}/${id}`. */
  detailBase: string;
  save: (values: Record<string, unknown>) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [header, setHeader] = useState<Row>(initial.header);
  const [lists, setLists] = useState<Record<string, Row[]>>(() => {
    const out: Record<string, Row[]> = {};
    for (const l of spec.lists) out[l.key] = initial.lists[l.key]?.length ? initial.lists[l.key]! : l.key === "lines" ? [emptyRow(l)] : [];
    return out;
  });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const issueAt = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of result?.issues ?? []) m.set(i.path.join("."), i.message);
    return m;
  }, [result]);
  const unplaced = (result?.issues ?? []).filter((i) => !placeable(spec, i.path));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const values: Record<string, unknown> = {};
    for (const f of spec.fields) if (!f.system) values[f.key] = header[f.key];
    for (const l of spec.lists) values[l.key] = (lists[l.key] ?? []).map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => k === "_line" || l.fields.some((f) => f.key === k && !f.system))));
    start(async () => {
      const r = await save(values);
      setResult(r);
      if (r.ok && r.recordId && !r.pending) {
        router.push(`${detailBase}/${r.recordId}${r.warnings?.length ? `?note=${encodeURIComponent(r.warnings.join(" "))}` : ""}` as never);
        router.refresh();
      } else if (r.ok && r.pending) {
        router.refresh();
      }
    });
  }

  const visible = spec.fields.filter((f) => !f.system);
  return (
    <form onSubmit={submit} className="space-y-8" noValidate>
      {result && !result.ok && (
        <div role="alert" className="rounded-sw border border-danger-fg/20 bg-danger-bg px-4 py-3 text-sm text-danger-fg">
          <p className="font-medium">{result.message}</p>
          {unplaced.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {unplaced.map((i) => (
                <li key={i.path.join(".") + i.message}>{i.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result?.pending && (
        <p role="status" className="rounded-sw bg-warning-bg px-4 py-3 text-sm text-warning-fg">
          {result.message}
        </p>
      )}

      <section className="grid gap-x-6 gap-y-5 rounded-sw border bg-surface p-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((f) => (
          <FieldControl
            key={f.key}
            f={f}
            value={header[f.key] ?? ""}
            options={options}
            me={me}
            error={issueAt.get(f.key)}
            wide={f.type === "longtext"}
            onChange={(v) => setHeader((h) => ({ ...h, [f.key]: v }))}
          />
        ))}
      </section>

      {spec.lists.map((l) => (
        <ListEditor
          key={l.key}
          list={l}
          rows={lists[l.key] ?? []}
          options={options}
          me={me}
          currency={currency}
          issueAt={issueAt}
          error={issueAt.get(l.key)}
          onChange={(rows) => setLists((s) => ({ ...s, [l.key]: rows }))}
        />
      ))}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Link href={cancelHref as never} className="inline-flex h-9 items-center rounded-sw px-4 text-sm text-ink-muted hover:bg-surface-sunken hover:text-ink">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function placeable(spec: FormSpec, path: (string | number)[]): boolean {
  if (path.length === 1) return spec.fields.some((f) => f.key === path[0] && !f.system) || spec.lists.some((l) => l.key === path[0]);
  return path.length === 3 && spec.lists.some((l) => l.key === path[0] && l.fields.some((f) => f.key === path[2] && !f.system));
}

function emptyRow(l: ListSpec): Row {
  const row: Row = { _line: "" };
  for (const f of l.fields) if (!f.system) row[f.key] = f.type === "boolean" ? false : f.type === "multiselect" ? [] : "";
  return row;
}

/* ------------------------------------------------------------------- fields */

function FieldControl({
  f,
  value,
  onChange,
  options,
  me,
  error,
  wide,
  bare,
}: {
  f: FieldSpec;
  value: Value;
  onChange: (v: Value) => void;
  options: Options;
  me: { id: string; name: string };
  error?: string;
  wide?: boolean;
  /** Inside a table cell: no label. */
  bare?: boolean;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : f.description ? `${id}-hint` : undefined;
  const common = { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy, "aria-label": bare ? f.label : undefined };
  let control: React.ReactNode;

  switch (f.type) {
    case "longtext":
      control = <Textarea {...common} value={String(value)} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "boolean":
      control = (
        <label className="flex h-9 items-center gap-2 text-sm">
          <Checkbox {...common} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {!bare && <span>{f.label}</span>}
        </label>
      );
      break;
    case "select":
      control = (
        <Select {...common} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">{f.required ? "Choose…" : "—"}</option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
      break;
    case "multiselect": {
      const set = new Set(Array.isArray(value) ? value : []);
      control = (
        <div className="flex flex-wrap gap-x-4 gap-y-1 py-1.5" role="group" aria-labelledby={`${id}-label`}>
          {f.options?.map((o) => (
            <label key={o.value} className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={set.has(o.value)} onChange={(e) => onChange(e.target.checked ? [...set, o.value] : [...set].filter((x) => x !== o.value))} />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;
    }
    case "ref": {
      const opts = options[f.to ?? ""] ?? [];
      control = (
        <Select {...common} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">{opts.length ? (f.required ? "Choose…" : "—") : "Nothing to choose yet"}</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
      break;
    }
    case "user":
      control = (
        <Select {...common} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          <option value={me.id}>{me.name} (you)</option>
          {value && value !== me.id && <option value={String(value)}>{String(value)}</option>}
        </Select>
      );
      break;
    default: {
      const type = f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : f.type === "email" ? "email" : f.type === "url" ? "url" : f.type === "phone" ? "tel" : "text";
      control = (
        <Input
          {...common}
          type={type}
          inputMode={isNumeric(f.type) ? "decimal" : undefined}
          className={isNumeric(f.type) ? "tabular text-right" : undefined}
          placeholder={f.type === "file" || f.type === "image" ? "Link to the file" : undefined}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }

  if (bare) {
    return (
      <div>
        {control}
        {error && (
          <p id={`${id}-err`} className="mt-1 text-xs text-danger-fg">
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className={cx("min-w-0", wide && "sm:col-span-2 lg:col-span-3")}>
      {f.type !== "boolean" && (
        <label id={`${id}-label`} htmlFor={id} className="mb-1.5 block text-sm text-ink-muted">
          {f.label}
          {f.required && <span className="text-danger-fg"> *</span>}
          {f.type === "quantity" && f.unit && <span className="text-ink-faint"> ({f.unit})</span>}
          {f.type === "money" && <span className="text-ink-faint"> (Rs)</span>}
          {f.type === "percent" && <span className="text-ink-faint"> (%)</span>}
        </label>
      )}
      {control}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-xs text-danger-fg">
          {error}
        </p>
      ) : f.description ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-faint">
          {f.description}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- lists */

function ListEditor({
  list,
  rows,
  onChange,
  options,
  me,
  currency,
  issueAt,
  error,
}: {
  list: ListSpec;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  options: Options;
  me: { id: string; name: string };
  currency: string;
  issueAt: Map<string, string>;
  error?: string;
}) {
  const cols = list.fields.filter((f) => !f.system);
  const priced = list.fields.some((f) => f.key === "unit_price") && list.fields.some((f) => f.key === "quantity");
  const lineTotal = (r: Row) => {
    const n = (k: string) => Number(String(r[k] ?? "").replaceAll(",", "")) || 0;
    return Math.round(n("quantity") * n("unit_price") * 100 * (1 - n("discount_pct") / 100));
  };
  const set = (i: number, key: string, v: Value) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));

  return (
    <section aria-labelledby={`list-${list.key}`}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id={`list-${list.key}`} className="text-sm font-medium">
          {list.label}
        </h2>
        {error && <p className="text-xs text-danger-fg">{error}</p>}
      </div>
      <div className="overflow-x-auto rounded-sw border bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-ink-muted">
              {cols.map((f) => (
                <th key={f.key} scope="col" className={cx("h-9 px-2 font-medium first:pl-3", isNumeric(f.type) && "text-right")}>
                  {f.label}
                  {f.required && <span className="text-danger-fg"> *</span>}
                </th>
              ))}
              {priced && (
                <th scope="col" className="h-9 px-2 text-right font-medium">
                  Amount
                </th>
              )}
              <th scope="col" className="w-10">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} className="px-3 py-6 text-center text-ink-muted">
                  No {list.label.toLowerCase()} yet.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0 align-top">
                {cols.map((f) => (
                  <td key={f.key} className={cx("px-2 py-2 first:pl-3", f.type === "ref" || f.type === "text" ? "min-w-40" : "min-w-24")}>
                    <FieldControl bare f={f} value={r[f.key] ?? ""} options={options} me={me} error={issueAt.get(`${list.key}.${i}.${f.key}`)} onChange={(v) => set(i, f.key, v)} />
                  </td>
                ))}
                {priced && <td className="tabular px-2 py-2 pt-4 text-right whitespace-nowrap">{formatMoney(lineTotal(r), currency)}</td>}
                <td className="px-1 py-2">
                  <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="flex size-9 items-center justify-center rounded-sw text-ink-faint hover:bg-surface-sunken hover:text-danger-fg" aria-label={`Remove row ${i + 1}`}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {priced && rows.length > 0 && (
            <tfoot>
              <tr className="border-t">
                <td colSpan={cols.length} className="px-3 py-2 text-right text-ink-muted">
                  Before tax
                </td>
                <td className="tabular px-2 py-2 text-right font-medium">{formatMoney(rows.reduce((s, r) => s + lineTotal(r), 0), currency)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <Button size="sm" className="mt-2" onClick={() => onChange([...rows, emptyRow(list)])}>
        Add {list.key === "lines" ? "line" : "row"}
      </Button>
    </section>
  );
}
