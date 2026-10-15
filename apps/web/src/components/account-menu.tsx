"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Bottom of the rail: who is signed in and a way out, or a sign-in link for guests. */
export function AccountMenu({ viewer, here }: { viewer: { name: string; role: string | null } | null; here: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!viewer) {
    return (
      <Link href={`/sign-in?next=${encodeURIComponent(here)}` as never} className="text-rail-ink underline-offset-4 hover:underline">
        Sign in
      </Link>
    );
  }

  async function signOut() {
    setBusy(true);
    await fetch("/api/session", { method: "DELETE" });
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate" title={viewer.name}>
        {viewer.name}
        {viewer.role && <span className="text-rail-muted"> · {viewer.role}</span>}
      </span>
      <button type="button" onClick={signOut} disabled={busy} className="shrink-0 text-rail-muted hover:text-rail-ink">
        Sign out
      </button>
    </div>
  );
}
