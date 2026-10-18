"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { checkConfirmed, resendConfirmation } from "@/app/account-actions";

/** Shown to password accounts until they open the confirmation link. */
export function ConfirmEmailBanner({ email }: { email?: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div role="status" className="rounded-sw border border-warning-fg/30 bg-warning-bg px-4 py-3 text-sm text-warning-fg">
      <p>
        <span className="font-medium">Confirm your email.</span> We sent a link to {email ?? "your inbox"}. Open it to create a workspace or join a team.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" disabled={busy} onClick={() => start(async () => setMsg((await resendConfirmation()).message))} className="underline underline-offset-4 disabled:opacity-60">
          Send a new link
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              if (await checkConfirmed()) router.refresh();
              else setMsg("Not confirmed yet. Open the link in the email, then try again.");
            })
          }
          className="underline underline-offset-4 disabled:opacity-60"
        >
          I've confirmed it
        </button>
        {msg && <span className="text-ink-muted">{msg}</span>}
      </div>
    </div>
  );
}
