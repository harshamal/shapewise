"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cx } from "@shapewise/ui";
import { runRecordAction } from "@/app/w/[tenant]/actions";

/**
 * One lifecycle action on a record (Start, Release, Reject…) from a board
 * or queue. It runs through the same pipeline as the record page, so
 * permissions and approvals apply; the result shows next to the button.
 */
export function ActionButton({ tenant, target, id, version, action, label, tone = "default", confirm: ask }: { tenant: string; target: string; id: string; version: number; action: string; label: string; tone?: "default" | "primary" | "danger"; confirm?: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (ask && !window.confirm(ask)) return;
          start(async () => {
            const r = await runRecordAction(tenant, target, id, action, version);
            if (r.ok) {
              setMsg(r.pending ? { ok: true, text: "Sent for approval" } : null);
              router.refresh();
            } else setMsg({ ok: false, text: r.message ?? "That didn't work." });
          });
        }}
        className={cx(
          "h-7 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
          tone === "primary" && "bg-accent text-accent-ink hover:bg-accent-hover",
          tone === "danger" && "border border-danger-fg/40 text-danger-fg hover:bg-danger-bg",
          tone === "default" && "border border-border-strong hover:bg-surface-sunken",
        )}
      >
        {busy ? "…" : label}
      </button>
      {msg && <span className={cx("max-w-48 text-[11px]", msg.ok ? "text-ink-muted" : "text-danger-fg")}>{msg.text}</span>}
    </span>
  );
}
