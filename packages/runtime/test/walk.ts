import { MemoryStore, compile, createExecutor, previewConversion, type CField, type Command, type CommandResult, type CTarget } from "../src";
import type { Blueprint } from "@shapewise/blueprint";

/**
 * Walks every document a blueprint switches on: creates one with valid
 * made-up data (creating whatever it references first), then takes every
 * forward step of its lifecycle as the owner, approving anything that waits.
 * Works on any blueprint, so it checks AI-designed setups as well as the
 * templates. Returns what happened to each document.
 */

export interface WalkResult {
  target: string;
  label: string;
  steps: string[];
  ok: boolean;
  problem?: string;
}

const BACKWARD = /void|cancel|reverse|reject|fail|decline|expire|archive|restore|write_off|dispose|bounce|refund/;

export async function walk(bp: Blueprint): Promise<WalkResult[]> {
  const c = compile(bp);
  const store = new MemoryStore();
  let n = 0;
  let i = 0;
  const exec = createExecutor({ store, blueprint: async () => c, now: () => new Date("2026-10-16T08:00:00Z"), newId: (p) => `${p}w${++i}` });
  const ownerKey = bp.roles.find((r) => r.owner)!.key;
  const actor = { kind: "user", id: "u_walker", roleKey: ownerKey, channel: "web", displayName: "Walker" } as const;
  const run = (command: Command): Promise<CommandResult> =>
    exec({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, tenantId: "t_walk", actor, command, issuedAt: "2026-10-16T08:00:00.000Z" });
  const settle = async (r: CommandResult): Promise<CommandResult> => {
    // Approve every stage of anything held, as the owner.
    for (let k = 0; k < 6 && r.status === "pending_approval"; k++) r = await run({ type: "approval.decide", approvalId: r.approvalId, decision: "approve" });
    while (r.status === "ok" && (r.effects as { approval?: string } | undefined)?.approval === "next_stage") {
      const pending = (await store.listApprovals("t_walk", "pending"))[0];
      if (!pending) break;
      r = await run({ type: "approval.decide", approvalId: pending.id, decision: "approve" });
    }
    return r;
  };

  const made = new Map<string, string>();
  const value = async (f: CField, depth: number): Promise<unknown> => {
    switch (f.type) {
      case "text":
      case "longtext":
        return `Test ${f.label} ${++i}`.slice(0, 40);
      case "integer":
      case "decimal":
      case "quantity":
        return 1;
      case "money":
        return 100;
      case "percent":
        return 10;
      case "date":
        return "2026-10-16";
      case "datetime":
        return "2026-10-16T08:00:00.000Z";
      case "boolean":
        return false;
      case "select":
        return f.options?.[0]?.value;
      case "multiselect":
        return f.options?.[0] ? [f.options[0].value] : [];
      case "ref":
        return f.to ? ensure(f.to, depth + 1) : undefined;
      case "user":
        return actor.id;
      case "phone":
        return "0771234567";
      case "email":
        return "walker@example.test";
      case "url":
        return "https://example.test";
      default:
        return undefined;
    }
  };
  const dataFor = async (t: CTarget, depth: number) => {
    const data: Record<string, unknown> = {};
    for (const f of t.fields) if (f.required && !f.system) data[f.key] = await value(f, depth);
    if (t.lines) {
      const line: Record<string, unknown> = {};
      for (const f of t.lines.fields) if (!f.system && (f.required || f.key === "item" || f.key === "unit_price" || f.key === "quantity")) line[f.key] = await value(f, depth);
      if (t.target === "journal") {
        const other = await ensureNew("account", depth + 1);
        data.lines = [
          { ...line, debit: 100, credit: undefined },
          { ...line, account: other, credit: 100, debit: undefined },
        ];
      } else data.lines = [line];
    }
    return data;
  };
  const ensureNew = async (target: string, depth: number): Promise<string | undefined> => {
    const t = c.targets.get(target);
    if (!t || depth > 4) return undefined;
    const r = await run({ type: "record.create", target, data: await dataFor(t, depth) });
    return r.status === "ok" ? r.recordId : undefined;
  };
  const ensure = async (target: string, depth: number): Promise<string | undefined> => {
    if (made.has(target)) return made.get(target);
    const id = await ensureNew(target, depth);
    if (id) made.set(target, id);
    return id;
  };

  const results: WalkResult[] = [];
  for (const t of c.targets.values()) {
    const steps: string[] = [];
    const r = await run({ type: "record.create", target: t.target, data: await dataFor(t, 0) });
    if (r.status !== "ok") {
      results.push({ target: t.target, label: t.labelPlural, steps, ok: false, problem: `create: ${r.status === "error" ? `${r.error.message} ${JSON.stringify(r.error.issues ?? []).slice(0, 200)}` : r.status}` });
      continue;
    }
    const id = r.recordId!;
    made.set(t.target, made.get(t.target) ?? id);
    steps.push("create");
    let problem: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const rec = await store.read("t_walk", (tx) => tx.get(t.target, id));
      const next = t.actions.find((a) => rec?.status && a.from.includes(rec.status) && !BACKWARD.test(a.key));
      if (!next) break;
      // Fields a step requires (downtime before completing a job) are filled in, as a person would.
      const needed: Record<string, unknown> = {};
      for (const k of next.requires ?? []) {
        const f = t.fields.find((x) => x.key === k);
        if (f && rec?.data[k] === undefined) needed[k] = await value(f, 1);
      }
      const res = await settle(await run({ type: "record.action", target: t.target, recordId: id, action: next.key, data: Object.keys(needed).length ? needed : undefined } as Command));
      if (res.status !== "ok") {
        problem = `${next.key}: ${res.status === "error" ? res.error.message : res.status}`;
        break;
      }
      steps.push(next.key);
    }
    for (const conv of t.convertsTo) {
      let res = await settle(await run({ type: "record.convert", from: t.target as never, recordId: id, to: conv.to as never }));
      let via = "";
      // What the screen does when a conversion needs more: open the new document pre-filled, the person fills the gaps, and saving converts.
      if (res.status === "error" && res.error.code === "validation") {
        const preview = await previewConversion({ store, blueprint: async () => c, now: () => new Date("2026-10-16T08:00:00Z") }, "t_walk", actor, t.target, id, conv.to);
        if (!preview.ok) problem ??= `preview ${conv.to}: ${preview.message}`;
        else {
          const filled = await completeForm(conv.to, preview.data);
          res = await settle(await run({ type: "record.convert", from: t.target as never, recordId: id, to: conv.to as never, data: filled } as Command));
          via = " (finished in the form)";
        }
      }
      steps.push(res.status === "ok" ? `→${conv.to}${via}` : `→${conv.to} FAILED`);
      if (res.status !== "ok") problem ??= `convert to ${conv.to}: ${res.status === "error" ? `${res.error.message} ${JSON.stringify(res.error.issues ?? []).slice(0, 160)}` : res.status}`;
    }
    results.push({ target: t.target, label: t.labelPlural, steps, ok: !problem, problem });
  }
  return results;

  /** The pre-filled form with its empty required fields filled in, as create input (money back in major units). */
  async function completeForm(target: string, stored: Record<string, unknown>): Promise<Record<string, unknown>> {
    const t = c.targets.get(target)!;
    const major = (f: CField, v: unknown) => (f.type === "money" && typeof v === "number" ? v / 100 : v);
    const out: Record<string, unknown> = {};
    for (const f of t.fields) {
      if (f.system) continue;
      const v = stored[f.key];
      out[f.key] = v !== undefined && v !== null && v !== "" ? major(f, v) : f.required ? await value(f, 1) : undefined;
    }
    if (t.lines) {
      const rows = (stored.lines as Record<string, unknown>[] | undefined) ?? [];
      out.lines = await Promise.all(
        (rows.length ? rows : [{}]).map(async (r) => {
          const l: Record<string, unknown> = {};
          for (const f of t.lines!.fields) {
            if (f.system) continue;
            const v = r[f.key];
            l[f.key] = v !== undefined && v !== null && v !== "" ? major(f, v) : f.required || f.key === "item" ? await value(f, 1) : undefined;
          }
          return l;
        }),
      );
    }
    return out;
  }
}
