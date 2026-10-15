/**
 * Display formatting shared by server and client components. Values arrive
 * as stored: money in minor units, dates "YYYY-MM-DD", select keys.
 */

export interface FieldSpec {
  key: string;
  label: string;
  type: string;
  required: boolean;
  system: boolean;
  custom: boolean;
  to?: string;
  unit?: string;
  description?: string;
  options?: { value: string; label: string; tone?: string }[];
}

export interface ListSpec {
  key: string;
  label: string;
  fields: FieldSpec[];
}

export interface FormSpec {
  fields: FieldSpec[];
  lists: ListSpec[];
}

export type RefTitles = Record<string, string>;

const NUMERIC = new Set(["integer", "decimal", "money", "quantity", "percent"]);
export const isNumeric = (type: string) => NUMERIC.has(type);

export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-LK", { style: "currency", currency, currencyDisplay: "code" }).format(minor / 100).replace(currency, currency === "LKR" ? "Rs" : currency).trim();
}

export function formatValue(f: Pick<FieldSpec, "type" | "options" | "unit">, v: unknown, ctx: { currency: string; refs?: RefTitles; me?: string }): string {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return "—";
  switch (f.type) {
    case "money":
      return typeof v === "number" ? formatMoney(v, ctx.currency) : String(v);
    case "quantity":
      return typeof v === "number" ? `${v.toLocaleString("en-LK", { maximumFractionDigits: 3 })}${f.unit ? ` ${f.unit}` : ""}` : String(v);
    case "integer":
    case "decimal":
      return typeof v === "number" ? v.toLocaleString("en-LK", { maximumFractionDigits: 6 }) : String(v);
    case "percent":
      return typeof v === "number" ? `${v.toLocaleString("en-LK", { maximumFractionDigits: 2 })}%` : String(v);
    case "boolean":
      return v === true ? "Yes" : "No";
    case "date":
      return typeof v === "string" ? new Date(`${v}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : String(v);
    case "datetime":
      return typeof v === "string" ? new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : String(v);
    case "select":
      return f.options?.find((o) => o.value === v)?.label ?? String(v);
    case "multiselect":
      return (v as string[]).map((x) => f.options?.find((o) => o.value === x)?.label ?? x).join(", ");
    case "ref":
      return ctx.refs?.[String(v)] ?? "Unknown record";
    case "user":
      return v === ctx.me ? "You" : String(v);
    default:
      return String(v);
  }
}

/** A stored value as the string a form input holds. */
export function toInput(f: Pick<FieldSpec, "type">, v: unknown): string | boolean | string[] {
  if (v === null || v === undefined) return f.type === "boolean" ? false : f.type === "multiselect" ? [] : "";
  if (f.type === "money" && typeof v === "number") return (v / 100).toFixed(2);
  if (f.type === "boolean") return v === true;
  if (f.type === "multiselect") return Array.isArray(v) ? (v as string[]) : [];
  if (f.type === "datetime" && typeof v === "string") return v.slice(0, 16);
  return String(v);
}

export const TONE_CLASS: Record<string, string> = {
  neutral: "neutral",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
};
