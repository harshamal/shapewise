import "server-only";
import { JOURNAL, titleOf, type StoredLine, type StoredRecord } from "@shapewise/runtime";
import { AGE_BUCKETS, ageBucket, loadSnapshot, openDocuments, type Snapshot } from "@shapewise/runtime/reports";
import { formatMoney, formatValue } from "./format";
import type { DocSource } from "./documents/load";
import type { DocumentModel } from "./documents/model";

/**
 * A customer's statement: every posted entry on what they owe you, with a
 * running balance, from the books (so it always agrees with receivables),
 * and how old the unpaid part is.
 */

export interface StatementRow {
  date: string;
  target: string;
  id: string;
  document: string;
  memo: string;
  /** Charged to the customer (invoices). */
  debit: number;
  /** Paid or credited (receipts, credit notes). */
  credit: number;
  balance: number;
}

export interface Statement {
  customer: StoredRecord;
  name: string;
  from: string;
  to: string;
  opening: number;
  rows: StatementRow[];
  closing: number;
  aging: { key: string; label: string; amount: number }[];
}

const ofCustomer = (l: StoredLine, id: string) => l.party?.target === "customer" && l.party.id === id;

export async function statementSnapshot(src: DocSource): Promise<Snapshot> {
  const first = await loadSnapshot(src.store, src.tenant, src.compiled, [JOURNAL]);
  const sources = new Set(first.list(JOURNAL).map((e) => String(e.data.source_target)));
  return loadSnapshot(src.store, src.tenant, src.compiled, [JOURNAL, "customer", "invoice", "receipt", "credit_note", ...sources]);
}

export function buildStatement(s: Snapshot, customerId: string, from: string, to: string, today: string): Statement | null {
  const customer = s.get("customer", customerId);
  if (!customer) return null;
  let opening = 0;
  const rows: StatementRow[] = [];
  const entries = [...s.list(JOURNAL)].sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)) || a.createdAt.localeCompare(b.createdAt));
  for (const e of entries) {
    const date = String(e.data.date);
    if (date > to) continue;
    const lines = ((e.data.lines as StoredLine[]) ?? []).filter((l) => ofCustomer(l, customerId));
    if (!lines.length) continue;
    const debit = lines.reduce((t, l) => t + l.debit, 0);
    const credit = lines.reduce((t, l) => t + l.credit, 0);
    if (date < from) {
      opening += debit - credit;
      continue;
    }
    const target = String(e.data.source_target);
    const id = String(e.data.source_id);
    const document = (e.data.source_number as string | null) ?? s.title(target, id);
    const memo = String(e.data.memo ?? "");
    // The engine's own memo just repeats the document ("Post: invoice INV-1"); keep only what a person wrote.
    rows.push({ date, target, id, document, memo: memo.includes(document) ? "" : memo, debit, credit, balance: 0 });
  }
  let running = opening;
  for (const r of rows) r.balance = running += r.debit - r.credit;

  const terms = (c: string) => Number(s.get("customer", c)?.data.payment_terms_days ?? 0) || 0;
  const open = openDocuments({ docs: s.list("invoice"), payments: s.list("receipt"), credits: s.list("credit_note"), party: "customer", creditRef: "invoice", terms }).filter((d) => d.party === customerId);
  const aging = AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, amount: open.filter((d) => ageBucket(d.due, today) === b.key).reduce((t, d) => t + d.open, 0) }));

  return { customer, name: String(customer.data.legal_name || customer.data.name || "Customer"), from, to, opening, rows, closing: running, aging };
}

/** The statement as a printable document, for the PDF and shared link. */
export function statementDocument(src: DocSource, st: Statement): DocumentModel {
  const b = src.bp.business;
  const currency = b.currency;
  const money = (n: number) => formatMoney(n, currency);
  const date = (d: string) => formatValue({ type: "date" }, d, { currency });
  const d = st.customer.data;
  const s = (k: string) => (typeof d[k] === "string" && d[k] ? String(d[k]) : undefined);
  const t = src.compiled.targets.get("customer");
  return {
    layout: "standard",
    title: "Statement",
    number: `${date(st.from)} to ${date(st.to)}`,
    business: {
      name: b.name,
      legalName: b.legalName && b.legalName !== b.name ? b.legalName : undefined,
      lines: [b.address, [b.phone, b.email, b.website].filter(Boolean).join("   "), [b.tin && `TIN ${b.tin}`, b.vatNo && `VAT ${b.vatNo}`].filter(Boolean).join("   ")].filter((x): x is string => Boolean(x)),
    },
    party: { heading: "Customer", name: st.name, lines: [s("address"), [s("phone"), s("email")].filter(Boolean).join("   ")].filter((x): x is string => Boolean(x)) },
    meta: [
      { label: "Customer", value: t ? titleOf(t, st.customer) : st.name },
      { label: "Opening balance", value: money(st.opening) },
    ],
    columns: [
      { key: "date", label: "Date", numeric: false },
      { key: "document", label: "Document", numeric: false },
      { key: "debit", label: "Charges", numeric: true },
      { key: "credit", label: "Payments", numeric: true },
      { key: "balance", label: "Balance", numeric: true },
    ],
    rows: st.rows.map((r) => ({ date: date(r.date), document: r.memo && r.memo !== r.document ? `${r.document}\n${r.memo}` : r.document, debit: r.debit ? money(r.debit) : "", credit: r.credit ? money(r.credit) : "", balance: money(r.balance) })),
    totals: [
      ...st.aging.filter((a) => a.amount).map((a) => ({ label: a.key === "current" ? a.label : `${a.label} late`, value: money(a.amount) })),
      { label: "Balance due", value: money(st.closing), strong: true },
    ],
    notes: st.rows.length ? undefined : "No entries in this period.",
    footer: "Please contact us if anything here doesn't match your records.",
    currency,
  };
}
