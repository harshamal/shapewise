import type { CField, CTarget } from "./compile";
import type { ReadTx, StoredRecord } from "./store";

/**
 * Turning input (from forms, the assistant or MCP) into stored values, and
 * back. Input is lenient about format ("1,250.50", "true", "2026-10-16");
 * storage is strict: money in minor units, quantities to 3 decimals, dates
 * as YYYY-MM-DD, select values checked against their options.
 */

export interface DataIssue {
  path: (string | number)[];
  message: string;
}

const MINOR = 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const toMinor = (major: number) => Math.round(major * MINOR);
export const fromMinor = (minor: number) => minor / MINOR;

/** Coerce and check one value. Returns undefined for "no value". */
export function coerceValue(f: CField, raw: unknown, path: DataIssue["path"], issues: DataIssue[]): unknown {
  if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0 && f.type !== "multiselect")) return undefined;
  const bad = (message: string) => (issues.push({ path, message: `${f.label}: ${message}` }), undefined);

  switch (f.type) {
    case "text":
    case "longtext":
    case "phone":
    case "url":
    case "file":
    case "image": {
      if (typeof raw !== "string" && typeof raw !== "number") return bad("expected text.");
      const s = String(raw).trim();
      if (s.length > (f.type === "longtext" ? 10_000 : 500)) return bad("too long.");
      if (f.type === "url" && s && !/^https?:\/\//i.test(s)) return bad("should start with http:// or https://.");
      return s || undefined;
    }
    case "email": {
      const s = String(raw).trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : bad("isn't an email address.");
    }
    case "integer":
    case "decimal":
    case "money":
    case "quantity":
    case "percent": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replaceAll(",", "").trim());
      if (!Number.isFinite(n)) return bad("expected a number.");
      if (f.type === "integer" && !Number.isInteger(n)) return bad("expected a whole number.");
      if (f.type === "percent" && (n < -100 || n > 1000)) return bad("percent is out of range.");
      if (f.type === "money") return toMinor(n);
      if (f.type === "quantity") return Math.round(n * 1000) / 1000;
      return n;
    }
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (raw === "true" || raw === "on" || raw === "1") return true;
      if (raw === "false" || raw === "off" || raw === "0") return false;
      return bad("expected yes or no.");
    case "date": {
      const s = String(raw).trim().slice(0, 10);
      return DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : bad("expected a date (YYYY-MM-DD).");
    }
    case "datetime": {
      const t = Date.parse(String(raw));
      return Number.isNaN(t) ? bad("expected a date and time.") : new Date(t).toISOString();
    }
    case "select": {
      const v = String(raw);
      if (f.options && !f.options.some((o) => o.value === v)) return bad(`"${v}" isn't one of ${f.options.map((o) => o.label).join(", ")}.`);
      return v;
    }
    case "multiselect": {
      const vs = (Array.isArray(raw) ? raw : String(raw).split(",")).map((v) => String(v).trim()).filter(Boolean);
      const unknown = vs.filter((v) => f.options && !f.options.some((o) => o.value === v));
      if (unknown.length) return bad(`not an option: ${unknown.join(", ")}.`);
      return [...new Set(vs)];
    }
    case "ref":
    case "user": {
      if (typeof raw !== "string" || raw.length > 128) return bad("expected a record id.");
      return raw;
    }
    case "computed":
    case "lines":
      return undefined;
  }
}

/** Validate a header or a line against its fields. */
function coerceObject(fields: readonly CField[], input: Record<string, unknown>, mode: "create" | "update", path: DataIssue["path"], issues: DataIssue[]) {
  const out: Record<string, unknown> = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const [k, raw] of Object.entries(input)) {
    const f = byKey.get(k) ?? fields.find((x) => x.id === k);
    if (!f) {
      // Row ids keep lines stable across edits; handled by lineId().
      if (k === "id" || k === "_line") continue;
      issues.push({ path: [...path, k], message: `Unknown field "${k}".` });
      continue;
    }
    if (f.system) {
      if (raw !== undefined && raw !== null && raw !== "") issues.push({ path: [...path, f.key], message: `${f.label} is set by the system.` });
      continue;
    }
    const v = coerceValue(f, raw, [...path, f.key], issues);
    out[f.key] = v === undefined ? null : v;
  }
  if (mode === "create") {
    for (const f of fields) if (f.required && (out[f.key] === undefined || out[f.key] === null)) issues.push({ path: [...path, f.key], message: `${f.label} is required.` });
  } else {
    for (const f of fields) if (f.required && k(out, f.key) && out[f.key] === null) issues.push({ path: [...path, f.key], message: `${f.label} can't be emptied.` });
  }
  return out;
}

const k = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/**
 * Validate a create or update. `lines` and child lists are replaced as a
 * whole when present. Returns cleaned data keyed by field key.
 */
export function coerceRecord(t: CTarget, input: Record<string, unknown>, mode: "create" | "update"): { data: Record<string, unknown>; issues: DataIssue[] } {
  const issues: DataIssue[] = [];
  const header: Record<string, unknown> = {};
  const lists: Record<string, unknown> = {};
  const listKeys = new Set([t.lines?.key, ...t.children.map((c) => c.key)].filter(Boolean) as string[]);
  for (const [key, v] of Object.entries(input)) (listKeys.has(key) ? lists : header)[key] = v;

  const data = coerceObject(t.fields, header, mode, [], issues);

  for (const list of [t.lines, ...t.children].filter((x): x is NonNullable<typeof x> => Boolean(x))) {
    const raw = lists[list.key];
    if (raw === undefined) {
      if (mode === "create" && list === t.lines && list.fields.some((f) => f.required)) issues.push({ path: [list.key], message: `Add at least one line.` });
      continue;
    }
    if (!Array.isArray(raw)) {
      issues.push({ path: [list.key], message: `${list.label} must be a list.` });
      continue;
    }
    if (raw.length > 500) issues.push({ path: [list.key], message: `${list.label}: at most 500 rows.` });
    const rows = raw
      .slice(0, 500)
      .filter((row) => row && typeof row === "object" && Object.values(row as object).some((v) => v !== "" && v !== null && v !== undefined))
      .map((row, i) => ({ ...coerceObject(list.fields, row as Record<string, unknown>, "create", [list.key, i], issues), _line: lineId(row, i) }));
    if (list === t.lines && rows.length === 0 && list.fields.some((f) => f.required)) issues.push({ path: [list.key], message: `Add at least one line.` });
    data[list.key] = rows;
  }
  return { data, issues };
}

function lineId(row: unknown, i: number): string {
  const id = (row as { _line?: unknown })._line;
  return typeof id === "string" && /^[a-z0-9]{1,24}$/.test(id) ? id : `l${Date.now().toString(36)}${i}`;
}

/** Every referenced record must exist; returns their ids for `links`. */
export async function checkRefs(t: CTarget, data: Record<string, unknown>, tx: ReadTx, issues: DataIssue[]): Promise<string[]> {
  const links = new Set<string>();
  const check = async (fields: readonly CField[], obj: Record<string, unknown>, path: DataIssue["path"]) => {
    for (const f of fields) {
      const v = obj[f.key];
      if (f.type !== "ref" || typeof v !== "string" || !f.to || f.to === "user") continue;
      if (!(await tx.get(f.to, v))) issues.push({ path: [...path, f.key], message: `${f.label}: that record doesn't exist.` });
      else links.add(v);
    }
  };
  await check(t.fields, data, []);
  for (const list of [t.lines, ...t.children]) {
    if (!list) continue;
    const rows = (data[list.key] as Record<string, unknown>[] | undefined) ?? [];
    for (const [i, row] of rows.entries()) await check(list.fields, row, [list.key, i]);
  }
  return [...links];
}

/* ---------------------------------------------------------------- numbering */

/** "INV-{yyyy}-{seq:5}" → "INV-2026-00042". */
export function formatNumber(pattern: string, seq: number, date: string): string {
  const [yyyy, mm, dd] = [date.slice(0, 4), date.slice(5, 7), date.slice(8, 10)];
  return pattern
    .replaceAll("{yyyy}", yyyy)
    .replaceAll("{yy}", yyyy.slice(2))
    .replaceAll("{mm}", mm)
    .replaceAll("{dd}", dd)
    .replace(/\{seq(?::(\d))?\}/g, (_, w) => String(seq).padStart(Number(w ?? 1), "0"));
}

/** Counters reset when the period in the pattern changes (yearly for {yyyy}). */
export function sequenceKey(target: string, pattern: string, date: string): string {
  if (pattern.includes("{mm}")) return `${target}:${date.slice(0, 7)}`;
  if (pattern.includes("{yyyy}") || pattern.includes("{yy}")) return `${target}:${date.slice(0, 4)}`;
  return target;
}

/* ------------------------------------------------------------------- totals */

/**
 * Document arithmetic for core records with priced lines: line amounts, tax
 * from each line's tax code, and header totals. All in minor units.
 */
export async function computeTotals(t: CTarget, data: Record<string, unknown>, tx: ReadTx): Promise<void> {
  if (t.kind !== "core") return;
  const rows = (data.lines as Record<string, unknown>[] | undefined) ?? [];
  const has = (key: string) => t.fields.some((f) => f.key === key);

  if (t.target === "journal") {
    data.total_debit = rows.reduce((s, r) => s + num(r.debit), 0);
    return;
  }
  if (!t.lines?.fields.some((f) => f.key === "unit_price")) return;

  const rates = new Map<string, number>();
  let sub = 0;
  let tax = 0;
  for (const r of rows) {
    const amount = Math.round(num(r.quantity) * num(r.unit_price) * (1 - num(r.discount_pct) / 100));
    r.amount = amount;
    sub += amount;
    const code = r.tax_code;
    if (typeof code === "string") {
      if (!rates.has(code)) rates.set(code, num((await tx.get("tax_code", code))?.data.rate));
      tax += Math.round((amount * rates.get(code)!) / 100);
    }
  }
  if (has("sub_total")) data.sub_total = sub;
  if (has("tax_total")) data.tax_total = tax;
  if (has("total")) data.total = sub + tax;
  if (has("amount_due")) data.amount_due = sub + tax;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A record's display title. */
export function titleOf(t: CTarget, rec: Pick<StoredRecord, "id" | "data" | "number">): string {
  const v = t.titleField === "number" ? rec.number : rec.data[t.titleField];
  return (typeof v === "string" && v) || (typeof v === "number" ? String(v) : "") || (rec.number ?? `Draft ${t.label.toLowerCase()}`);
}
