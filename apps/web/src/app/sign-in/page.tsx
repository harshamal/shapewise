import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/policy";
import { testLoginEnabled } from "@/lib/auth/test-accounts";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  const target = safeNext(next, "/");
  if (await getSession()) redirect(target as never);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <Link href="/" className="text-sm text-ink-muted">
        Shapewise
      </Link>
      <div>
        <h1 className="text-2xl tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {reason === "not_member" ? "Your account isn't a member of that workspace. Sign in with another account, or ask its owner to invite you." : testLoginEnabled() ? "Use your Google account, or a test account while test sign-in is on." : "Use your Google account to open your workspace."}
        </p>
      </div>
      <SignInForm next={target} testLogin={testLoginEnabled()} />
      <p className="text-sm text-ink-muted">
        Just looking?{" "}
        <Link href="/w/demo" className="text-accent underline-offset-4 hover:underline">
          Open the demo workspace
        </Link>
      </p>
    </main>
  );
}
