import { describe, expect, it, vi } from "vitest";
import { Blueprint, applyOps } from "@shapewise/blueprint";
import { bakery } from "@shapewise/blueprint/fixtures";
import { compile, type StoredRecord } from "@shapewise/runtime";
import { buildDocument, documentMessage } from "./model";

vi.mock("server-only", () => ({}));

const base = Blueprint.parse(bakery);
const withBusiness = applyOps(base, [{ op: "set_business", patch: { address: "12 Church Street, Galle", phone: "091 222 3344", vatNo: "123456789-7000" } }]);
if (!withBusiness.ok) throw new Error("setup");
const bp = withBusiness.blueprint;
const compiled = compile(bp);
const invoice = compiled.targets.get("invoice")!;
const customerT = compiled.targets.get("customer")!;

const rec = (target: string, data: Record<string, unknown>, status = "posted"): StoredRecord => ({
  id: `${target}1`, target, data, status, version: 1, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", createdBy: "u", updatedBy: "u", links: [],
});

const customer = rec("customer", { name: "Lighthouse Cafe", legal_name: "Lighthouse Cafe (Pvt) Ltd", vat_no: "987654321-7000", address: "5 Lighthouse Street, Galle", phone: "0771234567", email: "accounts@lighthouse.lk" }, "active");
const inv = rec("invoice", {
  number: "INV-2026-00001",
  date: "2026-10-01",
  due_date: "2026-10-31",
  customer: "customer1",
  lines: [
    { item: "item1", description: "Sourdough loaf, sliced", quantity: 20, unit_price: 45000, discount_pct: 0, amount: 900000 },
    { item: "item2", quantity: 5, unit_price: 120000, discount_pct: 0, amount: 600000 },
  ],
  sub_total: 1500000,
  tax_total: 270000,
  total: 1770000,
  amount_due: 770000,
  notes: "Delivered to the back door.",
});
const refs = { customer1: "Lighthouse Cafe", item1: "Sourdough", item2: "Butter cake" };

describe("document model", () => {
  const doc = buildDocument({ bp, t: invoice, rec: inv, refs, party: { field: invoice.fields.find((f) => f.key === "customer")!, rec: customer, t: customerT } });

  it("shows the business and who the invoice is for", () => {
    expect(doc.title).toBe("Invoice");
    expect(doc.number).toBe("INV-2026-00001");
    expect(doc.business.lines).toEqual(expect.arrayContaining(["12 Church Street, Galle", expect.stringContaining("VAT 123456789-7000")]));
    expect(doc.party).toMatchObject({ heading: "Bill to", name: "Lighthouse Cafe (Pvt) Ltd" });
    expect(doc.party!.lines).toEqual(expect.arrayContaining(["5 Lighthouse Street, Galle", expect.stringContaining("VAT 987654321-7000")]));
  });

  it("lists lines with the item and its description together, leaving unused columns off", () => {
    expect(doc.columns.map((c) => c.key)).toEqual(["item", "quantity", "unit_price", "amount"]);
    expect(doc.rows[0]!.item).toBe("Sourdough\nSourdough loaf, sliced");
    expect(doc.rows[1]!.item).toBe("Butter cake");
  });

  it("totals with tax, what was paid and the balance", () => {
    expect(doc.totals.map((t) => t.label)).toEqual(["Sub total", "Tax", "Total", "Paid", "Balance due"]);
    expect(doc.totals.at(-1)!.value).toContain("7,700.00");
    expect(doc.meta.map((m) => m.label)).toEqual(expect.arrayContaining(["Date", "Due date"]));
    expect(doc.meta.some((m) => m.label === "Customer" || m.label === "Total")).toBe(false);
    expect(doc.notes).toBe("Delivered to the back door.");
  });

  it("marks drafts, and writes a message with the link", () => {
    const draft = buildDocument({ bp, t: invoice, rec: { ...inv, status: "draft" }, refs });
    expect(draft.status).toBe("Draft");
    expect(draft.party?.name).toBe("Lighthouse Cafe");
    expect(documentMessage(doc, "https://x.test/d/abc")).toMatch(/^Hello Lighthouse Cafe \(Pvt\) Ltd,[\s\S]*invoice INV-2026-00001 from .* for Rs[\s\S]*https:\/\/x\.test\/d\/abc/);
  });

  it("uses the tax invoice layout when the template asks for it", () => {
    const r = applyOps(bp, [{ op: "add", collection: "documents", value: { id: "doc_tax_invoice", record: "invoice", label: "Tax invoice", layout: "ird_tax_invoice", default: true } } as never]);
    const tbp = r.ok ? r.blueprint : { ...bp, documents: [{ id: "doc_tax_invoice", record: "invoice" as const, label: "Tax invoice", layout: "ird_tax_invoice" as const, extraFields: [], showLots: false, default: true }] };
    const tdoc = buildDocument({ bp: tbp, t: invoice, rec: inv, refs });
    expect(tdoc.title).toBe("Tax invoice");
    expect(tdoc.totals.map((t) => t.label)).toEqual(expect.arrayContaining(["Value excluding tax", "VAT"]));
  });

  it("renders a PDF", async () => {
    const { renderPdf, pdfName } = await import("./pdf");
    const pdf = await renderPdf(doc);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1500);
    expect(pdfName(doc)).toMatch(/^INV-2026-00001 .+\.pdf$/);
  }, 30000);
});

describe("share links", () => {
  it("opens the record it was made for, and nothing else", async () => {
    process.env.SW_SHARE_SECRET = "test-secret-at-least-16";
    const { readShareToken, shareToken } = await import("./share");
    const token = shareToken("galle-bakehouse", "invoice", "abc123");
    expect(readShareToken(token)).toMatchObject({ tenant: "galle-bakehouse", target: "invoice", id: "abc123" });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify(["galle-bakehouse", "invoice", "other", 9999999999])).toString("base64url");
    expect(readShareToken(`${forged}.${sig}`)).toBeNull();
    expect(readShareToken(`${body}.${sig!.slice(0, -1)}x`)).toBeNull();
    expect(readShareToken(token, Date.now() + 31 * 86400_000)).toBeNull();
  });
});
