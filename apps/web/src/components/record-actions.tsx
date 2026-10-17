"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@shapewise/ui";
import { convertRecord, deleteRecord, runRecordAction, type ActionResult } from "@/app/w/[tenant]/actions";

const DESTRUCTIVE = /^(void|cancel|reject|reverse|refund|write_off|dispose|bounce|archive)$/;

/**
 * The detail page's action bar: lifecycle actions (Confirm, Post, Dispatch…),
 * conversions (Create invoice…), Edit and Delete. Destructive actions ask
 * first. Results, warnings and approval holds show inline.
 */
export function RecordActions({
  tenant,
  target,
  id,
  version,
  actions,
  converts,
  editHref,
  canDelete,
  listHref,
}: {
  tenant: string;
  target: string;
  id: string;
  version: number;
  actions: { key: string; label: string }[];
  converts: { to: string; label: string; href: string }[];
  editHref?: string;
  canDelete: boolean;
  listHref: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const go = (fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        after?.(r);
        router.refresh();
      }
    });

  // The first non-destructive action is the one primary button on the page.
  const primary = actions.find((a) => !DESTRUCTIVE.test(a.key));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a) => {
          const destructive = DESTRUCTIVE.test(a.key);
          return (
            <Button
              key={a.key}
              size="sm"
              variant={a === primary ? "primary" : destructive ? "danger" : "secondary"}
              disabled={busy}
              onClick={() => {
                if (destructive && !confirm(`${a.label}? This can't be undone.`)) return;
                go(() => runRecordAction(tenant, target, id, a.key, version));
              }}
            >
              {a.label}
            </Button>
          );
        })}
        {converts.map((c) => (
          <Button
            key={c.to}
            size="sm"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await convertRecord(tenant, target, id, c.to);
                // Something the new document needs isn't on this one (a warehouse, prices): finish it in its form.
                if (!r.ok && r.code === "validation") return router.push(`${c.href}/new?from=${encodeURIComponent(target)}&id=${encodeURIComponent(id)}` as never);
                setResult(r);
                if (r.ok) {
                  if (r.recordId) router.push(`${c.href}/${r.recordId}` as never);
                  router.refresh();
                }
              })
            }
          >
            {c.label}
          </Button>
        ))}
        {editHref && (
          <Link href={editHref as never} className="inline-flex h-8 items-center rounded-sw border border-border-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-sunken">
            Edit
          </Link>
        )}
        {canDelete && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (!confirm("Delete this record? This can't be undone.")) return;
              go(() => deleteRecord(tenant, target, id), () => router.push(listHref as never));
            }}
          >
            Delete
          </Button>
        )}
      </div>
      {result && (
        <div
          role={result.ok ? "status" : "alert"}
          className={`rounded-sw px-3 py-2 text-sm ${!result.ok ? "bg-danger-bg text-danger-fg" : result.pending ? "bg-warning-bg text-warning-fg" : "bg-success-bg text-success-fg"}`}
        >
          {result.ok ? (result.pending ? result.message : (result.warnings?.join(" ") || "Done.")) : result.message}
          {!result.ok && result.issues && result.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {result.issues.map((i) => (
                <li key={i.path.join(".") + i.message}>{i.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
