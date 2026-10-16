"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { suggestWorkspaceId, workspaceIdProblem } from "@shapewise/db/workspace-id";
import { Button, Input, cx } from "@shapewise/ui";
import { createWorkspace, type CreateResult } from "./actions";

export interface PresetOption {
  key: string;
  label: string;
  description: string;
  examples: string;
}

export function StartForm({ presets }: { presets: PresetOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [preset, setPreset] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);
  const [pending, start] = useTransition();

  const address = idEdited ? id : name ? suggestWorkspaceId(name) : "";
  const addressProblem = address ? workspaceIdProblem(address) : null;
  const err = (f: CreateResult["field"]) => (result && !result.ok && result.field === f ? result.message : undefined);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await createWorkspace({ name, id: address, preset });
      setResult(r);
      if (r.ok && r.id) {
        router.push(`/w/${r.id}` as never);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-8" noValidate>
      {result && !result.ok && !result.field && (
        <p role="alert" className="rounded-sw bg-danger-bg px-4 py-3 text-sm text-danger-fg">
          {result.message}
        </p>
      )}

      <div className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-muted">Business name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="DP Plastics" aria-invalid={err("name") ? true : undefined} autoFocus />
          {err("name") && <span className="mt-1 block text-xs text-danger-fg">{err("name")}</span>}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-muted">Workspace address</span>
          <div className="flex items-center rounded-sw border border-border-strong bg-surface focus-within:border-focus">
            <span className="pl-3 text-sm text-ink-faint">shapewise.web.app/w/</span>
            <input
              className="h-9 min-w-0 flex-1 bg-transparent pr-3 text-sm outline-none"
              aria-label="Workspace address"
              value={address}
              aria-invalid={err("id") || addressProblem ? true : undefined}
              onChange={(e) => {
                setIdEdited(true);
                setId(e.target.value.toLowerCase());
              }}
            />
          </div>
          {(err("id") || addressProblem) && <span className="mt-1 block text-xs text-danger-fg">{err("id") ?? addressProblem}</span>}
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm text-ink-muted">What kind of business is it?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {presets.map((p) => (
            <label
              key={p.key}
              className={cx(
                "flex cursor-pointer flex-col gap-0.5 rounded-sw border bg-surface px-4 py-3 text-sm transition-colors hover:border-border-strong",
                preset === p.key && "border-accent ring-1 ring-accent",
              )}
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="preset" value={p.key} checked={preset === p.key} onChange={() => setPreset(p.key)} className="accent-[var(--sw-accent)]" />
                <span className="font-medium">{p.label}</span>
              </span>
              <span className="text-ink-muted">{p.description}</span>
              <span className="text-xs text-ink-faint">{p.examples}</span>
            </label>
          ))}
        </div>
        {err("preset") && <p className="mt-1 text-xs text-danger-fg">{err("preset")}</p>}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending || !name || !preset || Boolean(addressProblem)}>
          {pending ? "Setting up…" : "Create workspace"}
        </Button>
        <span className="text-sm text-ink-muted">You can change everything later in Settings.</span>
      </div>
    </form>
  );
}
