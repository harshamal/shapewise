import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { INDUSTRY_PRESETS } from "@shapewise/blueprint";
import { getSession } from "@/lib/auth/session";
import { StartForm } from "./start-form";

export const metadata: Metadata = { title: "Create a workspace" };

export default async function Start() {
  const session = await getSession().catch(() => null);
  if (!session) redirect("/sign-in?next=%2Fstart" as never);

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        Shapewise
      </Link>
      <h1 className="mt-6 text-2xl tracking-tight">Create a workspace</h1>
      <p className="mt-1 mb-8 text-sm text-ink-muted">
        Start from the setup closest to your business. Modules, extensions, roles and approval rules come ready, and you can change any of them.
      </p>
      <StartForm presets={INDUSTRY_PRESETS.map((p) => ({ key: p.key, label: p.label, description: p.description, examples: p.examples }))} />
    </main>
  );
}
