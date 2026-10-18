import "server-only";
import { notFound } from "next/navigation";
import { findNav } from "@shapewise/blueprint";
import { deletable, editable, titleOf, visibleTo, type CField, type CTarget, type StoredRecord } from "@shapewise/runtime";
import type { Workspace } from "./workspace";
import { toInput, type FieldSpec, type FormSpec, type RefTitles } from "./format";

/** The record type behind a module/submodule URL, or 404. */
export function targetFor(ws: Workspace, module: string, submodule: string) {
  const found = findNav(ws.sections, module, submodule);
  if (!found?.submodule) notFound();
  const t = ws.compiled.bySubmodule(submodule);
  return { nav: found.submodule, module: found.module, t };
}

export const spec = (f: CField): FieldSpec => ({
  key: f.key, label: f.label, type: f.type, required: f.required, system: f.system, custom: f.custom, to: f.to, unit: f.unit, description: f.description, options: f.options,
});

export function formSpec(ws: Workspace, t: CTarget): FormSpec {
  const multiCurrency = ws.bp.extensions.includes("multi_currency");
  return {
    fields: t.fields.filter((f) => multiCurrency || f.key !== "currency").map(spec),
    lists: [t.lines, ...t.children].filter((l): l is NonNullable<typeof l> => Boolean(l)).map((l) => ({ key: l.key, label: l.label, fields: l.fields.map(spec) })),
  };
}

/** The records a person may see: all of them, or only their own where their role is limited to that. */
export async function listRecords(ws: Workspace, t: CTarget): Promise<StoredRecord[]> {
  const rows = await ws.store.read(ws.tenant, (tx) => tx.list(t.target));
  return rows.filter((r) => visibleTo(ws.compiled, ws.actor.roleKey, ws.actor.id, t, r)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getRecord(ws: Workspace, t: CTarget, id: string): Promise<StoredRecord> {
  const rec = await ws.store.read(ws.tenant, (tx) => tx.get(t.target, id));
  // Someone else's record, for a role limited to its own, is treated as not there.
  if (!rec || !visibleTo(ws.compiled, ws.actor.roleKey, ws.actor.id, t, rec)) notFound();
  return rec;
}

/** Every record type a set of fields can point at. */
function refTargets(t: CTarget): Set<string> {
  const out = new Set<string>();
  for (const f of [...t.fields, ...(t.lines?.fields ?? []), ...t.children.flatMap((c) => c.fields)]) if (f.type === "ref" && f.to && f.to !== "user") out.add(f.to);
  return out;
}

/** Picker options for every ref field on a form: target → [{ value, label }]. */
export async function refOptions(ws: Workspace, t: CTarget) {
  const out: Record<string, { value: string; label: string }[]> = {};
  for (const target of refTargets(t)) {
    const rt = ws.compiled.targets.get(target);
    if (!rt) {
      out[target] = [];
      continue;
    }
    const rows = await ws.store.read(ws.tenant, (tx) => tx.list(target));
    out[target] = rows
      .filter((r) => !["archived", "void", "cancelled"].includes(r.status ?? ""))
      .map((r) => ({ value: r.id, label: titleOf(rt, r) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  return out;
}

/** Titles for every record referenced by these records, for display. */
export async function refTitles(ws: Pick<Workspace, "store" | "tenant" | "compiled">, t: CTarget, recs: StoredRecord[]): Promise<RefTitles> {
  const titles: RefTitles = {};
  const fields = [...t.fields, ...(t.lines?.fields ?? []), ...t.children.flatMap((c) => c.fields)].filter((f) => f.type === "ref" && f.to && f.to !== "user");
  await ws.store.read(ws.tenant, async (tx) => {
    for (const rec of recs) {
      const values: [CField, unknown][] = [];
      for (const f of t.fields) values.push([f, rec.data[f.key]]);
      for (const l of [t.lines, ...t.children]) for (const row of ((l && (rec.data[l.key] as Record<string, unknown>[])) ?? [])) for (const f of l!.fields) values.push([f, row[f.key]]);
      for (const [f, v] of values) {
        if (!fields.includes(f) || typeof v !== "string" || titles[v]) continue;
        const rt = ws.compiled.targets.get(f.to!);
        const r = rt && (await tx.get(f.to!, v));
        titles[v] = r && rt ? titleOf(rt, r) : "Deleted record";
      }
    }
  });
  return titles;
}

/** A stored record as form input values. */
export function formValues(t: CTarget, rec?: StoredRecord) {
  const header: Record<string, string | boolean | string[]> = {};
  for (const f of t.fields) if (!f.system) header[f.key] = toInput(f, rec?.data[f.key]);
  const lists: Record<string, Record<string, string | boolean | string[]>[]> = {};
  for (const l of [t.lines, ...t.children]) {
    if (!l) continue;
    const rows = (rec?.data[l.key] as Record<string, unknown>[] | undefined) ?? [];
    lists[l.key] = rows.map((row) => {
      const out: Record<string, string | boolean | string[]> = { _line: String(row._line ?? "") };
      for (const f of l.fields) if (!f.system) out[f.key] = toInput(f, row[f.key]);
      return out;
    });
  }
  return { header, lists };
}

/** What the person may do with a record, for showing buttons. The pipeline enforces it again. */
export function abilities(ws: Workspace, t: CTarget, rec: StoredRecord) {
  const can = (a: Parameters<Workspace["compiled"]["can"]>[2]) => ws.compiled.can(ws.actor.roleKey, t.submodule, a);
  return {
    edit: can("edit") && editable(t, rec) && !rec.pendingApproval,
    remove: can("manage") && deletable(t, rec) && !rec.pendingApproval,
    actions: rec.pendingApproval ? [] : t.actions.filter((a) => rec.status && a.from.includes(rec.status) && can(a.permission)),
    // Drafts are converted only from quotes; other documents must be confirmed or posted first.
    convert: rec.pendingApproval || (t.initial === "draft" && rec.status === "draft" && t.target !== "quote") ? [] : t.convertsTo.filter((c) => ws.compiled.can(ws.actor.roleKey, ws.compiled.targets.get(c.to)!.submodule, "create")),
  };
}

/** Today in the business's timezone, YYYY-MM-DD. */
export function businessToday(ws: Workspace): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ws.bp.business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const canCreate =(ws: Workspace, t: CTarget) => ws.compiled.can(ws.actor.roleKey, t.submodule, "create");
