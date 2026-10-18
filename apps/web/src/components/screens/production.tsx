import Link from "next/link";
import { STOCK_MOVE, titleOf, type StoredRecord } from "@shapewise/runtime";
import { addDays, loadSnapshot, type Snapshot } from "@shapewise/runtime/reports";
import { cx } from "@shapewise/ui";
import { ActionButton } from "@/components/action-button";
import { formatValue } from "@/lib/format";
import { hrefFor, today, type Query } from "@/lib/screens";
import type { Workspace } from "@/lib/workspace";
import { Empty, Filters, MaybeLink, Pill, SelectField, Stat, Stats, Table, TextField, td, tdNum, th, thNum } from "./kit";

/**
 * Production screens: the floor (orders and batches as they move), the QC
 * queue, machine capacity, and lot traceability backwards to suppliers and
 * forwards to customers. Actions run through the normal pipeline.
 */

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const qty = (n: number) => n.toLocaleString("en-LK", { maximumFractionDigits: 3 });
const rows = (r: StoredRecord | undefined, key = "lines") => (Array.isArray(r?.data[key]) ? (r!.data[key] as Record<string, unknown>[]) : []);
const fmtDate = (d: unknown) => (typeof d === "string" ? formatValue({ type: "date" }, d, { currency: "" }) : "");

function can(ws: Workspace, target: string, action: Parameters<Workspace["compiled"]["can"]>[2]) {
  const t = ws.compiled.targets.get(target);
  return Boolean(t && ws.compiled.can(ws.actor.roleKey, t.submodule, action));
}

function made(s: Snapshot) {
  const out = new Map<string, number>();
  for (const b of s.list("batch")) {
    const o = str(b.data.production_order);
    if (o && b.status !== "rejected") out.set(o, (out.get(o) ?? 0) + num(b.data.output_quantity));
  }
  return out;
}

/* -------------------------------------------------------------------- floor */

const COLUMNS = [
  { key: "draft", label: "Draft" },
  { key: "scheduled", label: "Scheduled" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Done this week" },
] as const;
const BATCH_LIVE = new Set(["materials_issued", "in_process", "qc_hold"]);

export async function ProductionFloor({ ws }: { ws: Workspace }) {
  const s = await loadSnapshot(ws.store, ws.tenant, ws.compiled, ["production_order", "batch", "item", "resource", "recipe"]);
  const day = today(ws);
  const weekAgo = addDays(day, -7);
  const done = made(s);
  const ot = ws.compiled.targets.get("production_order")!;
  const bt = ws.compiled.targets.get("batch")!;
  const orders = s.list("production_order").filter((o) => o.status !== "cancelled" && (o.status !== "completed" || o.updatedAt.slice(0, 10) >= weekAgo));
  const late = orders.filter((o) => o.status !== "completed" && str(o.data.due_date) && String(o.data.due_date) < day);
  const live = s.list("batch").filter((b) => BATCH_LIVE.has(b.status ?? ""));
  const monthStart = `${day.slice(0, 7)}-01`;
  const monthBatches = s.list("batch").filter((b) => (str(b.data.mfg_date) ?? b.createdAt.slice(0, 10)) >= monthStart && b.status !== "draft");
  const good = monthBatches.reduce((t, b) => t + num(b.data.output_quantity), 0);
  const scrap = monthBatches.reduce((t, b) => t + num(b.data.scrap_quantity), 0);
  const canEdit = can(ws, "production_order", "edit");
  const canBatch = can(ws, "batch", "edit");

  return (
    <div className="space-y-5">
      <Stats>
        <Stat label="Open orders" value={orders.filter((o) => o.status === "scheduled" || o.status === "in_progress").length} />
        <Stat label="Batches on the floor" value={live.length} note={`${live.filter((b) => b.status === "qc_hold").length} waiting for QC`} />
        <Stat label="Late orders" value={late.length} tone={late.length ? "bad" : undefined} />
        <Stat label="Scrap this month" value={good + scrap > 0 ? `${((scrap / (good + scrap)) * 100).toFixed(1)}%` : "None"} note={good ? `${qty(good)} good, ${qty(scrap)} scrap` : undefined} />
      </Stats>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((c) => {
          const here = orders.filter((o) => o.status === c.key).sort((a, b) => String(a.data.due_date ?? "9").localeCompare(String(b.data.due_date ?? "9")));
          return (
            <section key={c.key} className="rounded-sw bg-surface-sunken/60 p-2">
              <h2 className="flex items-center justify-between px-1.5 py-1 text-sm font-medium">
                {c.label}
                <span className="text-xs text-ink-faint">{here.length}</span>
              </h2>
              <ul className="space-y-2">
                {here.length === 0 && <li className="px-1.5 py-4 text-center text-xs text-ink-faint">Nothing here</li>}
                {here.map((o) => {
                  const planned = num(o.data.planned_quantity);
                  const got = Math.max(num(o.data.completed_quantity), done.get(o.id) ?? 0);
                  const pct = planned > 0 ? Math.min(100, (got / planned) * 100) : 0;
                  const due = str(o.data.due_date);
                  const isLate = due && due < day && o.status !== "completed";
                  const batches = s.list("batch").filter((b) => b.data.production_order === o.id && BATCH_LIVE.has(b.status ?? ""));
                  return (
                    <li key={o.id} className="space-y-2 rounded-sw border bg-surface p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <MaybeLink href={hrefFor(ws, "production_order", o.id)} className="text-sm font-medium">
                          {titleOf(ot, o)}
                        </MaybeLink>
                        {due && <span className={cx("text-xs whitespace-nowrap", isLate ? "font-medium text-danger-fg" : "text-ink-faint")}>{isLate ? "Late, " : "Due "}{fmtDate(due)}</span>}
                      </div>
                      <p className="text-sm text-ink-muted">{s.title("item", o.data.item) || "No product"}</p>
                      <div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                          <div className={cx("h-full rounded-full", pct >= 100 ? "bg-success-fg" : "bg-accent")} style={{ width: `${pct}%` }} />
                        </div>
                        <p className="tabular mt-1 text-xs text-ink-faint">
                          {qty(got)} of {qty(planned)} made
                          {batches.length > 0 && ` · ${batches.length} ${batches.length === 1 ? "batch" : "batches"} running`}
                        </p>
                      </div>
                      {canEdit && (o.status === "scheduled" || o.status === "in_progress") && (
                        <div className="flex gap-1.5">
                          {o.status === "scheduled" && <ActionButton tenant={ws.tenant} target="production_order" id={o.id} version={o.version} action="start" label="Start" tone="primary" />}
                          {o.status === "in_progress" && <ActionButton tenant={ws.tenant} target="production_order" id={o.id} version={o.version} action="complete" label="Complete" />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Batches on the floor</h2>
        {live.length === 0 ? (
          <Empty>No batches are running. Add a batch from a production order to start.</Empty>
        ) : (
          <Table>
            <thead>
              <tr className="border-b">
                <th className={th}>Batch</th>
                <th className={th}>Product</th>
                <th className={th}>Machine</th>
                <th className={thNum}>Planned</th>
                <th className={thNum}>Good</th>
                <th className={th}>Stage</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {live.map((b) => {
                const o = s.get("production_order", b.data.production_order);
                const next = b.status === "materials_issued" ? { action: "start", label: "Start" } : b.status === "in_process" ? { action: "finish", label: "Record output" } : undefined;
                return (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className={td}>
                      <MaybeLink href={hrefFor(ws, "batch", b.id)} className="font-medium">
                        {titleOf(bt, b)}
                      </MaybeLink>
                    </td>
                    <td className={cx(td, "text-ink-muted")}>{s.title("item", o?.data.item)}</td>
                    <td className={cx(td, "text-ink-muted")}>{s.title("resource", b.data.machine)}</td>
                    <td className={tdNum}>{qty(num(b.data.planned_quantity))}</td>
                    <td className={tdNum}>{num(b.data.output_quantity) ? qty(num(b.data.output_quantity)) : ""}</td>
                    <td className={td}>
                      <Pill tone={b.status === "qc_hold" ? "warn" : "info"}>{bt.states.find((x) => x.key === b.status)?.label ?? b.status}</Pill>
                    </td>
                    <td className={td}>{canBatch && next && <ActionButton tenant={ws.tenant} target="batch" id={b.id} version={b.version} action={next.action} label={next.label} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------- quality control */

export async function QualityControl({ ws }: { ws: Workspace }) {
  const s = await loadSnapshot(ws.store, ws.tenant, ws.compiled, ["batch", "production_order", "item", "inspection", "goods_receipt", "lot", "resource"]);
  const day = today(ws);
  const bt = ws.compiled.targets.get("batch")!;
  const it = ws.compiled.targets.get("inspection");
  const waiting = s.list("batch").filter((b) => b.status === "qc_hold").sort((a, b) => String(a.data.mfg_date ?? a.createdAt).localeCompare(String(b.data.mfg_date ?? b.createdAt)));
  const pendingIn = it ? s.list("inspection").filter((i) => i.status === "pending") : [];
  const since = addDays(day, -30);
  const decided = s.list("batch").filter((b) => (b.status === "released" || b.status === "rejected") && b.updatedAt.slice(0, 10) >= since);
  const rejected = decided.filter((b) => b.status === "rejected").length;
  const canDecide = can(ws, "batch", "approve");
  const canInspect = can(ws, "inspection", "approve");
  const oldest = waiting[0] ? Math.max(0, Math.round((Date.parse(day) - Date.parse(String(waiting[0].data.mfg_date ?? waiting[0].createdAt).slice(0, 10))) / 86_400_000)) : 0;

  return (
    <div className="space-y-5">
      <Stats>
        <Stat label="Batches waiting" value={waiting.length} tone={waiting.length ? "warn" : undefined} note={waiting.length ? `Oldest ${oldest === 0 ? "made today" : `${oldest} ${oldest === 1 ? "day" : "days"} old`}` : undefined} />
        <Stat label="Incoming to inspect" value={pendingIn.length} />
        <Stat label="Decided, last 30 days" value={decided.length} />
        <Stat label="Pass rate, last 30 days" value={decided.length ? `${(((decided.length - rejected) / decided.length) * 100).toFixed(0)}%` : "None yet"} tone={decided.length && rejected / decided.length > 0.05 ? "bad" : undefined} />
      </Stats>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Batches waiting for release</h2>
        {waiting.length === 0 ? (
          <Empty>Nothing is on QC hold. Batches land here when their output is recorded.</Empty>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {waiting.map((b) => {
              const o = s.get("production_order", b.data.production_order);
              const checks = rows(b, "qc_results");
              const failed = checks.filter((c) => c.passed === false);
              const good = num(b.data.output_quantity);
              const scrap = num(b.data.scrap_quantity);
              return (
                <li key={b.id} className={cx("space-y-3 rounded-sw border bg-surface p-4", failed.length > 0 && "border-danger-fg/40")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <MaybeLink href={hrefFor(ws, "batch", b.id)} className="font-medium">
                      {titleOf(bt, b)}
                    </MaybeLink>
                    <span className="text-xs text-ink-faint">Made {fmtDate(b.data.mfg_date) || fmtDate(b.createdAt.slice(0, 10))}</span>
                  </div>
                  <p className="text-sm">
                    {s.title("item", o?.data.item) || "Product"}
                    <span className="text-ink-muted">
                      {" "}
                      · {qty(good)} good{scrap ? `, ${qty(scrap)} scrap (${((scrap / (good + scrap || 1)) * 100).toFixed(1)}%)` : ""}
                      {b.data.machine ? ` · ${s.title("resource", b.data.machine)}` : ""}
                    </span>
                  </p>
                  {checks.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {checks.map((c, i) => (
                        <li key={i}>
                          <Pill tone={c.passed === false ? "bad" : c.passed === true ? "good" : "neutral"}>
                            {String(c.check ?? "Check")}
                            {c.value ? `: ${String(c.value)}` : ""}
                          </Pill>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-faint">No checks recorded on the batch yet.</p>
                  )}
                  {canDecide && (
                    <div className="flex gap-2">
                      <ActionButton tenant={ws.tenant} target="batch" id={b.id} version={b.version} action="release" label="Release to stock" tone="primary" />
                      <ActionButton tenant={ws.tenant} target="batch" id={b.id} version={b.version} action="reject" label="Reject" tone="danger" confirm={`Reject ${titleOf(bt, b)}? The output is written off.`} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {it && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Incoming goods to inspect</h2>
          {pendingIn.length === 0 ? (
            <Empty>No deliveries are waiting for inspection.</Empty>
          ) : (
            <Table>
              <thead>
                <tr className="border-b">
                  <th className={th}>Item</th>
                  <th className={th}>Goods received</th>
                  <th className={th}>Lot</th>
                  <th className={thNum}>Sample</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {pendingIn.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className={td}>
                      <MaybeLink href={hrefFor(ws, "inspection", i.id)}>{s.title("item", i.data.item) || titleOf(it, i)}</MaybeLink>
                    </td>
                    <td className={cx(td, "text-ink-muted")}>
                      <MaybeLink href={str(i.data.goods_receipt) ? hrefFor(ws, "goods_receipt", String(i.data.goods_receipt)) : undefined}>{s.title("goods_receipt", i.data.goods_receipt)}</MaybeLink>
                    </td>
                    <td className={cx(td, "text-ink-muted")}>{s.title("lot", i.data.lot)}</td>
                    <td className={tdNum}>{num(i.data.sample_size) || ""}</td>
                    <td className={td}>
                      {canInspect && (
                        <span className="flex gap-1.5">
                          <ActionButton tenant={ws.tenant} target="inspection" id={i.id} version={i.version} action="pass" label="Pass" tone="primary" />
                          <ActionButton tenant={ws.tenant} target="inspection" id={i.id} version={i.version} action="fail" label="Fail" tone="danger" />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      )}

      {decided.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Recent decisions</h2>
          <ul className="divide-y rounded-sw border bg-surface text-sm">
            {decided
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .slice(0, 10)
              .map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 px-4 py-2">
                  <MaybeLink href={hrefFor(ws, "batch", b.id)}>{titleOf(bt, b)}</MaybeLink>
                  <span className="text-ink-muted">{s.title("item", s.get("production_order", b.data.production_order)?.data.item)}</span>
                  <span className="ml-auto">{b.status === "released" ? <Pill tone="good">Released</Pill> : <Pill tone="bad">Rejected</Pill>}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- capacity */

export async function Capacity({ ws, q }: { ws: Workspace; q: Query }) {
  const s = await loadSnapshot(ws.store, ws.tenant, ws.compiled, ["production_order", "batch", "recipe", "resource", "item"]);
  const day = today(ws);
  const horizon = [7, 14, 30].includes(Number(q.days)) ? Number(q.days) : 7;
  const until = addDays(day, horizon - 1);
  const done = made(s);
  const ot = ws.compiled.targets.get("production_order")!;
  const booked = new Map<string, { order: StoredRecord; hours: number }[]>();
  const unplanned: StoredRecord[] = [];
  for (const o of s.list("production_order")) {
    if (o.status !== "scheduled" && o.status !== "in_progress") continue;
    const start = str(o.data.start_date);
    if (start && start > until) continue;
    const recipe = s.get("recipe", o.data.recipe);
    const perRun = num(recipe?.data.output_quantity);
    const left = Math.max(0, num(o.data.planned_quantity) - (done.get(o.id) ?? 0));
    if (!left) continue;
    const ops = rows(recipe, "operations").filter((op) => str(op.machine) ?? str(op.work_centre));
    if (!recipe || perRun <= 0 || !ops.length) {
      unplanned.push(o);
      continue;
    }
    for (const op of ops) {
      const machine = (str(op.machine) ?? str(op.work_centre))!;
      const hours = (num(op.setup_minutes) + num(op.run_minutes) * (left / perRun)) / 60;
      booked.set(machine, [...(booked.get(machine) ?? []), { order: o, hours }]);
    }
  }
  const machines = s
    .list("resource")
    .filter((r) => r.status !== "archived" && (r.data.type === "machine" || r.data.type === "work_centre" || booked.has(r.id)))
    .map((m) => {
      const jobs = booked.get(m.id) ?? [];
      const hours = jobs.reduce((t, j) => t + j.hours, 0);
      const available = num(m.data.hours_per_day) * horizon;
      return { m, jobs, hours, available, load: available > 0 ? (hours / available) * 100 : hours > 0 ? Infinity : 0 };
    })
    .sort((a, b) => b.load - a.load);
  const totalH = machines.reduce((t, m) => t + m.hours, 0);
  const totalA = machines.reduce((t, m) => t + m.available, 0);
  const h = (n: number) => `${n.toLocaleString("en-LK", { maximumFractionDigits: 1 })} h`;

  return (
    <div className="space-y-5">
      <Filters>
        <SelectField name="days" label="Look ahead" value={String(horizon)} options={[{ value: "7", label: "Next 7 days" }, { value: "14", label: "Next 14 days" }, { value: "30", label: "Next 30 days" }]} />
      </Filters>
      <Stats>
        <Stat label="Hours booked" value={h(totalH)} />
        <Stat label="Hours available" value={h(totalA)} />
        <Stat label="Overall load" value={totalA ? `${((totalH / totalA) * 100).toFixed(0)}%` : "No hours set"} tone={totalA && totalH / totalA > 1 ? "bad" : undefined} />
        <Stat label="Over capacity" value={machines.filter((m) => m.load > 100).length} tone={machines.some((m) => m.load > 100) ? "bad" : undefined} note="Machines booked past their hours" />
      </Stats>
      {machines.length === 0 ? (
        <Empty>Add machines with their hours per day, and operations on your recipes, to see how loaded the floor is.</Empty>
      ) : (
        <ul className="space-y-2">
          {machines.map(({ m, jobs, hours, available, load }) => (
            <li key={m.id} className="rounded-sw border bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <MaybeLink href={hrefFor(ws, "resource", m.id)} className="font-medium">
                  {s.title("resource", m.id)}
                </MaybeLink>
                <span className={cx("tabular text-sm", load > 100 ? "font-medium text-danger-fg" : load > 85 ? "text-warning-fg" : "text-ink-muted")}>
                  {available ? `${h(hours)} of ${h(available)} · ${Number.isFinite(load) ? load.toFixed(0) : "∞"}%` : `${h(hours)} booked, no hours per day set`}
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-sunken" role="img" aria-label={`${Number.isFinite(load) ? load.toFixed(0) : "over"} percent loaded`}>
                <div className={cx("h-full rounded-full", load > 100 ? "bg-danger-fg" : load > 85 ? "bg-warning-fg" : "bg-accent")} style={{ width: `${Math.min(100, Number.isFinite(load) ? load : 100)}%` }} />
              </div>
              {jobs.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                  {jobs.map((j, i) => (
                    <li key={i}>
                      <MaybeLink href={hrefFor(ws, "production_order", j.order.id)}>{titleOf(ot, j.order)}</MaybeLink> {s.title("item", j.order.data.item)} <span className="tabular">{h(j.hours)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {unplanned.length > 0 && (
        <p className="text-sm text-ink-muted">
          {unplanned.length} open {unplanned.length === 1 ? "order isn't" : "orders aren't"} counted because the recipe has no machine operations or output quantity:{" "}
          {unplanned.map((o, i) => (
            <span key={o.id}>
              {i > 0 && ", "}
              <MaybeLink href={hrefFor(ws, "production_order", o.id)}>{titleOf(ot, o)}</MaybeLink>
            </span>
          ))}
          .
        </p>
      )}
      <p className="text-xs text-ink-faint">Hours still to run on scheduled and running orders that start within the period, from each recipe's setup and run times, against each machine's hours per day.</p>
    </div>
  );
}

/* ------------------------------------------------------------- traceability */

interface Node {
  key: string;
  label: string;
  detail: string;
  href?: string;
  kind: "lot" | "item" | "batch" | "supplier" | "customer" | "document";
  qty?: number;
  children: Node[];
}

const OUT_TO_CUSTOMER = new Set(["delivery_note", "invoice", "pos_sale", "credit_note"]);

export async function Traceability({ ws, q }: { ws: Workspace; q: Query }) {
  const s = await loadSnapshot(ws.store, ws.tenant, ws.compiled, [STOCK_MOVE, "lot", "batch", "item", "goods_receipt", "delivery_note", "invoice", "pos_sale", "credit_note", "customer", "vendor", "production_order"]);
  const moves = s.list(STOCK_MOVE);
  const term = (q.q ?? "").trim().toLowerCase();
  const lt = ws.compiled.targets.get("lot");
  const bt = ws.compiled.targets.get("batch")!;
  const lots = s.list("lot");
  const batches = s.list("batch");
  const lotHits = term ? lots.filter((l) => `${l.data.lot_no ?? ""} ${l.data.supplier_lot_no ?? ""}`.toLowerCase().includes(term)) : [];
  const batchHits = term ? batches.filter((b) => titleOf(bt, b).toLowerCase().includes(term)) : [];
  const pick = q.lot ? lots.find((l) => l.id === q.lot) : q.batch ? undefined : lotHits.length === 1 && !batchHits.length ? lotHits[0] : undefined;
  const pickBatch = q.batch ? batches.find((b) => b.id === q.batch) : !pick && batchHits.length === 1 && !lotHits.length ? batchHits[0] : undefined;

  const lotLabel = (id: string) => (lt ? titleOf(lt, s.get("lot", id) ?? ({ data: {} } as StoredRecord)) : id) || "Lot";
  const docLabel = (target: string, id: string, number: unknown) => (typeof number === "string" && number) || s.title(target, id) || target;

  // Outputs of a batch are the lots it put into stock; its inputs are the lots it drew. Releasing or rejecting
  // a batch only moves its output off QC hold, so those moves aren't part of the trail.
  const ofBatch = (id: string) => moves.filter((m) => m.data.source_target === "batch" && m.data.source_id === id && m.data.action !== "release" && m.data.action !== "reject");
  const batchIn = (id: string) => ofBatch(id).filter((m) => num(m.data.qty) < 0);
  const batchOutMoves = (id: string) => ofBatch(id).filter((m) => num(m.data.qty) > 0);
  const batchOut = (id: string) => [...new Set(batchOutMoves(id).filter((m) => m.data.lot).map((m) => String(m.data.lot)))];
  // Goods without lots can be shown but not followed: the trail ends there.
  const untracked = (m: StoredRecord, q: number): Node => ({ key: `i${m.id}`, kind: "item", label: s.title("item", m.data.item), detail: "Not lot tracked, so it can't be followed further", qty: q, children: [] });

  function back(lot: string, depth: number, seen: Set<string>): Node[] {
    if (depth > 4 || seen.has(lot)) return [];
    seen.add(lot);
    const ins = moves.filter((m) => m.data.lot === lot && num(m.data.qty) > 0 && m.data.kind !== "transfer");
    const out: Node[] = [];
    for (const m of ins) {
      const target = String(m.data.source_target);
      const id = String(m.data.source_id);
      if (target === "batch") {
        const b = s.get("batch", id);
        out.push({ key: `b${id}`, kind: "batch", label: b ? titleOf(bt, b) : "Batch", detail: `Made ${fmtDate(b?.data.mfg_date)}`, href: hrefFor(ws, "batch", id), qty: num(m.data.qty), children: batchIn(id).map((x) => (x.data.lot ? { key: `l${x.data.lot}`, kind: "lot" as const, label: lotLabel(String(x.data.lot)), detail: s.title("item", x.data.item), href: hrefFor(ws, "lot", String(x.data.lot)), qty: -num(x.data.qty), children: back(String(x.data.lot), depth + 1, seen) } : untracked(x, -num(x.data.qty)))) });
      } else {
        const doc = s.get(target, id);
        const vendor = doc?.data.vendor;
        out.push({ key: `d${id}`, kind: vendor ? "supplier" : "document", label: docLabel(target, id, m.data.source_number), detail: vendor ? s.title("vendor", vendor) : String(m.data.action ?? ""), href: hrefFor(ws, target, id), qty: num(m.data.qty), children: [] });
      }
    }
    return out;
  }

  function forward(lot: string, depth: number, seen: Set<string>): Node[] {
    if (depth > 4 || seen.has(lot)) return [];
    seen.add(lot);
    const outs = moves.filter((m) => m.data.lot === lot && num(m.data.qty) < 0 && m.data.kind !== "transfer");
    const res: Node[] = [];
    for (const m of outs) {
      const target = String(m.data.source_target);
      const id = String(m.data.source_id);
      if (target === "batch") {
        const b = s.get("batch", id);
        res.push({ key: `b${id}`, kind: "batch", label: b ? titleOf(bt, b) : "Batch", detail: "Used as material", href: hrefFor(ws, "batch", id), qty: -num(m.data.qty), children: batchOut(id).map((l) => ({ key: `l${l}`, kind: "lot" as const, label: lotLabel(l), detail: "Output", href: hrefFor(ws, "lot", l), children: forward(l, depth + 1, seen) })) });
      } else {
        const doc = s.get(target, id);
        const customer = doc?.data.customer;
        res.push({ key: `d${id}`, kind: OUT_TO_CUSTOMER.has(target) ? "customer" : "document", label: docLabel(target, id, m.data.source_number), detail: customer ? s.title("customer", customer) : target === "pos_sale" ? "Counter sale" : String(m.data.action ?? ""), href: hrefFor(ws, target, id), qty: -num(m.data.qty), children: [] });
      }
    }
    return res;
  }

  let title: React.ReactNode = null;
  let backward: Node[] = [];
  let fwd: Node[] = [];
  if (pick) {
    title = (
      <>
        Lot <MaybeLink href={hrefFor(ws, "lot", pick.id)}>{lotLabel(pick.id)}</MaybeLink> · {s.title("item", pick.data.item)}
        {pick.data.expiry_date ? <span className="text-ink-muted"> · expires {fmtDate(pick.data.expiry_date)}</span> : null}
      </>
    );
    backward = back(pick.id, 0, new Set());
    fwd = forward(pick.id, 0, new Set());
  } else if (pickBatch) {
    const o = s.get("production_order", pickBatch.data.production_order);
    title = (
      <>
        Batch <MaybeLink href={hrefFor(ws, "batch", pickBatch.id)}>{titleOf(bt, pickBatch)}</MaybeLink> · {s.title("item", o?.data.item)}
      </>
    );
    const seenB = new Set<string>();
    backward = batchIn(pickBatch.id).map((x) => (x.data.lot ? { key: `l${x.data.lot}`, kind: "lot" as const, label: lotLabel(String(x.data.lot)), detail: s.title("item", x.data.item), href: hrefFor(ws, "lot", String(x.data.lot)), qty: -num(x.data.qty), children: back(String(x.data.lot), 1, seenB) } : untracked(x, -num(x.data.qty))));
    const seenF = new Set<string>();
    fwd = [
      ...batchOut(pickBatch.id).map((l) => ({ key: `l${l}`, kind: "lot" as const, label: lotLabel(l), detail: "Output", href: hrefFor(ws, "lot", l), children: forward(l, 1, seenF) })),
      ...batchOutMoves(pickBatch.id).filter((m) => !m.data.lot).map((m) => untracked(m, num(m.data.qty))),
    ];
  }
  const customers = new Set<string>();
  const collect = (ns: Node[]) => ns.forEach((n) => (n.kind === "customer" && customers.add(n.detail), collect(n.children)));
  collect(fwd);

  return (
    <div className="space-y-5">
      <Filters submit="Trace">
        <TextField name="q" label="Lot or batch number" value={q.q} placeholder="e.g. a lot number or B2610-0004" />
      </Filters>
      {!term && !pick && !pickBatch ? (
        <Empty>Search for a lot or batch to see where it came from (suppliers and materials) and where it went (batches and customers). Useful for a recall: one search shows every customer who got the affected goods.</Empty>
      ) : !pick && !pickBatch ? (
        lotHits.length + batchHits.length === 0 ? (
          <Empty>No lot or batch matches “{q.q}”.</Empty>
        ) : (
          <ul className="divide-y rounded-sw border bg-surface text-sm">
            {lotHits.slice(0, 30).map((l) => (
              <li key={l.id}>
                <Link href={`?lot=${l.id}&q=${encodeURIComponent(q.q ?? "")}` as never} className="flex justify-between px-4 py-2 hover:bg-surface-sunken">
                  <span>Lot {lotLabel(l.id)}</span>
                  <span className="text-ink-muted">{s.title("item", l.data.item)}</span>
                </Link>
              </li>
            ))}
            {batchHits.slice(0, 30).map((b) => (
              <li key={b.id}>
                <Link href={`?batch=${b.id}&q=${encodeURIComponent(q.q ?? "")}` as never} className="flex justify-between px-4 py-2 hover:bg-surface-sunken">
                  <span>Batch {titleOf(bt, b)}</span>
                  <span className="text-ink-muted">{s.title("item", s.get("production_order", b.data.production_order)?.data.item)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <h2 className="text-base font-medium">{title}</h2>
          {customers.size > 0 && (
            <p className="rounded-sw bg-info-bg px-3 py-2 text-sm text-info-fg">
              Reached {customers.size} {customers.size === 1 ? "customer" : "customers"}: {[...customers].join(", ")}.
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Where it came from</h3>
              {backward.length ? <Tree nodes={backward} /> : <Empty>No incoming movements recorded for this.</Empty>}
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Where it went</h3>
              {fwd.length ? <Tree nodes={fwd} /> : <Empty>Nothing has left stock from this yet.</Empty>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

const KIND: Record<Node["kind"], string> = { lot: "Lot", item: "Item", batch: "Batch", supplier: "From supplier", customer: "To customer", document: "Document" };

function Tree({ nodes }: { nodes: Node[] }) {
  return (
    <ul className="space-y-1.5">
      {nodes.map((n, i) => (
        <li key={`${n.key}-${i}`}>
          <div className={cx("flex flex-wrap items-baseline gap-x-2 rounded-sw border bg-surface px-3 py-2 text-sm", n.kind === "customer" && "border-info-fg/40", n.kind === "supplier" && "border-success-fg/40")}>
            <span className="text-[11px] tracking-wide text-ink-faint uppercase">{KIND[n.kind]}</span>
            <MaybeLink href={n.href} className="font-medium">
              {n.label}
            </MaybeLink>
            <span className="text-ink-muted">{n.detail}</span>
            {n.qty !== undefined && <span className="tabular ml-auto text-xs text-ink-faint">{qty(n.qty)}</span>}
          </div>
          {n.children.length > 0 && (
            <div className="mt-1.5 ml-4 border-l pl-3">
              <Tree nodes={n.children} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
