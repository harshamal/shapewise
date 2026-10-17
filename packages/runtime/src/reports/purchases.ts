import { daysBetween, groupSum, num, pct, str, topPoints, within, type ReportImpl, type ReportRow } from "./engine";
import { openDocuments, openOrdersReport } from "./sales";

/** Purchases count posted bills less posted vendor credits, before tax. */

export const purchasesByVendor: ReportImpl = {
  reads: ["bill", "vendor_credit", "vendor"],
  period: "quarter",
  run(s, ctx) {
    const range = ctx.range!;
    const docs = [
      ...s.list("bill").map((b) => ({ r: b, sign: 1 })),
      ...s.list("vendor_credit").map((c) => ({ r: c, sign: -1 })),
    ].filter(({ r }) => r.status === "posted" && within(str(r.data.date), range));
    const amount = (x: (typeof docs)[number]) => x.sign * num(x.r.data.sub_total ?? x.r.data.total);
    const groups = groupSum(docs, (x) => s.title("vendor", x.r.data.vendor) || "No vendor", amount);
    const counts = new Map<string, number>();
    for (const x of docs) if (x.sign > 0) counts.set(s.title("vendor", x.r.data.vendor) || "No vendor", (counts.get(s.title("vendor", x.r.data.vendor) || "No vendor") ?? 0) + 1);
    const total = groups.reduce((t, g) => t + g.value, 0);
    const top = groups[0];
    return {
      headline: { label: "Top supplier", value: top?.value ?? null, unit: "money", text: top?.label },
      columns: [
        { key: "label", label: "Supplier", type: "text" },
        { key: "documents", label: "Bills", type: "count" },
        { key: "amount", label: "Bought", type: "money" },
        { key: "share", label: "Share", type: "percent" },
      ],
      rows: groups.map((g) => ({ label: g.label, documents: counts.get(g.label) ?? 0, amount: g.value, share: pct(g.value, total) })),
      totals: { label: "Total", amount: total, share: groups.length ? 100 : null },
      chart: { type: "bar", unit: "money", points: topPoints(groups) },
      note: "Posted bills less vendor credits, before tax.",
      empty: "No bills in this period yet.",
    };
  },
};

export const agedPayables: ReportImpl = {
  reads: ["bill", "payment", "vendor_credit", "vendor"],
  run(s, ctx) {
    const terms = (v: string) => num(s.get("vendor", v)?.data.payment_terms_days);
    const open = openDocuments({ docs: s.list("bill"), payments: s.list("payment"), credits: s.list("vendor_credit"), party: "vendor", creditRef: "bill", terms, deduct: (b) => num(b.data.wht_amount) });
    const rows = new Map<string, ReportRow & { total: number }>();
    const totals = { overdue: 0, week: 0, later: 0, total: 0 };
    for (const d of open) {
      const row = rows.get(d.party) ?? { label: s.title("vendor", d.party), overdue: 0, week: 0, later: 0, total: 0, next_due: null };
      const inDays = daysBetween(ctx.today, d.due);
      const b = inDays < 0 ? "overdue" : inDays <= 7 ? "week" : "later";
      row[b] = num(row[b]) + d.open;
      row.total += d.open;
      totals[b] += d.open;
      totals.total += d.open;
      if (!row.next_due || d.due < String(row.next_due)) row.next_due = d.due;
      rows.set(d.party, row);
    }
    return {
      headline: { label: "Bills due in the next 7 days", value: totals.overdue + totals.week, unit: "money" },
      columns: [
        { key: "label", label: "Supplier", type: "text" },
        { key: "overdue", label: "Overdue", type: "money" },
        { key: "week", label: "Due in 7 days", type: "money" },
        { key: "later", label: "Due later", type: "money" },
        { key: "total", label: "Owed", type: "money" },
        { key: "next_due", label: "Earliest due", type: "date" },
      ],
      rows: [...rows.values()].sort((a, b) => String(a.next_due).localeCompare(String(b.next_due))),
      totals: { label: "Total", ...totals },
      chart: { type: "bar", unit: "money", points: [{ label: "Overdue", value: totals.overdue }, { label: "Due in 7 days", value: totals.week }, { label: "Due later", value: totals.later }] },
      note: "Posted bills less payments made and vendor credits. Payments settle each supplier's oldest bills first. Due dates come from the bill, or the supplier's payment terms.",
      empty: "You don't owe any suppliers.",
    };
  },
};

export const openPurchaseOrders = openOrdersReport({
  target: "purchase_order", party: "vendor", dateKey: "expected_date", doneKey: "received_qty", open: new Set(["issued", "partly_received"]),
  headline: "Orders expected in the next 7 days", partyLabel: "Supplier", dateLabel: "Expected", valueLabel: "Still to receive", empty: "Nothing on order from suppliers.",
  note: "Issued purchase orders not yet fully received, valued at the order price before tax.",
});

export const expenseSummary: ReportImpl = {
  reads: ["expense", "account"],
  period: "month",
  run(s, ctx) {
    const xs = s.list("expense").filter((e) => e.status === "posted" && within(str(e.data.date), ctx.range!));
    const groups = groupSum(xs, (e) => s.title("account", e.data.account) || "Not categorised", (e) => num(e.data.amount));
    const total = groups.reduce((t, g) => t + g.value, 0);
    const top = groups[0];
    return {
      headline: { label: "Spent on expenses", value: total, unit: "money", text: top ? `Most on ${top.label}` : undefined },
      columns: [
        { key: "label", label: "Type", type: "text" },
        { key: "documents", label: "Expenses", type: "count" },
        { key: "amount", label: "Spent", type: "money" },
        { key: "share", label: "Share", type: "percent" },
      ],
      rows: groups.map((g) => ({ label: g.label, documents: g.count, amount: g.value, share: pct(g.value, total) })),
      totals: { label: "Total", documents: xs.length, amount: total, share: groups.length ? 100 : null },
      chart: { type: "bar", unit: "money", points: topPoints(groups) },
      note: "Posted expenses by expense account, as entered. Supplier bills are in Purchases by supplier.",
      empty: "No expenses in this period yet.",
    };
  },
};
