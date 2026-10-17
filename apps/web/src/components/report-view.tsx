import Link from "next/link";
import type { Chart, Headline, ReportColumn, ReportResult, ReportRow, Unit } from "@shapewise/runtime/reports";
import { formatMoney, formatValue } from "@/lib/format";

/**
 * A report as the owner reads it: the headline number, a simple chart and
 * the table behind it. Charts are one series in the accent colour; every
 * mark has a tooltip and the table carries the exact figures.
 */

export function formatUnit(type: ReportColumn["type"], v: unknown, currency: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v !== "number") return type === "date" ? formatValue({ type: "date" }, v, { currency }) : String(v);
  switch (type) {
    case "money":
      return formatMoney(v, currency);
    case "percent":
      return `${v.toLocaleString("en-LK", { maximumFractionDigits: 1 })}%`;
    case "hours":
      return `${v.toLocaleString("en-LK", { maximumFractionDigits: 1 })} h`;
    case "count":
      return v.toLocaleString("en-LK", { maximumFractionDigits: 0 });
    default:
      return v.toLocaleString("en-LK", { maximumFractionDigits: 3 });
  }
}

/** Short form for axes: Rs 1.2M, 45K. */
function compact(v: number, unit: Unit, currency: string): string {
  if (unit === "percent") return `${Math.round(v)}%`;
  const n = new Intl.NumberFormat("en-LK", { notation: "compact", maximumFractionDigits: 1 }).format(unit === "money" ? v / 100 : v);
  return unit === "money" ? `${currency === "LKR" ? "Rs" : currency} ${n}` : unit === "hours" ? `${n} h` : n;
}

/** Headline amounts in whole rupees; the table keeps the cents. */
function headlineText(h: Headline, currency: string): string {
  if (h.unit !== "money" || h.value === null) return formatUnit(h.unit, h.value, currency);
  return new Intl.NumberFormat("en-LK", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 0 }).format(h.value / 100).replace(currency, currency === "LKR" ? "Rs" : currency).trim();
}

export function HeadlineValue({ h, currency, size = "lg" }: { h: Headline; currency: string; size?: "lg" | "md" }) {
  return (
    <div className="min-w-0">
      <p className={`tabular font-medium break-words ${size === "lg" ? "text-2xl" : "text-xl"}`}>{headlineText(h, currency)}</p>
      {h.text && <p className="mt-0.5 truncate text-sm text-ink-muted">{h.text}</p>}
    </div>
  );
}

export function WaitingNote({ engine, compact: small }: { engine: "stock" | "ledger"; compact?: boolean }) {
  const text = engine === "stock" ? "Starts with the stock engine, which keeps quantities and costs as goods move." : "Starts with the accounting engine, which posts every document to the ledger.";
  return small ? <p className="mt-1 text-sm text-ink-muted">{text}</p> : <p className="rounded-sw border bg-surface px-6 py-12 text-center text-sm text-ink-muted">{text}</p>;
}

export function ReportView({ r, currency, periods }: { r: ReportResult; currency: string; periods?: { key: string; label: string; href: string }[] }) {
  if (r.state === "waiting") {
    return (
      <section aria-labelledby={`rp-${r.key}`}>
        <h2 id={`rp-${r.key}`} className="text-base font-medium">{r.label}</h2>
        <p className="mb-4 text-sm text-ink-muted">{r.asks}</p>
        <WaitingNote engine={r.engine} />
      </section>
    );
  }
  return (
    <section aria-labelledby={`rp-${r.key}`} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`rp-${r.key}`} className="text-base font-medium">{r.label}</h2>
          <p className="text-sm text-ink-muted">{r.asks}</p>
        </div>
        {periods && r.period && (
          <nav aria-label="Period" className="flex flex-wrap gap-1">
            {periods.map((p) => (
              <Link key={p.key} href={p.href as never} aria-current={p.key === r.period!.key ? "true" : undefined} className={`rounded-sw border px-2.5 py-1 text-[13px] ${p.key === r.period!.key ? "border-accent bg-accent-soft text-ink" : "bg-surface text-ink-muted hover:text-ink"}`}>
                {p.label}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {r.rows.length === 0 ? (
        <p className="rounded-sw border bg-surface px-6 py-12 text-center text-sm text-ink-muted">{r.empty}</p>
      ) : (
        <>
          <div className="grid gap-px overflow-hidden rounded-sw border bg-border xl:grid-cols-[14rem_1fr]">
            {r.headline && (
              <div className="bg-surface p-4">
                <p className="text-sm text-ink-muted">{r.headline.label}</p>
                <div className="mt-1">
                  <HeadlineValue h={r.headline} currency={currency} />
                </div>
                {r.period && <p className="mt-3 text-xs text-ink-faint">{r.period.label}</p>}
              </div>
            )}
            <div className={`bg-surface p-4 ${r.headline ? "" : "xl:col-span-2"}`}>{r.chart && r.chart.points.length > 0 && <ChartView chart={r.chart} currency={currency} title={r.label} />}</div>
          </div>
          <ReportTable r={r} currency={currency} />
        </>
      )}
      {r.note && <p className="text-xs text-ink-faint">{r.note}</p>}
    </section>
  );
}

function ReportTable({ r, currency, limit }: { r: Extract<ReportResult, { state: "ready" }>; currency: string; limit?: number }) {
  const rows = limit ? r.rows.slice(0, limit) : r.rows;
  const numeric = (c: ReportColumn) => c.type !== "text" && c.type !== "date";
  const cell = (c: ReportColumn, row: ReportRow, i: number, total?: boolean) => {
    const v = row[c.key];
    const shown = i === 0 && total && (v === null || v === undefined) ? "Total" : total && v === undefined ? "" : formatUnit(c.type, v, currency);
    return (
      <td key={c.key} className={`px-4 py-2 whitespace-nowrap ${numeric(c) ? "tabular text-right" : ""} ${i === 0 ? "font-medium" : ""}`}>
        {shown}
      </td>
    );
  };
  return (
    <div className="overflow-x-auto rounded-sw border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-ink-muted">
            {r.columns.map((c) => (
              <th key={c.key} scope="col" className={`h-9 px-4 font-medium whitespace-nowrap ${numeric(c) ? "text-right" : ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.columns.map((c, j) => cell(c, row, j))}
            </tr>
          ))}
        </tbody>
        {r.totals && !limit && (
          <tfoot>
            <tr className="border-t bg-surface-sunken">{r.columns.map((c, j) => cell(c, r.totals!, j, true))}</tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** The short version for a module's landing page. */
export function ReportCard({ r, currency, href }: { r: ReportResult; currency: string; href?: string }) {
  return (
    <section aria-labelledby={`rc-${r.key}`} className="flex flex-col rounded-sw border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`rc-${r.key}`} className="text-sm font-medium">{r.label}</h2>
        {href && (
          <Link href={href as never} className="shrink-0 text-[13px] text-accent hover:underline">
            Open report
          </Link>
        )}
      </div>
      {r.state === "waiting" ? (
        <WaitingNote engine={r.engine} compact />
      ) : r.rows.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">{r.empty}</p>
      ) : (
        <>
          {r.headline && (
            <div className="mt-2">
              <p className="text-xs text-ink-muted">{r.headline.label}</p>
              <HeadlineValue h={r.headline} currency={currency} size="md" />
            </div>
          )}
          {r.chart && r.chart.points.length > 0 && (
            <div className="mt-3">
              <ChartView chart={r.chart} currency={currency} title={r.label} small />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ charts */

export function ChartView({ chart, currency, title, small }: { chart: Chart; currency: string; title: string; small?: boolean }) {
  const long = chart.points.some((p) => p.label.length > 9);
  if (chart.type === "bar" && (long || chart.points.length <= 6)) return <Bars chart={chart} currency={currency} title={title} limit={small ? 5 : 12} />;
  return <Columns chart={chart} currency={currency} title={title} height={small ? 120 : 200} />;
}

/** Horizontal bars for named things: customers, machines, age bands. */
function Bars({ chart, currency, title, limit }: { chart: Chart; currency: string; title: string; limit: number }) {
  const points = chart.points.slice(0, limit);
  const max = Math.max(...points.map((p) => Math.abs(p.value)), chart.unit === "percent" ? 100 : 0) || 1;
  return (
    <ul aria-label={`${title} chart`} className="space-y-2">
      {points.map((p) => (
        <li key={p.label} title={`${p.label}: ${formatUnit(chart.unit, p.value, currency)}`} className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 text-[13px]">
          <span className="truncate text-ink-muted">{p.label}</span>
          <span className="block h-3 rounded-r-[4px] bg-accent" style={{ width: `${Math.max(p.value > 0 ? 1 : 0, (Math.max(0, p.value) / max) * 100)}%` }} />
          <span className="tabular text-right">{formatUnit(chart.unit, p.value, currency)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Columns or a line over time: days, months. */
function Columns({ chart, currency, title, height }: { chart: Chart; currency: string; title: string; height: number }) {
  const W = 640;
  const pad = { l: 56, r: 8, t: 8, b: 22 };
  const pts = chart.points;
  const values = pts.map((p) => p.value);
  const max = Math.max(...values, 0) || 1;
  const min = Math.min(...values, 0);
  const y = (v: number) => pad.t + ((max - v) / (max - min)) * (height - pad.t - pad.b);
  const band = (W - pad.l - pad.r) / pts.length;
  const x = (i: number) => pad.l + band * i + band / 2;
  const every = Math.ceil(pts.length / 8);
  const ticks = [max, max / 2, 0].concat(min < 0 ? [min] : []);
  const barW = Math.min(28, Math.max(3, band - 2));
  const r = Math.min(4, barW / 2);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${title} chart`} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--sw-border)" strokeWidth={1} />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--sw-ink-faint)">
            {compact(t, chart.unit, currency)}
          </text>
        </g>
      ))}
      {pts.map((p, i) =>
        i % every === 0 || i === pts.length - 1 ? (
          <text key={`l${i}`} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--sw-ink-faint)">
            {p.label}
          </text>
        ) : null,
      )}
      {chart.type === "line" ? (
        <>
          <polyline points={pts.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} fill="none" stroke="var(--sw-accent)" strokeWidth={2} strokeLinejoin="round" />
          {pts.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.value)} r={4} fill="var(--sw-accent)" stroke="var(--sw-surface)" strokeWidth={2} />
          ))}
        </>
      ) : (
        pts.map((p, i) => {
          const top = y(Math.max(p.value, 0));
          const h = Math.abs(y(p.value) - y(0));
          if (h < 0.5) return null;
          const x0 = x(i) - barW / 2;
          // Rounded at the data end, square on the baseline.
          const d = p.value >= 0 ? `M${x0},${top + h} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${top + h} Z` : `M${x0},${y(0)} V${y(0) + h - r} Q${x0},${y(0) + h} ${x0 + r},${y(0) + h} H${x0 + barW - r} Q${x0 + barW},${y(0) + h} ${x0 + barW},${y(0) + h - r} V${y(0)} Z`;
          return <path key={i} d={d} fill="var(--sw-accent)" />;
        })
      )}
      {pts.map((p, i) => (
        <rect key={`h${i}`} x={pad.l + band * i} y={pad.t} width={band} height={height - pad.t - pad.b} fill="transparent">
          <title>{`${p.label}: ${formatUnit(chart.unit, p.value, currency)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

export { ReportTable };
