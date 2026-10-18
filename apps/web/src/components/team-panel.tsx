"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, cx } from "@shapewise/ui";
import { changeMember, inviteMember, loadTeam, withdrawInvite, type TeamView } from "@/app/w/[tenant]/team-actions";

/**
 * Team and users: everyone in the workspace with their role, invitations
 * waiting to be accepted, and inviting someone new. An invitation is a link
 * for one email; whoever signs in with that email can join with the role
 * chosen here.
 */
export function TeamPanel({ tenant }: { tenant: string }) {
  const [team, setTeam] = useState<TeamView | null>(null);
  const [busy, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = () => start(async () => setTeam(await loadTeam(tenant)));
  useEffect(refresh, [tenant]);

  if (!team) return <p className="animate-shimmer text-sm">Loading the team</p>;
  if (!team.ok) return <p className="text-sm text-danger-fg">{team.message}</p>;
  const roles = team.roles ?? [];
  const roleLabel = (k: string) => roles.find((r) => r.key === k)?.label ?? k;
  const field = "h-9 rounded-sw border border-border-strong bg-surface px-2.5 text-sm outline-none focus:border-focus";

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, done?: string) =>
    start(async () => {
      const r = await fn();
      setStatus({ ok: r.ok, message: r.ok ? (done ?? "Saved.") : (r.message ?? "That didn't work.") });
      setTeam(await loadTeam(tenant));
    });

  if (team.demo) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-ink-muted">This is a demo workspace that anyone can open, so it has no members. Create your own workspace to invite your team.</p>
        <RoleList roles={roles} />
      </div>
    );
  }

  return (
    <div className="space-y-6 text-sm">
      {team.canManage && (
        <section className="space-y-3 rounded-xl border bg-surface p-4">
          <div>
            <h4 className="font-medium">Invite someone</h4>
            <p className="mt-0.5 text-xs text-ink-muted">They get a link to join with the role you choose. It works for 14 days, for that email only.</p>
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const email = String(form.get("email") ?? "");
              start(async () => {
                const r = await inviteMember(tenant, { email, roleKey: form.get("role") });
                if (!r.ok) return setStatus({ ok: false, message: r.message ?? "Couldn't invite." });
                setStatus(null);
                setCopied(false);
                setLink({ email: r.email!, url: r.link! });
                (e.target as HTMLFormElement).reset();
                setTeam(await loadTeam(tenant));
              });
            }}
          >
            <input name="email" type="email" required placeholder="name@business.lk" aria-label="Email" className={cx(field, "min-w-0 flex-1")} />
            <select name="role" aria-label="Role" defaultValue={roles.find((r) => !r.owner)?.key} className={field}>
              {roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" disabled={busy}>
              Invite
            </Button>
          </form>
          {link && (
            <div className="space-y-2 rounded-lg border border-accent/40 bg-accent-soft p-3 animate-pop">
              <p className="text-xs">
                Send this link to <span className="font-medium">{link.email}</span>. It's shown only now.
              </p>
              <div className="flex gap-2">
                <input readOnly value={link.url} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className={cx(field, "min-w-0 flex-1 font-mono text-xs")} />
                <Button
                  size="sm"
                  onClick={() =>
                    navigator.clipboard?.writeText(link.url).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                  }
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`You're invited to join our workspace on Shapewise: ${link.url}`)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-xs text-accent underline-offset-4 hover:underline"
              >
                Share on WhatsApp
              </a>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h4 className="font-medium">People ({team.members?.length ?? 0})</h4>
        <ul className="divide-y rounded-xl border bg-surface">
          {(team.members ?? []).map((m) => (
            <li key={m.uid} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-medium">{m.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {m.name}
                  {m.uid === team.me && <span className="ml-1.5 text-xs font-normal text-ink-faint">(you)</span>}
                </span>
                {m.email && m.email !== m.name && <span className="block truncate text-xs text-ink-muted">{m.email}</span>}
              </span>
              {team.canManage ? (
                <>
                  <select aria-label={`Role for ${m.name}`} value={m.roleKey} disabled={busy} onChange={(e) => run(() => changeMember(tenant, m.uid, e.target.value), `${m.name} is now ${roleLabel(e.target.value)}.`)} className={field}>
                    {roles.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  {removing === m.uid ? (
                    <span className="flex gap-2 text-xs">
                      <button type="button" disabled={busy} onClick={() => (setRemoving(null), run(() => changeMember(tenant, m.uid, null), `${m.name} was removed.`))} className="text-danger-fg hover:underline">
                        Remove
                      </button>
                      <button type="button" onClick={() => setRemoving(null)} className="text-ink-faint hover:underline">
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setRemoving(m.uid)} className="text-xs text-ink-faint hover:text-danger-fg">
                      Remove
                    </button>
                  )}
                </>
              ) : (
                <span className="text-xs text-ink-muted">{roleLabel(m.roleKey)}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {team.canManage && (team.invites?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h4 className="font-medium">Waiting to join</h4>
          <ul className="divide-y rounded-xl border bg-surface">
            {team.invites!.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.email}</span>
                  <span className="block text-xs text-ink-muted">
                    {roleLabel(i.roleKey)} · link works until {new Date(i.expiresAt).toLocaleDateString("en-LK", { day: "numeric", month: "short" })}
                    {i.invitedByName ? ` · invited by ${i.invitedByName}` : ""}
                  </span>
                </span>
                <button type="button" disabled={busy} onClick={() => run(() => withdrawInvite(tenant, i.id), "Invitation withdrawn.")} className="text-xs text-ink-faint hover:text-danger-fg">
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-faint">Lost a link? Invite the same email again; the old link stops working.</p>
        </section>
      )}

      {status && (
        <p role={status.ok ? "status" : "alert"} className={cx("rounded-sw px-3 py-2", status.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>
          {status.message}
        </p>
      )}
      <RoleList roles={roles} />
    </div>
  );
}

function RoleList({ roles }: { roles: { key: string; label: string; owner: boolean }[] }) {
  return (
    <p className="text-xs text-ink-faint">
      Roles: {roles.map((r) => r.label).join(", ")}. Set what each can do in Roles and permissions.
    </p>
  );
}
