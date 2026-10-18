"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { Button, Input } from "@shapewise/ui";
import { clientAuth } from "@/lib/firebase/client";

const GOOGLE_MESSAGES: Record<string, string> = {
  "auth/popup-closed-by-user": "The sign-in window was closed before finishing.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.",
  "auth/operation-not-allowed": "Google sign-in isn't switched on for this project yet.",
  "auth/unauthorized-domain": "This web address isn't allowed to sign in yet.",
  "auth/network-request-failed": "Couldn't reach Google. Check your connection and try again.",
};

type TestAccount = { label: string; identifier: string; password: string };

/**
 * Sign in with an email (or username) and password, or create an account
 * with just an email and password. Test accounts come from the server, and
 * only when test login is switched on.
 */
export function SignInForm({ next, initialMode = "signin", testAccounts = [] }: { next: string; initialMode?: "signin" | "signup"; testAccounts?: TestAccount[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // One field for both modes: an email when signing up, an email or username when signing in.
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  // Waiting for the person to open the confirmation email.
  const [pending, setPending] = useState<{ email: string; note: string | null } | null>(null);

  function switchMode(m: "signin" | "signup") {
    setMode(m);
    setError(null);
    setPending(null);
  }

  function fillDemo(acc: TestAccount) {
    setMode("signin");
    setIdentifier(acc.identifier);
    setPassword(acc.password);
    setError(null);
  }

  async function handleGoogle() {
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
      if (!res.ok) {
        throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Google sign-in failed.");
      }
      await signOut(auth);
      router.replace(next as never);
      router.refresh();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError((code && GOOGLE_MESSAGES[code]) ?? (e instanceof Error ? e.message : "Sign-in failed."));
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const payload =
        mode === "signup"
          ? { mode: "signup", email: identifier, password }
          : { mode: "signin", identifier, password };

      const res = await fetch("/api/auth/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string; confirm?: boolean; email?: string; sent?: boolean; message?: string; unconfirmed?: boolean };
      if (!res.ok) {
        if (data.unconfirmed) setPending({ email: data.email ?? identifier, note: null });
        throw new Error(data.error ?? "Authentication failed.");
      }
      // A new account isn't signed in until its email is confirmed.
      if (data.confirm) {
        setPending({ email: data.email ?? identifier, note: data.sent ? null : (data.message ?? "We couldn't send the email. Try sending it again.") });
        setPassword("");
        setBusy(false);
        return;
      }

      router.replace(next as never);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
      setBusy(false);
    }
  }

  async function resend(email: string) {
    setBusy(true);
    const res = await fetch("/api/auth/credentials", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "resend", email }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    setPending({ email, note: data.error ?? data.message ?? null });
    setBusy(false);
  }

  if (pending && !error) {
    return (
      <div className="space-y-4 rounded-2xl border bg-surface p-5">
        <div className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        </div>
        <div className="space-y-1">
          <h2 className="font-medium">Check your inbox</h2>
          <p className="text-sm text-ink-muted">
            We sent a link to <span className="text-ink">{pending.email}</span>. Open it to confirm your email and you'll be signed in.
          </p>
        </div>
        {pending.note && <p className="rounded-sw bg-surface-sunken px-3 py-2 text-sm text-ink-muted">{pending.note}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <button type="button" disabled={busy} onClick={() => void resend(pending.email)} className="text-accent underline-offset-4 hover:underline disabled:opacity-60">
            {busy ? "Sending…" : "Send it again"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPending(null);
              setMode("signin");
            }}
            className="text-ink-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Back to sign in
          </button>
        </div>
        <p className="text-xs text-ink-faint">Nothing there after a few minutes? Check your spam folder.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode Switcher Tabs */}
      <div className="flex rounded-lg bg-surface-sunken p-1 text-xs font-medium">
        <button
          type="button"
          onClick={() => switchMode("signin")}
          className={`flex-1 rounded-md py-1.5 transition-colors ${
            mode === "signin" ? "bg-surface text-ink shadow-xs" : "text-ink-muted hover:text-ink"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => switchMode("signup")}
          className={`flex-1 rounded-md py-1.5 transition-colors ${
            mode === "signup" ? "bg-surface text-ink shadow-xs" : "text-ink-muted hover:text-ink"
          }`}
        >
          Create account
        </button>
      </div>

      {/* Username / Password Form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="identifier" className="mb-1 block text-xs font-medium text-ink-muted">
            Email
          </label>
          <Input
            id="identifier"
            type={mode === "signup" ? "email" : "text"}
            name={mode === "signup" ? "email" : "username"}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="you@company.lk"
            required
            autoComplete={mode === "signup" ? "email" : "username"}
            disabled={busy}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-ink-muted">Password</label>
            {mode === "signup" && <span className="text-[11px] text-ink-faint">At least 8 characters</span>}
          </div>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "Create a secure password" : "Enter your password"}
              required
              minLength={mode === "signup" ? 8 : 1}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              disabled={busy}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink focus:outline-hidden"
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <Button variant="primary" type="submit" className="w-full mt-2" disabled={busy}>
          {busy ? (mode === "signup" ? "Creating account…" : "Signing in…") : mode === "signup" ? "Create account" : "Sign in"}
        </Button>
      </form>

      {/* Error Message */}
      {error && (
        <div role="alert" className="rounded-sw bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {error}
          {pending && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                void resend(pending.email);
              }}
              className="mt-1 block underline underline-offset-4 disabled:opacity-60"
            >
              Send the link again
            </button>
          )}
        </div>
      )}

      {/* Divider */}
      <div className="relative my-4 flex items-center justify-center">
        <div className="w-full border-t border-border-strong/60" />
        <span className="bg-canvas px-3 text-xs uppercase tracking-wider text-ink-faint">or</span>
        <div className="w-full border-t border-border-strong/60" />
      </div>

      {/* Google Button */}
      <Button
        variant="secondary"
        className="w-full flex items-center justify-center gap-2.5"
        onClick={handleGoogle}
        disabled={busy}
      >
        <svg className="size-4 shrink-0" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
        </svg>
        <span>Continue with Google</span>
      </Button>

      {/* Quick Demo Logins Helper */}
      {testAccounts.length > 0 && (
        <div className="rounded-lg bg-surface-sunken/60 p-3 text-xs space-y-1.5">
          <p className="font-medium text-ink-muted">Quick test accounts:</p>
          <div className="flex flex-wrap gap-1.5">
            {testAccounts.map((acc) => (
              <button
                key={acc.label}
                type="button"
                onClick={() => fillDemo(acc)}
                className="rounded-md bg-surface px-2.5 py-1 text-ink shadow-xs hover:bg-surface-sunken transition-colors"
              >
                {acc.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Switcher */}
      <p className="text-center text-xs text-ink-muted pt-1">
        {mode === "signin" ? (
          <>
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className="text-accent underline-offset-4 hover:underline font-medium"
            >
              Create one
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="text-accent underline-offset-4 hover:underline font-medium"
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}
