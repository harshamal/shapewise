import type { Blueprint } from "@shapewise/blueprint";
import { titleOf, type CField, type CTarget, type StoredRecord } from "@shapewise/runtime";
import { formatValue, isNumeric, type RefTitles } from "../format";

/**
 * What a printed document shows, worked out from the setup and one record:
 * the business, the other party, the header details, the lines and totals.
 * Pure, so the PDF, the share page and tests all read the same thing.
 */

export type Layout = "standard" | "compact" | "ird_tax_invoice";

export interface DocumentModel {
  layout: Layout;
  title: string;
  number: string;
  status?: string;
  business: { name: string; legalName?: string; lines: string[] };
  party?: { heading: string; name: string; lines: string[] };
  meta: { label: string; value: string }[];
  columns: { key: string; label: string; numeric: boolean }[];
  rows: Record<string, string>[];
  totals: { label: string; value: string; strong?: boolean }[];
  /** Records without lines (receipts, payments): the one amount that matters. */
  amount?: { label: string; value: string };
  notes?: string;
  footer?: string;
  currency: string;
}

const PARTY_TARGETS: Record<string, string> = { customer: "Bill to", vendor: "Supplier", employee: "Employee" };
const FOOTER_KEYS = new Set(["sub_total", "tax_total", "total", "amount_due", "notes", "currency", "number"]);
const HIDDEN_LINE_KEYS = new Set(["delivered_qty", "invoiced_qty", "received_qty", "billed_qty"]);

export interface DocumentInput {
  bp: Blueprint;
  t: CTarget;
  rec: StoredRecord;
  refs: RefTitles;
  /** The customer or vendor record the document is addressed to, if any. */
  party?: { field: CField; rec: StoredRecord; t: CTarget };
}

/** The ref field naming who the document is for. */
export function partyField(t: CTarget): CField | undefined {
  return t.fields.find((f) => f.type === "ref" && f.to && f.to in PARTY_TARGETS);
}

export function buildDocument({ bp, t, rec, refs, party }: DocumentInput): DocumentModel {
  const currency = typeof rec.data.currency === "string" && rec.data.currency ? rec.data.currency : bp.business.currency;
  const ctx = { currency, refs };
  const template = bp.documents.find((d) => d.record === t.target && d.default) ?? bp.documents.find((d) => d.record === t.target);
  const forced = new Set((template?.extraFields ?? []).map((k) => k.replace(/^lines\./, "")));
  const hiddenCustom = new Set(bp.customFields.filter((c) => c.target === t.target && !c.showOnDocuments).map((c) => c.field.key));
  const printed = (f: CField) => forced.has(f.key) || !(f.custom && hiddenCustom.has(f.key));
  const value = (f: CField, v: unknown) => formatValue(f, v, ctx);

  const b = bp.business;
  // Till receipts print narrow; invoices follow the country's tax invoice format when it has one.
  const layout: Layout = template?.layout ?? (t.target === "pos_sale" ? "compact" : t.target === "invoice" && bp.settings.tax.invoiceFormat === "lk_ird" ? "ird_tax_invoice" : "standard");
  const taxIds = [b.tin && `TIN ${b.tin}`, b.vatNo && `VAT ${b.vatNo}`, b.brNo && `BR ${b.brNo}`].filter(Boolean).join("   ");
  const business = {
    name: b.name,
    legalName: b.legalName && b.legalName !== b.name ? b.legalName : undefined,
    lines: [b.address, [b.phone, b.email, b.website].filter(Boolean).join("   "), taxIds].filter((x): x is string => Boolean(x)),
  };

  const pf = party?.field ?? partyField(t);
  let partyBlock: DocumentModel["party"];
  if (pf) {
    const heading = t.target.startsWith("purchase") || t.target === "vendor_bill" ? "Supplier" : PARTY_TARGETS[pf.to!] ?? pf.label;
    if (party) {
      const d = party.rec.data;
      const s = (k: string) => (typeof d[k] === "string" && d[k] ? String(d[k]) : undefined);
      const ids = [s("tin") && `TIN ${s("tin")}`, s("vat_no") && `VAT ${s("vat_no")}`].filter(Boolean).join("   ");
      partyBlock = {
        heading,
        name: s("legal_name") ?? titleOf(party.t, party.rec),
        lines: [s("legal_name") && s("name") !== s("legal_name") ? s("name") : undefined, s("address"), [s("phone"), s("email")].filter(Boolean).join("   "), ids].filter((x): x is string => Boolean(x)),
      };
    } else if (typeof rec.data[pf.key] === "string") {
      partyBlock = { heading, name: refs[String(rec.data[pf.key])] ?? "", lines: [] };
    }
  }

  const meta: DocumentModel["meta"] = [];
  for (const f of t.fields) {
    if (f === pf || FOOTER_KEYS.has(f.key) || f.key === t.amountField || f.type === "lines" || f.type === "longtext" || !printed(f)) continue;
    // System bookkeeping (balances, posted flags) stays off the page unless it's a date.
    if (f.system && f.type !== "date" && !forced.has(f.key)) continue;
    const v = rec.data[f.key];
    if (v === null || v === undefined || v === "" || v === false) continue;
    meta.push({ label: f.label, value: value(f, v) });
  }

  const list = t.lines;
  const rawRows = list ? ((rec.data[list.key] as Record<string, unknown>[] | undefined) ?? []) : [];
  const lineFields = (list?.fields ?? []).filter((f) => !HIDDEN_LINE_KEYS.has(f.key) && printed(f) && (!f.system || f.key === "amount" || forced.has(f.key)));
  // A column nobody filled in (no discounts on this invoice) is left off.
  const usedFields = lineFields.filter((f) => rawRows.some((r) => r[f.key] !== undefined && r[f.key] !== null && r[f.key] !== "" && !(f.key === "discount_pct" && r[f.key] === 0)));
  // Item and description read as one column: the item, with its description beneath when different.
  const hasItem = usedFields.some((f) => f.key === "item");
  const columns = usedFields.filter((f) => !(hasItem && f.key === "description")).map((f) => ({ key: f.key, label: f.key === "item" ? "Description" : f.label, numeric: isNumeric(f.type) }));
  const rows = rawRows.map((r) => {
    const out: Record<string, string> = {};
    for (const f of usedFields) out[f.key] = value(f, r[f.key]);
    if (hasItem && typeof r.description === "string" && r.description && r.description !== out.item) out.item = `${out.item}\n${r.description}`;
    if (hasItem && out.item === "—" && typeof r.description === "string") out.item = r.description;
    return out;
  });

  const money = (k: string) => (typeof rec.data[k] === "number" ? formatValue({ type: "money" }, rec.data[k], ctx) : undefined);
  const totals: DocumentModel["totals"] = [];
  const tax = typeof rec.data.tax_total === "number" ? (rec.data.tax_total as number) : 0;
  if (money("sub_total") && (tax !== 0 || layout === "ird_tax_invoice")) totals.push({ label: layout === "ird_tax_invoice" ? "Value excluding tax" : "Sub total", value: money("sub_total")! });
  if (money("tax_total") && (tax !== 0 || layout === "ird_tax_invoice")) totals.push({ label: layout === "ird_tax_invoice" ? taxLabel(bp) : "Tax", value: money("tax_total")! });
  if (money("total")) totals.push({ label: "Total", value: money("total")!, strong: true });
  const due = rec.data.amount_due;
  if (typeof due === "number" && typeof rec.data.total === "number" && due !== rec.data.total && rec.status !== "draft") {
    totals.push({ label: "Paid", value: formatValue({ type: "money" }, (rec.data.total as number) - due, ctx) });
    totals.push({ label: "Balance due", value: money("amount_due")!, strong: true });
  }

  let amount: DocumentModel["amount"];
  if (!list && t.amountField && typeof rec.data[t.amountField] === "number") {
    const af = t.fields.find((f) => f.key === t.amountField);
    amount = { label: af?.label ?? "Amount", value: money(t.amountField)! };
  }

  const notesField = t.fields.find((f) => f.key === "notes");
  const longtexts = t.fields.filter((f) => f.type === "longtext" && f.key !== "notes" && printed(f) && typeof rec.data[f.key] === "string" && rec.data[f.key]);
  const notes = [notesField && rec.data.notes ? String(rec.data.notes) : "", ...longtexts.map((f) => `${f.label}: ${String(rec.data[f.key])}`)].filter(Boolean).join("\n\n");

  const state = t.states.find((s) => s.key === rec.status);
  const title = layout === "ird_tax_invoice" ? "Tax invoice" : template?.label && template.label !== t.label ? template.label : t.label;
  return {
    layout,
    title,
    number: typeof rec.data.number === "string" && rec.data.number ? rec.data.number : titleOf(t, rec),
    status: state && ["draft", "void", "cancelled"].includes(state.key) ? state.label : undefined,
    business,
    party: partyBlock,
    meta,
    columns,
    rows,
    totals,
    amount,
    notes: notes || undefined,
    footer: template?.footer,
    currency,
  };
}

function taxLabel(bp: Blueprint): string {
  return bp.business.country === "LK" ? "VAT" : "Tax";
}

/** A short plain-text version, for email bodies and WhatsApp messages. */
export function documentMessage(doc: DocumentModel, link: string): string {
  const total = doc.totals.find((t) => t.label === "Balance due") ?? doc.totals.find((t) => t.label === "Total") ?? doc.amount;
  const hello = doc.party?.name ? `Hello ${doc.party.name},\n\n` : "";
  return `${hello}Here is ${doc.title.toLowerCase()} ${doc.number} from ${doc.business.name}${total ? ` for ${total.value}` : ""}.\n\nView or download it here: ${link}\n\nThank you.\n${doc.business.name}`;
}
