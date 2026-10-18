import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { findInvite, loadBlueprint, memberRole, workspaceIdProblem } from "@shapewise/db";
import { adminDb } from "@/lib/auth/admin";
import { getSession } from "@/lib/auth/session";
import { emailConfirmed } from "@/lib/auth/confirm";
import { ConfirmEmailBanner } from "@/components/confirm-email-banner";
import { JoinButton, SwitchAccount } from "./join-button";

export const metadata: Metadata = { title: "Join a workspace" };

/** Where an invitation link lands: sign in, check it's for you, join. */
export default async function Join({ params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params;
  const session = await getSession().catch(() => null);
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/join/${tenant}/${token}`)}` as never);
  const db = adminDb();
  if (workspaceIdProblem(tenant) || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return <Shell title="This invitation link isn't valid" body="Check you copied the whole link, or ask for a new one." />;
  const [invite, loaded, already] = await Promise.all([findInvite(db, tenant, token), loadBlueprint(db, tenant), memberRole(db, tenant, session.uid)]);
  if (already) redirect(`/w/${tenant}` as never);
  if (!invite || !loaded) return <Shell title="This invitation can't be used" body="It may have expired, been used already, or been withdrawn. Ask whoever invited you for a new link." />;
  const role = loaded.bp.roles.find((r) => r.key === invite.roleKey);
  const mismatch = (session.email ?? "").toLowerCase() !== invite.email;
  const confirmed = await emailConfirmed(session);

  return (
    <Shell
      title={`Join ${loaded.bp.business.name}`}
      body={`${invite.invitedByName ?? "Someone"} invited ${invite.email} to join as ${role?.label ?? invite.roleKey}.${role?.description ? ` ${role.description}` : ""}`}
    >
      {mismatch ? (
        <div className="space-y-3">
          <p className="rounded-sw bg-warning-bg px-3 py-2 text-sm text-warning-fg">
            You're signed in as {session.email ?? "an account without an email"}. Sign in with {invite.email} to accept.
          </p>
          <SwitchAccount next={`/join/${tenant}/${token}`} />
        </div>
      ) : !confirmed ? (
        <ConfirmEmailBanner email={session.email} />
      ) : (
        <JoinButton tenant={tenant} token={token} />
      )}
    </Shell>
  );
}

function Shell({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-16">
      <Link href="/" className="text-sm text-ink-muted">
        Shapewise
      </Link>
      <div>
        <h1 className="text-2xl tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
      </div>
      {children}
    </main>
  );
}
