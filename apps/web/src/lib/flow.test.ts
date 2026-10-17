import { describe, expect, it } from "vitest";
import { Blueprint, applyOps, presetBlueprint } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import { flowGraph, summarise } from "./blueprint-summary";

const bp = Blueprint.parse(plasticsFactory);

describe("flow graph", () => {
  it("chains the documents in order, with what each one moves", () => {
    const g = flowGraph(bp);
    const layer = (id: string) => g.nodes.find((n) => n.id === id)?.layer ?? -1;
    expect(layer("quote")).toBeLessThan(layer("sales_order"));
    expect(layer("sales_order")).toBeLessThan(layer("invoice"));
    expect(g.edges.some((e) => e.from === "sales_order" && e.to === "delivery_note")).toBe(true);
    expect(g.nodes.find((n) => n.id === "delivery_note")?.effects).toContain("stock");
    expect(g.edges.filter((e) => e.kind === "convert" || e.kind === "link").every((e) => layer(e.to) > layer(e.from))).toBe(true);
  });

  it("changes when a screen is switched off", () => {
    const off = applyOps(bp, [{ op: "set_submodule", key: "delivery_notes", enabled: false }]);
    if (!off.ok) throw new Error(off.issues[0]?.message);
    expect(flowGraph(off.blueprint).nodes.some((n) => n.id === "delivery_note")).toBe(false);
    const s = summarise(off.blueprint).modules.find((m) => m.key === "sales")!;
    expect(s.screens.find((x) => x.key === "delivery_notes")).toMatchObject({ on: false, canHide: true });
  });

  it("lists each screen's fields, marking custom and line fields", () => {
    const so = summarise(bp).modules.find((m) => m.key === "sales")!.screens.find((x) => x.key === "sales_orders")!;
    expect(so.fields.some((f) => f.line)).toBe(true);
    expect(so.fields.some((f) => f.custom)).toBe(true);
  });
});

describe("stock and money", () => {
  const arc = (f: { arcs: { from: string; to: string; documents: string[] }[] }, from: string, to: string) => f.arcs.find((a) => a.from === from && a.to === to)?.documents ?? [];

  it("shows goods moving through the stores, with the documents that move them", () => {
    const g = flowGraph(bp);
    // With incoming inspection on, goods wait at incoming checks until inspected.
    expect(arc(g.stock, "suppliers", "incoming")).toContain("Goods received");
    expect(arc(g.stock, "incoming", "raw")).toContain("Incoming inspection");
    expect(arc(g.stock, "raw", "wip")).toContain("Batches");
    expect(arc(g.stock, "finished", "customers")).toContain("Delivery notes");
    expect(g.stock.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["suppliers", "incoming", "raw", "wip", "quarantine", "finished", "customers"]));
    // A credit note reverses the sale and the cost separately: it never links what customers owe to stock value.
    expect(arc(g.money, "receivables", "stock")).toEqual([]);
  });

  it("shows value moving between accounts: sales to what customers owe, then to the bank", () => {
    const g = flowGraph(bp);
    expect(arc(g.money, "trading", "receivables")).toContain("Invoices");
    expect(arc(g.money, "receivables", "bank")).toContain("Payments received");
    expect(arc(g.money, "bank", "payables")).toContain("Payments made");
    expect(g.effects.find((e) => e.document === "Invoices")!.debits).toEqual(["Receivables"]);
  });

  it("shows VAT only when registered, and one store for traders", () => {
    const vat = applyOps(bp, [{ op: "set_setting", path: "tax.vatRegistered", value: true }]);
    const novat = applyOps(bp, [{ op: "set_setting", path: "tax.vatRegistered", value: false }]);
    if (!vat.ok || !novat.ok) throw new Error("setup");
    expect(flowGraph(vat.blueprint).effects.find((e) => e.document === "Invoices")!.credits).toContain("VAT collected");
    expect(flowGraph(novat.blueprint).effects.find((e) => e.document === "Invoices")!.credits).not.toContain("VAT collected");
    const trader = Blueprint.parse(presetBlueprint("distribution", { name: "Kandy Hardware", currency: "LKR", locale: "en-LK", timezone: "Asia/Colombo" }));
    const stores = flowGraph(trader).stock.nodes.map((n) => n.label);
    expect(stores).toContain("Stock on hand");
    expect(stores).not.toContain("Work in progress");
  });
});
