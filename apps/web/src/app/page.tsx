import Link from "next/link";
import { userWorkspaces } from "@shapewise/db";
import { adminDb } from "@/lib/auth/admin";
import { getSession } from "@/lib/auth/session";

const primary = "inline-flex h-10 items-center rounded-sw bg-accent px-5 text-sm font-medium text-accent-ink hover:bg-accent-hover";
const secondary = "inline-flex h-10 items-center rounded-sw border border-border-strong bg-surface px-5 text-sm font-medium hover:bg-surface-sunken";

export default async function Home() {
  const session = await getSession().catch(() => null);
  const workspaces = session ? await userWorkspaces(adminDb(), session.uid).catch(() => []) : [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <p className="text-sm text-ink-muted">Shapewise</p>
      <h1 className="text-4xl leading-tight tracking-tight text-balance">Business software that takes the shape of your factory.</h1>

      {session ? (
        <section aria-labelledby="yours" className="space-y-4">
          <h2 id="yours" className="text-sm font-medium">
            {workspaces.length ? "Your workspaces" : `Welcome${session.name ? `, ${session.name.split(" ")[0]}` : ""}`}
          </h2>
          {workspaces.length > 0 && (
            <ul className="divide-y rounded-sw border bg-surface">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <Link href={`/w/${w.id}` as never} className="flex items-center justify-between px-4 py-3 hover:bg-surface-sunken">
                    <span className="font-medium">{w.name}</span>
                    <span className="text-sm text-ink-muted">
                      /w/{w.id} · {w.roleKey}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-3">
            <Link href="/start" className={workspaces.length ? secondary : primary}>
              Create a workspace
            </Link>
            <Link href="/w/demo" className={secondary}>
              Open the demo
            </Link>
          </div>
        </section>
      ) : (
        <>
          <p className="max-w-xl text-lg text-ink-muted text-pretty">
            Describe how your business runs, or show us your spreadsheets. Shapewise builds the system around you, and changes with you when you ask in plain words.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/sign-in?next=%2Fstart" className={primary}>
              Get started
            </Link>
            <Link href="/w/demo" className={secondary}>
              Open the demo workspace
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
