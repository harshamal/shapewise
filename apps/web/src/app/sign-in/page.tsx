import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/policy";
import { quickTestAccounts } from "@/lib/auth/test-accounts";
import { Logo } from "@/components/logo";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in or create a Shapewise account with your email or Google.",
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string; mode?: string }>;
}) {
  const { next, reason, mode } = await searchParams;
  // Returning people land on their workspaces; that page sends anyone without one to setup.
  const target = safeNext(next, "/workspaces");
  if (await getSession()) redirect(target as never);

  const initialMode = mode === "signup" ? "signup" : "signin";

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink w-fit transition-colors">
        <Logo size={20} />
        <span className="font-medium tracking-tight">Shapewise</span>
      </Link>

      <div>
        <h1 className="text-2xl font-normal tracking-tight">
          {initialMode === "signup" ? "Create your account" : "Sign in to Shapewise"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {reason === "link_expired"
            ? "That confirmation link has expired or was replaced by a newer one. Sign in to get a new link, or sign up again."
            : reason === "already_confirmed"
              ? "Your email is already confirmed. Sign in with your email and password."
              : reason === "not_member"
            ? "Your account isn't a member of that workspace. Sign in with another account, or ask its owner to invite you."
            : initialMode === "signup"
              ? "Just your email and a password to get started."
              : "Use your email or Google account to open your workspace."}
        </p>
      </div>

      <SignInForm next={target} initialMode={initialMode} testAccounts={quickTestAccounts()} />

      <p className="text-center text-xs text-ink-muted">
        Just exploring?{" "}
        <Link href="/w/demo" className="text-accent underline-offset-4 hover:underline">
          Open the demo workspace
        </Link>
      </p>
    </main>
  );
}
