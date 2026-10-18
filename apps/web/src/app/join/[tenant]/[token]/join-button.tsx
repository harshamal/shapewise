"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@shapewise/ui";
import { acceptJoin } from "../../actions";

export function JoinButton({ tenant, token }: { tenant: string; token: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Button
        variant="primary"
        className="w-full"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await acceptJoin(tenant, token);
            if (!r.ok) return setError(r.message ?? "Couldn't join.");
            router.replace(r.href as never);
            router.refresh();
          })
        }
      >
        {busy ? "Joining…" : "Join workspace"}
      </Button>
      {error && (
        <p role="alert" className="rounded-sw bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

/** Signs out, then back to sign-in with the invitation as the next stop. */
export function SwitchAccount({ next }: { next: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/session", { method: "DELETE" });
        window.location.href = `/sign-in?next=${encodeURIComponent(next)}`;
      }}
      className="text-sm text-accent underline-offset-4 hover:underline"
    >
      Use another account
    </button>
  );
}
