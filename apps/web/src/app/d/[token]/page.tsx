import type { Metadata } from "next";
import { documentFor } from "@/lib/documents/load";
import { sharedRecord } from "@/lib/documents/shared";

export const metadata: Metadata = { title: "Document", robots: { index: false, follow: false } };

/**
 * A shared document, readable on a phone without signing in: what WhatsApp
 * and email links open. The PDF is one tap away.
 */
export default async function SharedDocument({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await sharedRecord(token);
  if (!found) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-lg font-medium">This link has expired</h1>
        <p className="text-sm text-ink-muted">Shared documents open for 30 days. Ask whoever sent it for a new link.</p>
      </main>
    );
  }
  const doc = await documentFor(found.src, found.t, found.rec);
  const pdf = `/d/${token}/pdf`;

  return (
    <main className="min-h-dvh bg-canvas px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">
            {doc.title} from <span className="text-ink">{doc.business.name}</span>
          </p>
          <div className="flex gap-2">
            <a href={pdf} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-sw border border-border-strong bg-surface px-3 text-sm hover:bg-surface-sunken">
              Open PDF
            </a>
            <a href={`${pdf}?download=1`} className="inline-flex h-9 items-center rounded-sw bg-accent px-3 text-sm font-medium text-white hover:opacity-90">
              Download
            </a>
          </div>
        </div>

        <article className="space-y-6 rounded-2xl border bg-surface p-5 shadow-overlay sm:p-8">
          <header className="flex flex-wrap justify-between gap-4">
            <div className="max-w-xs">
              <h1 className="text-lg font-semibold">{doc.business.name}</h1>
              {doc.business.legalName && <p className="text-sm text-ink-muted">{doc.business.legalName}</p>}
              {doc.business.lines.map((l) => (
                <p key={l} className="text-xs whitespace-pre-line text-ink-muted">
                  {l}
                </p>
              ))}
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xl font-semibold tracking-wide text-accent uppercase">{doc.title}</p>
              <p className="tabular text-sm">{doc.number}</p>
              {doc.status && <p className="mt-1 inline-block rounded border border-accent px-1.5 text-[11px] text-accent uppercase">{doc.status}</p>}
            </div>
          </header>

          <div className="flex flex-wrap justify-between gap-4">
            {doc.party && (
              <div className="max-w-xs">
                <p className="text-[11px] tracking-wide text-ink-muted uppercase">{doc.party.heading}</p>
                <p className="font-medium">{doc.party.name}</p>
                {doc.party.lines.map((l) => (
                  <p key={l} className="text-xs whitespace-pre-line text-ink-muted">
                    {l}
                  </p>
                ))}
              </div>
            )}
            <dl className="grid min-w-48 grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-sm">
              {doc.meta.map((m) => (
                <div key={m.label} className="contents">
                  <dt className="text-ink-muted">{m.label}</dt>
                  <dd className="text-right">{m.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {doc.columns.length > 0 && (
            <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink text-left">
                    {doc.columns.map((c) => (
                      <th key={c.key} scope="col" className={`py-2 pr-3 font-medium whitespace-nowrap ${c.numeric ? "text-right" : ""}`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {doc.rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {doc.columns.map((c) => {
                        const [first, ...rest] = (r[c.key] ?? "").split("\n");
                        return (
                          <td key={c.key} className={`py-2 pr-3 align-top ${c.numeric ? "tabular text-right whitespace-nowrap" : ""}`}>
                            {first}
                            {rest.length > 0 && <span className="block text-xs text-ink-muted">{rest.join(" ")}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {doc.amount && (
            <div className="rounded-xl bg-surface-sunken p-4">
              <p className="text-[11px] tracking-wide text-ink-muted uppercase">{doc.amount.label}</p>
              <p className="tabular text-2xl font-semibold">{doc.amount.value}</p>
            </div>
          )}

          {doc.totals.length > 0 && (
            <dl className="ml-auto w-full max-w-64 text-sm">
              {doc.totals.map((t) => (
                <div key={t.label} className={`flex justify-between py-1 ${t.strong ? "mt-1 border-t border-ink pt-2 font-semibold" : "text-ink-muted"}`}>
                  <dt>{t.label}</dt>
                  <dd className="tabular text-ink">{t.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {doc.notes && (
            <div>
              <p className="text-[11px] tracking-wide text-ink-muted uppercase">Notes</p>
              <p className="text-sm whitespace-pre-line">{doc.notes}</p>
            </div>
          )}
          {doc.footer && <p className="text-xs text-ink-muted">{doc.footer}</p>}
        </article>
        <p className="text-center text-xs text-ink-faint">Sent with Shapewise</p>
      </div>
    </main>
  );
}
