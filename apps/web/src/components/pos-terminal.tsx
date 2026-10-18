"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button, cx } from "@shapewise/ui";
import { endShift, loadTerminal, ringUp, startShift, type TerminalItem, type TerminalView } from "@/app/w/[tenant]/pos-actions";
import { formatMoney } from "@/lib/format";

type Tender = "cash" | "card" | "qr";
interface Line {
  item: TerminalItem;
  qty: number;
}

/**
 * The counter screen: tap items, take payment, print the receipt. Built for
 * a touch screen or a keyboard (type to search, Enter adds the top match).
 * Prices come from the items; the server prices the sale again.
 */
export function PosTerminal({ tenant }: { tenant: string }) {
  const [view, setView] = useState<TerminalView | null>(null);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // What the last shift close said (over or short), kept after the till goes back to closed.
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = async () => setView(await loadTerminal(tenant));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  if (!view) return <p className="animate-shimmer text-sm">Opening the till</p>;
  if (!view.canSell) return <p className="rounded-sw border bg-surface px-6 py-12 text-center text-sm text-ink-muted">Your role can't use the till. An owner can allow it in role permissions.</p>;
  const money = (n: number) => formatMoney(n, view.currency);

  if (!view.shift)
    return (
      <div className="space-y-4">
        {notice && (
          <p role="status" className="mx-auto max-w-sm rounded-xl bg-success-bg px-4 py-3 text-sm text-success-fg">
            {notice}
          </p>
        )}
        <OpenShift
          busy={busy}
          error={error}
          money={money}
          onOpen={(float, terminal) =>
            start(async () => {
              const r = await startShift(tenant, { float, terminal });
              setError(r.ok ? null : (r.message ?? "Couldn't open the shift."));
              if (r.ok) setNotice(null);
              await refresh();
            })
          }
        />
      </div>
    );

  return <Counter tenant={tenant} view={view} money={money} refresh={refresh} onClosed={setNotice} />;
}

function OpenShift({ busy, error, money, onOpen }: { busy: boolean; error: string | null; money: (n: number) => string; onOpen: (float: number, terminal: string) => void }) {
  const [float, setFloat] = useState("5000");
  const [terminal, setTerminal] = useState("Counter 1");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onOpen(Number(float) || 0, terminal);
      }}
      className="mx-auto max-w-sm space-y-4 rounded-2xl border bg-surface p-6"
    >
      <div>
        <h2 className="font-medium">Open the till</h2>
        <p className="mt-0.5 text-sm text-ink-muted">Count the cash in the drawer to start your shift.</p>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="text-ink-muted">Till</span>
        <input value={terminal} onChange={(e) => setTerminal(e.target.value)} className="h-10 rounded-sw border border-border-strong bg-canvas px-3 outline-none focus:border-focus" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-ink-muted">Cash in the drawer</span>
        <input inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value.replace(/[^\d.]/g, ""))} className="tabular h-10 rounded-sw border border-border-strong bg-canvas px-3 text-lg outline-none focus:border-focus" />
        <span className="text-xs text-ink-faint">{money(Math.round((Number(float) || 0) * 100))}</span>
      </label>
      {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Opening…" : "Start shift"}
      </Button>
    </form>
  );
}

function Counter({ tenant, view, money, refresh, onClosed }: { tenant: string; view: TerminalView; money: (n: number) => string; refresh: () => Promise<void>; onClosed: (message: string) => void }) {
  const shift = view.shift!;
  const [busy, start] = useTransition();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [tender, setTender] = useState<Tender>("cash");
  const [given, setGiven] = useState("");
  const [customer, setCustomer] = useState("");
  const [done, setDone] = useState<{ id: string; number: string; total: number; change: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const search = useRef<HTMLInputElement | null>(null);

  const groups = useMemo(() => [...new Set(view.items.map((i) => i.group))], [view.items]);
  const shown = view.items.filter((i) => (!group || i.group === group) && (!query || `${i.name} ${i.sku ?? ""}`.toLowerCase().includes(query.toLowerCase())));
  const total = lines.reduce((t, l) => t + Math.round(l.item.price * l.qty), 0);
  const givenMinor = Math.round((Number(given) || 0) * 100);
  const change = tender === "cash" ? givenMinor - total : 0;
  const short = tender === "cash" && given !== "" && givenMinor < total;

  const add = (item: TerminalItem) => {
    setDone(null);
    setLines((ls) => {
      const i = ls.findIndex((l) => l.item.id === item.id);
      if (i < 0) return [...ls, { item, qty: 1 }];
      return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
    });
  };
  const setQty = (id: string, qty: number) => setLines((ls) => (qty <= 0 ? ls.filter((l) => l.item.id !== id) : ls.map((l) => (l.item.id === id ? { ...l, qty } : l))));

  const charge = () =>
    start(async () => {
      setError(null);
      const r = await ringUp(tenant, { tender, customer: customer || undefined, lines: lines.map((l) => ({ item: l.item.id, quantity: l.qty })) });
      if (!r.ok) return setError(r.message ?? "The sale didn't go through.");
      setDone({ id: r.id!, number: r.number ?? "", total: r.total ?? total, change: tender === "cash" && given ? Math.max(0, givenMinor - (r.total ?? total)) : 0 });
      setLines([]);
      setGiven("");
      setCustomer("");
      setTender("cash");
      await refresh();
      search.current?.focus();
    });

  // Note-sized amounts above the total, for one-tap cash.
  const quick = [...new Set([total, ...[100, 500, 1000, 5000].map((n) => Math.ceil(total / (n * 100)) * n * 100)])].filter((n) => n >= total && n > 0).slice(0, 4);

  return (
    <div className="space-y-4">
      <ShiftBar tenant={tenant} shift={shift} money={money} closing={closing} setClosing={setClosing} refresh={refresh} onClosed={onClosed} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Items" className="space-y-3">
          <input
            ref={search}
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) {
                e.preventDefault();
                add(shown[0]);
                setQuery("");
              }
            }}
            placeholder="Search items, or scan a code"
            aria-label="Search items"
            className="h-11 w-full rounded-xl border border-border-strong bg-surface px-4 outline-none focus:border-focus"
          />
          {groups.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {[null, ...groups].map((g) => (
                <button key={g ?? "all"} type="button" onClick={() => setGroup(g)} className={cx("rounded-full border px-3 py-1 text-sm", group === g ? "border-accent bg-accent-soft" : "text-ink-muted hover:text-ink")}>
                  {g ?? "All"}
                </button>
              ))}
            </div>
          )}
          {shown.length === 0 ? (
            <p className="rounded-xl border bg-surface px-4 py-10 text-center text-sm text-ink-muted">{view.items.length ? "Nothing matches." : "Give your items a sales price to sell them here."}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {shown.map((i) => {
                const inCart = lines.find((l) => l.item.id === i.id)?.qty;
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => add(i)}
                      className={cx("relative flex h-24 w-full flex-col justify-between rounded-xl border bg-surface p-3 text-left transition active:scale-[0.98]", inCart ? "border-accent" : "hover:border-ink-faint")}
                    >
                      <span className="line-clamp-2 text-sm font-medium">{i.name}</span>
                      <span className="flex items-end justify-between gap-1">
                        <span className="tabular text-sm">{money(i.price)}</span>
                        {i.onHand !== undefined && <span className={cx("text-[11px]", i.onHand <= 0 ? "text-danger-fg" : "text-ink-faint")}>{i.onHand <= 0 ? "None left" : `${i.onHand} left`}</span>}
                      </span>
                      {inCart && <span className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-accent text-xs text-accent-ink">{inCart}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside aria-label="Sale" className="flex flex-col gap-3 rounded-2xl border bg-surface p-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-6rem)] lg:self-start">
          {done && lines.length === 0 ? (
            <div className="space-y-3 py-4 text-center animate-rise">
              <p className="text-sm text-success-fg">Sale complete</p>
              <p className="tabular text-3xl font-medium">{money(done.total)}</p>
              <p className="text-sm text-ink-muted">{done.number}</p>
              {done.change > 0 && (
                <p className="rounded-xl bg-warning-bg px-3 py-2 text-warning-fg">
                  Change to give <span className="tabular font-semibold">{money(done.change)}</span>
                </p>
              )}
              <div className="flex justify-center gap-2">
                <a href={`/api/w/${tenant}/documents/pos_sale/${done.id}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-sw border border-border-strong px-3 text-sm hover:bg-surface-sunken">
                  Print receipt
                </a>
                <Button variant="primary" onClick={() => setDone(null)}>
                  Next sale
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <h2 className="font-medium">Sale</h2>
                {lines.length > 0 && (
                  <button type="button" onClick={() => setLines([])} className="text-xs text-ink-muted hover:text-danger-fg">
                    Clear
                  </button>
                )}
              </div>
              {lines.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-faint">Tap an item to start.</p>
              ) : (
                <ul className="-mx-1 max-h-72 space-y-1 overflow-y-auto px-1">
                  {lines.map((l) => (
                    <li key={l.item.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{l.item.name}</span>
                        <span className="tabular text-xs text-ink-faint">{money(l.item.price)}</span>
                      </span>
                      <span className="flex items-center rounded-lg border">
                        <button type="button" aria-label={`One less ${l.item.name}`} onClick={() => setQty(l.item.id, l.qty - 1)} className="grid size-8 place-items-center text-ink-muted hover:text-ink">
                          −
                        </button>
                        <span className="tabular w-7 text-center">{l.qty}</span>
                        <button type="button" aria-label={`One more ${l.item.name}`} onClick={() => setQty(l.item.id, l.qty + 1)} className="grid size-8 place-items-center text-ink-muted hover:text-ink">
                          +
                        </button>
                      </span>
                      <span className="tabular w-24 text-right">{money(Math.round(l.item.price * l.qty))}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-baseline justify-between border-t pt-3">
                <span className="text-ink-muted">Total</span>
                <span className="tabular text-2xl font-semibold">{money(total)}</span>
              </div>
              {view.customers.length > 0 && (
                <select value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer" className="h-9 rounded-sw border border-border-strong bg-canvas px-2 text-sm">
                  <option value="">Walk in customer</option>
                  {view.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-sunken p-1" role="radiogroup" aria-label="Payment">
                {(["cash", "card", "qr"] as const).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={tender === t} onClick={() => setTender(t)} className={cx("h-9 rounded-lg text-sm", tender === t ? "bg-surface font-medium shadow-xs" : "text-ink-muted")}>
                    {t === "qr" ? "QR" : t === "card" ? "Card" : "Cash"}
                  </button>
                ))}
              </div>
              {tender === "cash" && total > 0 && (
                <div className="space-y-2">
                  <input inputMode="decimal" value={given} onChange={(e) => setGiven(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Cash given" aria-label="Cash given" className="tabular h-10 w-full rounded-sw border border-border-strong bg-canvas px-3 outline-none focus:border-focus" />
                  <div className="flex flex-wrap gap-1.5">
                    {quick.map((n) => (
                      <button key={n} type="button" onClick={() => setGiven(String(n / 100))} className="tabular rounded-lg border px-2.5 py-1 text-xs hover:bg-surface-sunken">
                        {n === total ? "Exact" : money(n)}
                      </button>
                    ))}
                  </div>
                  {given !== "" && <p className={cx("flex justify-between text-sm", short ? "text-danger-fg" : "")}>{short ? <>Not enough cash</> : <><span className="text-ink-muted">Change</span><span className="tabular font-medium">{money(change)}</span></>}</p>}
                </div>
              )}
              {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
              <Button variant="primary" className="h-12 text-base" disabled={busy || lines.length === 0 || short} onClick={charge}>
                {busy ? "Charging…" : lines.length ? `Charge ${money(total)}` : "Charge"}
              </Button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ShiftBar({ tenant, shift, money, closing, setClosing, refresh, onClosed }: { tenant: string; shift: NonNullable<TerminalView["shift"]>; money: (n: number) => string; closing: boolean; setClosing: (v: boolean) => void; refresh: () => Promise<void>; onClosed: (message: string) => void }) {
  const [counted, setCounted] = useState("");
  const [busy, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const expected = shift.float + shift.takings.cash;
  const opened = new Date(shift.openedAt).toLocaleTimeString("en-LK", { hour: "numeric", minute: "2-digit" });
  return (
    <div className="rounded-xl border bg-surface">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5 text-sm">
        <span className="font-medium">{shift.terminal}</span>
        <span className="text-ink-muted">Open since {opened}</span>
        <span className="text-ink-muted">
          {shift.sales} {shift.sales === 1 ? "sale" : "sales"} · <span className="tabular text-ink">{money(shift.takings.total)}</span>
        </span>
        <button type="button" onClick={() => setClosing(!closing)} className="ml-auto text-sm text-accent hover:underline">
          {closing ? "Keep selling" : "Close shift"}
        </button>
      </div>
      {closing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await endShift(tenant, { counted: Number(counted) || 0 });
              if (!r.ok) return setResult({ ok: false, message: r.message ?? "Couldn't close the shift." });
              const v = r.variance ?? 0;
              onClosed(v === 0 ? "Shift closed and posted to the books. The drawer balances." : `Shift closed and posted to the books. The drawer was ${v > 0 ? "over" : "short"} by ${money(Math.abs(v))}.`);
              setClosing(false);
              await refresh();
            });
          }}
          className="grid gap-3 border-t px-4 py-3 text-sm sm:grid-cols-[repeat(4,auto)_1fr] sm:items-end"
        >
          <p>
            <span className="block text-xs text-ink-muted">Float</span>
            <span className="tabular">{money(shift.float)}</span>
          </p>
          <p>
            <span className="block text-xs text-ink-muted">Cash sales</span>
            <span className="tabular">{money(shift.takings.cash)}</span>
          </p>
          <p>
            <span className="block text-xs text-ink-muted">Card and QR</span>
            <span className="tabular">{money(shift.takings.card + shift.takings.qr)}</span>
          </p>
          <p>
            <span className="block text-xs text-ink-muted">Cash expected</span>
            <span className="tabular font-medium">{money(expected)}</span>
          </p>
          <div className="flex gap-2 sm:justify-end">
            <input inputMode="decimal" required value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Cash counted" aria-label="Cash counted" className="tabular h-9 w-36 rounded-sw border border-border-strong bg-canvas px-3 outline-none focus:border-focus" />
            <Button type="submit" variant="primary" disabled={busy || counted === ""}>
              {busy ? "Closing…" : "Count and close"}
            </Button>
          </div>
        </form>
      )}
      {result && <p role={result.ok ? "status" : "alert"} className={cx("border-t px-4 py-2 text-sm", result.ok ? "text-success-fg" : "text-danger-fg")}>{result.message}</p>}
    </div>
  );
}
