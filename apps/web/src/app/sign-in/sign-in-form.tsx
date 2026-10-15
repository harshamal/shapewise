"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { Button } from "@shapewise/ui";
import { clientAuth } from "@/lib/firebase/client";

const MESSAGES: Record<string, string> = {
  "auth/popup-closed-by-user": "The sign-in window was closed before finishing.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.",
  "auth/operation-not-allowed": "Google sign-in isn't switched on for this project yet.",
  "auth/unauthorized-domain": "This web address isn't allowed to sign in yet.",
  "auth/network-request-failed": "Couldn't reach Google. Check your connection and try again.",
};

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    setBusy(true);
    setError(null);
    const auth = clientAuth();
    try {
      const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken: await user.getIdToken() }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Sign-in failed.");
      // The server session is the source of truth; drop the client one.
      await signOut(auth);
      router.replace(next as never);
      router.refresh();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError((code && MESSAGES[code]) ?? (e instanceof Error ? e.message : "Sign-in failed."));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button variant="primary" className="w-full" onClick={google} disabled={busy}>
        {busy ? "Signing in…" : "Continue with Google"}
      </Button>
      {error && (
        <p role="alert" className="rounded-sw bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
