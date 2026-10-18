import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { userWorkspaces } from "@shapewise/db";
import { adminDb } from "@/lib/auth/admin";
import { getSession } from "@/lib/auth/session";
import { LAST_WORKSPACE_COOKIE } from "@/lib/last-workspace";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata: Metadata = { title: "Your workspaces" };

/**
 * Where a returning person lands after signing in: every business they
 * belong to, the one they used last first. Someone with none goes straight
 * to setting one up.
 */
export default async function Workspaces({ searchParams }: { searchParams: Promise<{ missing?: string }> }) {
  const session = await getSession().catch(() => null);
  if (!session) redirect("/sign-in?next=%2Fworkspaces" as never);
  const { missing } = await searchParams;
  const all = await userWorkspaces(adminDb(), session.uid).catch(() => []);
  if (!all.length && !missing) redirect("/start" as never);

  const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  const list = [...all].sort((a, b) => Number(b.id === last) - Number(a.id === last) || a.name.localeCompare(b.name));
  const first = session.name?.split(" ")[0];

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={22} />
            <span className="text-[15px] font-medium tracking-tight">Shapewise</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-ink-muted sm:inline">{session.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-12 sm:px-6">
        <div>
          <h1 className="text-2xl font-normal tracking-tight">{first ? `Welcome back, ${first}` : "Your workspaces"}</h1>
          <p className="mt-1 text-sm text-ink-muted">{list.length === 1 ? "Open your workspace, or set up another business." : "Pick a business to open."}</p>
        </div>

        {missing && (
          <p role="alert" className="rounded-sw bg-warning-bg px-4 py-3 text-sm text-warning-fg">
            You don't have access to <span className="font-medium">/w/{missing}</span>. It may have been removed, or you were taken off its team. Ask its owner to invite you again.
          </p>
        )}

        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((w) => (
            <li key={w.id}>
              <Link href={`/w/${w.id}` as never} className="group flex items-center gap-4 rounded-2xl border bg-surface p-4 transition-colors hover:border-accent/60">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-lg font-medium text-accent" aria-hidden="true">
                  {(w.name.trim()[0] ?? "W").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{w.name}</span>
                    {w.id === last && <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-muted">Last opened</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-muted">
                    <span className="capitalize">{w.roleKey.replaceAll("_", " ")}</span> · /w/{w.id}
                  </span>
                </span>
                <span className="text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
          <li>
            <Link href="/start" className="flex h-full items-center gap-4 rounded-2xl border border-dashed border-border-strong p-4 text-ink-muted transition-colors hover:border-accent/60 hover:text-ink">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-dashed border-border-strong text-xl" aria-hidden="true">
                +
              </span>
              <span>
                <span className="block font-medium text-ink">Set up another business</span>
                <span className="block text-xs">A short conversation, or start from a template</span>
              </span>
            </Link>
          </li>
        </ul>

        <p className="text-sm text-ink-muted">
          Just looking around?{" "}
          <Link href="/w/demo" className="text-accent hover:underline">
            Demo plastics factory
          </Link>{" "}
          or{" "}
          <Link href="/w/bakery" className="text-accent hover:underline">
            demo bakery
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
