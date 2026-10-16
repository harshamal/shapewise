import { CORE_RECORDS, EXTENSIONS, INDUSTRY_PRESETS, MODULES, type CoreRecordKey } from "@shapewise/blueprint";

/**
 * A compact description of everything Shapewise offers, generated from the
 * catalogue so the model always designs against what actually exists.
 */
export function catalogueBrief(): string {
  const presets = INDUSTRY_PRESETS.map((p) => `- ${p.key}: ${p.label}. ${p.description} (${p.examples}). Modules: ${p.modules.join(", ")}. Extensions: ${p.extensions.join(", ") || "none"}.`).join("\n");

  const modules = MODULES.filter((m) => m.key !== "settings")
    .map((m) => {
      const subs = m.submodules
        .map((s) => `${s.key}${s.record ? `→${s.record}` : ""}${s.core ? "*" : ""}${s.extension ? `[${s.extension}]` : ""}`)
        .join(", ");
      return `- ${m.key}${m.core ? " (always on)" : ""}: ${subs}`;
    })
    .join("\n");

  const extensions = EXTENSIONS.map((e) => `- ${e.key}: ${e.summary}${e.requires.length ? ` Needs ${e.requires.join(", ")}.` : ""}${e.needsModules.length ? ` Modules: ${e.needsModules.join(", ")}.` : ""}`).join("\n");

  const records = (Object.keys(CORE_RECORDS) as CoreRecordKey[])
    .map((k) => {
      const r = CORE_RECORDS[k];
      const fields = r.fields.map((f) => f.key).join(", ");
      const lines = r.lines ? ` | lines: ${r.lines.fields.map((f) => f.key).join(", ")}` : "";
      const statuses = r.lifecycle ? ` | statuses: ${r.lifecycle.states.map((s) => s.key).join(", ")}` : "";
      const actions = r.lifecycle ? ` | actions: ${r.lifecycle.actions.map((a) => `${a.key}${a.approvable ? "(approvable)" : ""}`).join(", ")}` : "";
      const custom = r.customFields.length ? ` | custom fields on: ${r.customFields.join("+")}` : "";
      return `- ${k}: ${fields}${lines}${statuses}${actions}${custom}`;
    })
    .join("\n");

  return `## Presets (pick the closest)
${presets}

## Modules and their submodules (submodule→record it lists; * = always on with its module; [ext] = shown only with that extension)
${modules}

## Extensions
${extensions}

## Core records (fixed engines; add custom fields, never redefine them). Field keys, lines, statuses and actions:
${records}

## Roles every setup starts with
owner (everything), manager, accountant, sales, stores (with inventory), supervisor and qc (with production). Reuse these keys; add new roles only for real jobs that differ.

## Expressions (rule conditions, approval conditions, view filters)
Field keys of the record, dotted through references (customer.payment_terms_days), status, today(), now(), days_between(a, b), lower(), contains(), is_empty(), count(record where cond), sum(record.field where cond). Operators: = != < <= > >= and or not in (...). Text in single quotes. Money in rupees.`;
}
