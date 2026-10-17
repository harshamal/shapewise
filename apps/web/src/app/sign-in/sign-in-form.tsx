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

export function SignInForm({ next, testLogin }: { next: string; testLogin?: boolean }) {
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
      {testLogin && <TestAccountForm next={next} />}
    </div>
  );
}

/**
 * Email and password test accounts, shown only while SW_TEST_LOGIN=1. The
 * password goes to this app's own server and nowhere else.
 */
function TestAccountForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "h-10 w-full rounded-sw border border-border-strong bg-surface px-3 text-sm outline-none focus:border-focus";

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/test-auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, email: form.get("email"), password: form.get("password"), name: form.get("name") ?? undefined }),
    });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Sign-in failed.");
      setBusy(false);
      return;
    }
    router.replace(next as never);
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-3 rounded-sw border border-dashed border-warning-fg/40 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-warning-fg">Test accounts</p>
        <div className="flex gap-1 text-xs">
          {(["signin", "signup"] as const).map((m) => (
            <button key={m} type="button" onClick={() => (setMode(m), setError(null))} className={m === mode ? "rounded-full bg-surface-sunken px-2.5 py-1 text-ink" : "px-2.5 py-1 text-ink-muted hover:text-ink"}>
              {m === "signin" ? "Sign in" : "Create one"}
            </button>
          ))}
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="space-y-2"
      >
        {mode === "signup" && <input name="name" aria-label="Your name" placeholder="Your name" autoComplete="name" required minLength={2} className={field} />}
        <input name="email" type="email" aria-label="Email" placeholder="Email" autoComplete="username" required className={field} />
        <input name="password" type="password" aria-label="Password" placeholder={mode === "signup" ? "Password, at least 8 characters" : "Password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 8 : 1} className={field} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "One moment…" : mode === "signup" ? "Create test account" : "Sign in with test account"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="rounded-sw bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {error}
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-ink-faint">For testing only. Turn off by removing SW_TEST_LOGIN from the environment.</p>
    </div>
  );
}
