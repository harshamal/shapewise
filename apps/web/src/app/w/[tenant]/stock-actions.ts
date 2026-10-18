"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { executeIn, loadWorkspace } from "@/lib/workspace";

/**
 * Turns reorder suggestions into a draft purchase order for one supplier, at
 * each item's purchase price, then opens it to check and issue. Nothing is
 * sent to the supplier until someone issues the order.
 */
export async function draftReorder(tenant: string, vendor: string, lines: { item: string; quantity: number }[]): Promise<void> {
  const ws = await loadWorkspace(tenant);
  const p = z.object({ vendor: z.string().min(1).max(80), lines: z.array(z.object({ item: z.string().min(1).max(80), quantity: z.number().positive().max(10_000_000) })).min(1).max(100) }).parse({ vendor, lines });
  const items = new Map((await ws.store.read(ws.tenant, (tx) => tx.list("item"))).map((i) => [i.id, i]));
  const r = await executeIn(ws, {
    type: "record.create",
    target: "purchase_order",
    data: {
      vendor: p.vendor,
      date: new Intl.DateTimeFormat("en-CA", { timeZone: ws.bp.business.timezone }).format(new Date()),
      notes: "Drafted from reorder suggestions.",
      lines: p.lines.map((l) => {
        const it = items.get(l.item);
        const price = typeof it?.data.purchase_price === "number" ? it.data.purchase_price / 100 : undefined;
        return { item: l.item, description: String(it?.data.name ?? ""), quantity: l.quantity, unit_price: price, tax_code: it?.data.tax_code ?? undefined };
      }),
    },
  });
  const t = ws.compiled.targets.get("purchase_order")!;
  const list = `${ws.base}/${t.module}/${t.submodule}`;
  if (r.status !== "ok") redirect(`${ws.base}/inventory/reorder?error=${encodeURIComponent(r.status === "error" ? r.error.message : "That needs approval first.")}` as never);
  redirect(`${list}/${r.recordId}?note=${encodeURIComponent("Drafted from reorder suggestions. Check the quantities and prices, then issue it.")}` as never);
}

/** The same, when the person picks the supplier on the form. */
export async function draftReorderPicked(tenant: string, lines: { item: string; quantity: number }[], form: FormData): Promise<void> {
  const vendor = String(form.get("vendor") ?? "");
  if (vendor) await draftReorder(tenant, vendor, lines);
}
