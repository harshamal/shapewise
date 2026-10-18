"use client";

import { useState, useTransition } from "react";
import { Button, cx } from "@shapewise/ui";
import { emailDocument, shareDocument, type ShareInfo } from "@/app/w/[tenant]/document-actions";

/**
 * Print, download and send a document. Sharing makes a signed link (good for
 * 30 days) and offers it by WhatsApp, email or copy.
 */
export function DocumentButtons({ tenant, target, id, label }: { tenant: string; target: string; id: string; label: string }) {
  const [busy, start] = useTransition();
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState("");
  const [sent, setSent] = useState<{ ok: boolean; message: string } | null>(null);
  const pdf = `/api/w/${tenant}/documents/${target}/${id}`;

  const openShare = () => {
    setOpen((o) => !o);
    if (share) return;
    start(async () => {
      const r = await shareDocument(tenant, target, id);
      setShare(r);
      if (r.email) setTo(r.email);
    });
  };

  const copy = async () => {
    if (!share?.link) return;
    await navigator.clipboard.writeText(share.link).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const sendEmail = () =>
    start(async () => {
      if (!share?.text) return;
      if (!share.canEmail) {
        window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(share.subject ?? label)}&body=${encodeURIComponent(share.text)}`;
        return;
      }
      setSent(await emailDocument(tenant, target, id, { to, message: share.text }));
    });

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <a href={pdf} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-sw border border-border-strong px-3 text-sm transition-colors hover:bg-surface-sunken">
          <PrintIcon />
          Print
        </a>
        <a href={`${pdf}?download=1`} className="inline-flex h-9 items-center rounded-sw border border-border-strong px-3 text-sm transition-colors hover:bg-surface-sunken">
          Download PDF
        </a>
        <Button variant="secondary" onClick={openShare} aria-expanded={open}>
          Send
        </Button>
      </div>

      {open && (
        <div className="mt-3 w-full max-w-md space-y-3 rounded-2xl border bg-surface p-4 shadow-overlay animate-rise">
          {!share ? (
            <p className="animate-shimmer text-sm">Making a link</p>
          ) : !share.ok ? (
            <p role="alert" className="text-sm text-danger-fg">
              {share.message}
            </p>
          ) : (
            <>
              <div>
                <p className="text-sm font-medium">Send this {label.toLowerCase()}</p>
                <p className="text-xs text-ink-muted">Anyone with the link can view and download it for 30 days.</p>
              </div>
              <div className="flex gap-2">
                <input readOnly value={share.link} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-sw border border-border-strong bg-canvas px-2.5 text-xs text-ink-muted" />
                <Button size="sm" onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <a
                href={share.whatsapp}
                target="_blank"
                rel="noreferrer"
                className="flex h-9 items-center justify-center gap-2 rounded-sw bg-[#25D366] text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Send on WhatsApp
              </a>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendEmail();
                }}
                className="space-y-1.5"
              >
                <label className="text-xs text-ink-muted" htmlFor={`to-${id}`}>
                  Email to
                </label>
                <div className="flex gap-2">
                  <input
                    id={`to-${id}`}
                    type="email"
                    required
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="name@company.lk"
                    className="h-9 min-w-0 flex-1 rounded-sw border border-border-strong bg-canvas px-2.5 text-sm outline-none focus:border-focus"
                  />
                  <Button type="submit" size="sm" disabled={busy || !to}>
                    {share.canEmail ? (busy ? "Sending…" : "Send") : "Open email"}
                  </Button>
                </div>
                <p className="text-xs text-ink-faint">{share.canEmail ? "Goes out with the PDF attached." : "Opens your email app with the message and link written for you."}</p>
              </form>
              {sent && (
                <p role={sent.ok ? "status" : "alert"} className={cx("rounded-sw px-3 py-2 text-sm", sent.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>
                  {sent.message}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PrintIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2" />
      <path d="M6 14h12v7H6z" />
    </svg>
  );
}
