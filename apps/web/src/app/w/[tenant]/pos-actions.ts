"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { titleOf } from "@shapewise/runtime";
import { executeIn, loadWorkspace, type Workspace } from "@/lib/workspace";

/**
 * The till. A cashier opens a shift with a float, rings up sales into it,
 * and closes it with a cash count; closing posts the shift's takings and
 * stock to the books in one entry. Every step is an ordinary command, so
 * permissions, numbering and the audit log work as everywhere else.
 */

export interface TerminalItem {
  id: string;
  name: string;
  sku?: string;
  group: string;
  /** Minor units. */
  price: number;
  unit?: string;
  onHand?: number;
  taxCode?: string;
}

export interface TerminalShift {
  id: string;
  version: number;
  terminal: string;
  openedAt: string;
  float: number;
  sales: number;
  takings: { cash: number; card: number; qr: number; total: number };
}

export interface TerminalView {
  canSell: boolean;
  currency: string;
  shift: TerminalShift | null;
  items: TerminalItem[];
  customers: { id: string; name: string }[];
  recent: { id: string; number: string; at: string; total: number; tender: string }[];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

async function context(tenant: string) {
  const ws = await loadWorkspace(tenant);
  return { ws, canSell: ws.compiled.can(ws.actor.roleKey, "pos_terminal", "create") };
}

/** This cashier's open shift, if any. */
async function openShift(ws: Workspace) {
  const shifts = await ws.store.read(ws.tenant, (tx) => tx.list("pos_shift"));
  return shifts.filter((s) => s.status === "open" && s.data.cashier === ws.actor.id).sort((a, b) => String(b.data.opened_at).localeCompare(String(a.data.opened_at)))[0];
}

export async function loadTerminal(tenant: string): Promise<TerminalView> {
  const { ws, canSell } = await context(tenant);
  const [items, customers, sales] = await ws.store.read(ws.tenant, async (tx) => [await tx.list("item"), await tx.list("customer"), await tx.list("pos_sale")] as const);
  const shift = await openShift(ws);
  const it = ws.compiled.targets.get("item")!;
  const ct = ws.compiled.targets.get("customer");
  const inShift = shift ? sales.filter((s) => s.data.shift === shift.id && s.status === "completed") : [];
  const takings = { cash: 0, card: 0, qr: 0, total: 0 };
  for (const s of inShift) {
    const total = num(s.data.total);
    takings.total += total;
    const k = s.data.tender === "card" ? "card" : s.data.tender === "qr" ? "qr" : "cash";
    takings[k] += total;
  }
  return {
    canSell,
    currency: ws.bp.business.currency,
    shift: shift
      ? { id: shift.id, version: shift.version, terminal: String(shift.data.terminal ?? "Till"), openedAt: String(shift.data.opened_at ?? shift.createdAt), float: num(shift.data.opening_float), sales: inShift.length, takings }
      : null,
    items: items
      .filter((i) => i.status !== "archived" && num(i.data.sales_price) > 0)
      .map((i) => ({
        id: i.id,
        name: titleOf(it, i),
        sku: typeof i.data.sku === "string" ? i.data.sku : undefined,
        group: typeof i.data.item_class === "string" && i.data.item_class ? i.data.item_class : i.data.type === "service" ? "Services" : "Items",
        price: num(i.data.sales_price),
        unit: typeof i.data.unit === "string" ? i.data.unit : undefined,
        onHand: i.data.track_inventory ? num(i.data.on_hand) : undefined,
        taxCode: typeof i.data.tax_code === "string" ? i.data.tax_code : undefined,
      }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)),
    customers: customers.filter((c) => c.status !== "archived").map((c) => ({ id: c.id, name: ct ? titleOf(ct, c) : String(c.data.name ?? "Customer") })).sort((a, b) => a.name.localeCompare(b.name)),
    recent: inShift
      .sort((a, b) => String(b.data.at).localeCompare(String(a.data.at)))
      .slice(0, 8)
      .map((s) => ({ id: s.id, number: String(s.data.number ?? s.number ?? ""), at: String(s.data.at ?? s.createdAt), total: num(s.data.total), tender: String(s.data.tender ?? "cash") })),
  };
}

type Result = { ok: boolean; message?: string; id?: string };

function failed(r: Awaited<ReturnType<typeof executeIn>>): Result {
  if (r.status === "ok") return { ok: true, id: r.recordId };
  if (r.status === "pending_approval") return { ok: false, message: `This needs approval first. ${r.reason}` };
  return { ok: false, message: r.error.message };
}

export async function startShift(tenant: string, input: { float: number; terminal: string }): Promise<Result> {
  const { ws, canSell } = await context(tenant);
  if (!canSell) return { ok: false, message: "Your role can't use the till." };
  if (await openShift(ws)) return { ok: false, message: "You already have a shift open." };
  const p = z.object({ float: z.number().min(0).max(100_000_000), terminal: z.string().trim().min(1).max(40) }).safeParse(input);
  if (!p.success) return { ok: false, message: "Enter the cash in the drawer." };
  const r = await executeIn(ws, { type: "record.create", target: "pos_shift", data: { terminal: p.data.terminal, cashier: ws.actor.id, opened_at: new Date().toISOString(), opening_float: p.data.float } });
  revalidatePath(`/w/${tenant}`, "layout");
  return failed(r);
}

const Sale = z.object({
  tender: z.enum(["cash", "card", "qr"]),
  customer: z.string().max(80).optional(),
  lines: z.array(z.object({ item: z.string().min(1).max(80), quantity: z.number().positive().max(100_000) })).min(1).max(200),
});

/** Rings up a sale at the item's own price and tax. Prices come from the item records, never the browser. */
export async function ringUp(tenant: string, input: z.infer<typeof Sale>): Promise<Result & { number?: string; total?: number }> {
  const { ws, canSell } = await context(tenant);
  if (!canSell) return { ok: false, message: "Your role can't use the till." };
  const p = Sale.safeParse(input);
  if (!p.success) return { ok: false, message: "Add something to the sale first." };
  const shift = await openShift(ws);
  if (!shift) return { ok: false, message: "Open a shift before selling." };
  const items = new Map((await ws.store.read(ws.tenant, (tx) => tx.list("item"))).map((i) => [i.id, i]));
  const lines = [];
  for (const l of p.data.lines) {
    const it = items.get(l.item);
    if (!it || it.status === "archived") return { ok: false, message: "One of the items is no longer for sale." };
    lines.push({ item: it.id, description: String(it.data.name ?? ""), quantity: l.quantity, unit_price: num(it.data.sales_price) / 100, tax_code: it.data.tax_code ?? undefined });
  }
  const r = await executeIn(ws, { type: "record.create", target: "pos_sale", data: { at: new Date().toISOString(), shift: shift.id, tender: p.data.tender, customer: p.data.customer || undefined, lines } });
  if (r.status !== "ok") return failed(r);
  const sale = await ws.store.read(ws.tenant, (tx) => tx.get("pos_sale", r.recordId!));
  revalidatePath(`/w/${tenant}`, "layout");
  return { ok: true, id: r.recordId, number: String(sale?.data.number ?? sale?.number ?? ""), total: num(sale?.data.total) };
}

/** Counts the drawer and closes the shift, which posts its takings and stock. */
export async function endShift(tenant: string, input: { counted: number }): Promise<Result & { variance?: number }> {
  const { ws, canSell } = await context(tenant);
  if (!canSell) return { ok: false, message: "Your role can't use the till." };
  const counted = z.number().min(0).max(100_000_000).safeParse(input.counted);
  if (!counted.success) return { ok: false, message: "Enter the cash you counted." };
  const shift = await openShift(ws);
  if (!shift) return { ok: false, message: "There's no open shift to close." };
  const u = await executeIn(ws, { type: "record.update", target: "pos_shift", recordId: shift.id, patch: { counted_cash: counted.data }, expectedVersion: shift.version });
  if (u.status !== "ok") return failed(u);
  const fresh = await ws.store.read(ws.tenant, (tx) => tx.get("pos_shift", shift.id));
  const r = await executeIn(ws, { type: "record.action", target: "pos_shift", recordId: shift.id, action: "close", expectedVersion: fresh?.version });
  revalidatePath(`/w/${tenant}`, "layout");
  if (r.status !== "ok") return failed(r);
  const closed = await ws.store.read(ws.tenant, (tx) => tx.get("pos_shift", shift.id));
  return { ok: true, id: shift.id, variance: num(closed?.data.variance) };
}
