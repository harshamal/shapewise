import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { userWorkspaces } from "@shapewise/db";
import { adminDb } from "@/lib/auth/admin";
import { emailConfirmed } from "@/lib/auth/confirm";
import { ConfirmEmailBanner } from "@/components/confirm-email-banner";

export const metadata: Metadata = { title: "Create a workspace" };

export default async function Start() {
  const session = await getSession().catch(() => null);
  if (!session) redirect("/sign-in?next=%2Fstart" as never);
  const confirmed = await emailConfirmed(session);
  const hasWorkspaces = (await userWorkspaces(adminDb(), session.uid).catch(() => [])).length > 0;
  const aiReady = Boolean(process.env.AZURE_OPENAI_ENDPOINT || process.env.GEMINI_API_KEY || process.env.Gemini_API_Key);

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-ink-muted hover:text-ink">
          Shapewise
        </Link>
        {hasWorkspaces && (
          <Link href={"/workspaces" as never} className="text-sm text-accent hover:underline">
            Back to my workspaces
          </Link>
        )}
      </div>
      {!confirmed && (
        <div className="mt-6">
          <ConfirmEmailBanner email={session.email} />
        </div>
      )}
      <h1 className="mt-6 text-2xl tracking-tight">Create a workspace</h1>
      <p className="mt-1 mb-8 text-sm text-ink-muted">Two ways to start. Either way, you can change everything later.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={(aiReady ? "/start/ai" : "#") as never}
          aria-disabled={!aiReady}
          className={`flex flex-col gap-1 rounded-sw border bg-surface p-5 transition-colors ${aiReady ? "border-accent hover:bg-accent-soft" : "pointer-events-none opacity-60"}`}
        >
          <span className="font-medium">Set up with AI</span>
          <span className="text-sm text-ink-muted">Tell us how your business works in a short chat. We design the setup around it, and you review it before anything is created.</span>
          <span className="mt-2 text-xs text-accent">{aiReady ? "Recommended · about 5 minutes" : "AI isn't configured on this server"}</span>
        </Link>
        <Link href="/start/template" className="flex flex-col gap-1 rounded-sw border bg-surface p-5 transition-colors hover:bg-surface-sunken">
          <span className="font-medium">Pick a template</span>
          <span className="text-sm text-ink-muted">Choose the kind of business closest to yours and start straight away.</span>
          <span className="mt-2 text-xs text-ink-faint">About 1 minute</span>
        </Link>
      </div>
    </main>
  );
}
