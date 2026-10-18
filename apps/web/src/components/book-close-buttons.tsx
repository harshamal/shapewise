"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, cx } from "@shapewise/ui";
import { closeBooks, reopenBooks } from "@/app/w/[tenant]/money-actions";

/** Close the books up to a date, or (owners) open them again. */
export function BookCloseButtons({ tenant, date, label, lockDate, canReopen, warn }: { tenant: string; date: string; label: string; lockDate?: string; canReopen: boolean; warn: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const go = (fn: () => Promise<{ ok: boolean; message: string }>, ask?: string) =>
    start(async () => {
      if (ask && !confirm(ask)) return;
      const r = await fn();
      setMsg(r);
      if (r.ok) router.refresh();
    });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {(!lockDate || date > lockDate) && (
          <Button variant="primary" disabled={busy} onClick={() => go(() => closeBooks(tenant, date), warn ? `Some things in the period are still open. Close the books up to ${label} anyway?` : `Close the books up to ${label}? Nothing dated on or before it can be added or changed after this.`)}>
            Close the books up to {label}
          </Button>
        )}
        {lockDate && canReopen && (
          <Button variant="ghost" disabled={busy} onClick={() => go(() => reopenBooks(tenant, null), "Reopen the books? Earlier entries can then be changed again.")}>
            Reopen the books
          </Button>
        )}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={cx("text-sm", msg.ok ? "text-success-fg" : "text-danger-fg")}>{msg.message}</p>}
    </div>
  );
}
