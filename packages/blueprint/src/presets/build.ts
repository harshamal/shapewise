import type { z } from "zod";
import type { PermAction } from "../catalogue/actions";
import { EXTENSION_BY_KEY, withRequirements, type ExtensionKey } from "../catalogue/extensions";
import { MODULES, SUBMODULE_BY_KEY, SUBMODULE_FOR_RECORD, SUBMODULE_NEEDS_MODULE } from "../catalogue/modules";
import type { Business, BlueprintInput, Grant, Role, Widget } from "../schema";
import { FIELD_SETS } from "./field-sets";
import { PRESET_BY_KEY } from "./industries";

type RoleInput = z.input<typeof Role>;
type GrantInput = z.input<typeof Grant>;
type WidgetInput = z.input<typeof Widget>;

/** Modules every blueprint has. */
export const CORE_MODULES = MODULES.filter((m) => m.core).map((m) => m.key);

/**
 * A complete, valid starting blueprint for an industry: the deterministic
 * fallback when AI generation fails, and the base the AI adapts.
 */
export function presetBlueprint(presetKey: string, business: z.input<typeof Business>): BlueprintInput {
  const preset = PRESET_BY_KEY.get(presetKey);
  if (!preset) throw new Error(`Unknown industry preset: ${presetKey}`);

  const moduleKeys = unique([...CORE_MODULES, ...preset.modules]);
  const on = new Set(moduleKeys);
  const extensions = withRequirements(preset.extensions).filter((k) => EXTENSION_BY_KEY[k].needsModules.every((m) => on.has(m)));
  const ext = new Set<ExtensionKey>(extensions);
  const customFields = ext.has("custom_fields") ? preset.fieldSets.flatMap((s) => FIELD_SETS[s]?.fields ?? []) : [];

  return {
    schemaVersion: 2,
    version: 1,
    preset: { id: preset.key, version: 1 },
    business: { industry: preset.label, ...business },
    modules: moduleKeys.map((key) => ({ key, enabled: true })),
    extensions,
    settings: {
      production: preset.production ?? {},
      accounting: { chartTemplate: preset.chartTemplate },
    },
    customFields,
    roles: defaultRoles(on, ext),
    approvals: defaultApprovals(on),
    views: defaultViews(on),
    documents: [
      { id: "doc_invoice", record: "invoice", label: "Invoice", extraFields: [], showLots: ext.has("lots") },
      ...(on.has("sales") ? [{ id: "doc_dnote", record: "delivery_note" as const, label: "Delivery note", showLots: ext.has("lots") }] : []),
      ...(on.has("production") ? [{ id: "doc_batch", record: "batch" as const, label: "Batch record and CoA" }] : []),
    ],
    dashboard: defaultDashboard(on, ext),
    seed: preset.seed,
  };
}

/* ------------------------------------------------------------------- roles */

/** Which submodules a fresh blueprint has on: modules on, extension on, and on by default. */
interface Enabled {
  modules: Set<string>;
  extensions: Set<ExtensionKey>;
}

function submoduleOn(key: string, on: Enabled): boolean {
  const sub = SUBMODULE_BY_KEY.get(key);
  if (!sub || !on.modules.has(sub.module)) return false;
  const needs = SUBMODULE_NEEDS_MODULE[key];
  if (needs && !on.modules.has(needs)) return false;
  if (sub.extension) return on.extensions.has(sub.extension);
  return Boolean(sub.core || sub.default);
}

/** Grants limited to what each submodule allows and to submodules that are on. */
function grants(on: Enabled, spec: Record<string, readonly PermAction[] | "all">): GrantInput[] {
  const out: GrantInput[] = [];
  for (const [target, wanted] of Object.entries(spec)) {
    const sub = SUBMODULE_BY_KEY.get(target);
    if (!sub || !submoduleOn(target, on)) continue;
    const actions = wanted === "all" ? [...sub.actions] : wanted.filter((a) => sub.actions.includes(a));
    if (actions.length) out.push({ target, actions });
  }
  return out;
}

/** Every submodule in a module, with the given actions. */
function moduleGrants(on: Enabled, modules: readonly string[], wanted: readonly PermAction[] | "all") {
  const spec: Record<string, readonly PermAction[] | "all"> = {};
  for (const m of MODULES.filter((m) => modules.includes(m.key))) for (const s of m.submodules) spec[s.key] = wanted;
  return grants(on, spec);
}

const VIEW_CREATE_EDIT: readonly PermAction[] = ["view", "create", "edit"];

export function defaultRoles(modules: Set<string>, extensions: Set<ExtensionKey>): RoleInput[] {
  const on: Enabled = { modules, extensions };
  const roles: RoleInput[] = [
    { id: "rol_owner", key: "owner", label: "Owner", owner: true, canChangeSystem: true, grants: [{ target: "*", actions: ["view", "create", "edit", "approve", "post", "void", "file", "manage"] }] },
    {
      id: "rol_manager", key: "manager", label: "Manager", description: "Runs daily operations and approves within limits.",
      grants: [
        ...moduleGrants(on, ["overview", "sales", "purchases", "inventory", "production", "pos", "reports"], ["view", "create", "edit", "approve", "post", "void"]),
        ...grants(on, { approvals: ["view"], audit_log: ["view"], change_studio: ["view", "create"], general_ledger: ["view"], financial_statements: ["view"] }),
      ],
    },
    {
      id: "rol_accounts", key: "accountant", label: "Accountant", description: "Books, banking, tax and payments.",
      grants: [
        ...moduleGrants(on, ["banking", "accounting", "tax", "reports"], "all"),
        ...grants(on, {
          dashboard: ["view"], approvals: ["view"],
          customers: ["view"], vendors: ["view"], invoices: ["view", "create", "edit", "post", "void"], receipts: "all", credit_notes: ["view", "create", "edit", "post"],
          bills: "all", payments_made: "all", vendor_credits: "all", vendor_advances: "all", expenses: "all", statements: ["view"], three_way_match: ["view"],
          stock: ["view"], inventory_analytics: ["view"],
        }),
      ],
    },
  ];
  if (modules.has("sales")) {
    roles.push({
      id: "rol_sales", key: "sales", label: "Sales", description: "Customers, quotes, orders and deliveries.",
      grants: grants(on, {
        dashboard: ["view"], customers: VIEW_CREATE_EDIT, quotes: VIEW_CREATE_EDIT, sales_orders: VIEW_CREATE_EDIT,
        delivery_notes: ["view", "create", "edit"], invoices: ["view", "create", "edit"], receipts: ["view"], statements: ["view"], sales_analytics: ["view"],
        items: ["view"], stock: ["view"], artwork: ["view"],
      }),
    });
  }
  if (modules.has("inventory")) {
    roles.push({
      id: "rol_stores", key: "stores", label: "Stores", description: "Receiving, stock, transfers and dispatch.",
      grants: grants(on, {
        dashboard: ["view"], items: ["view"], stock: ["view"], lots: ["view"], warehouses: ["view"],
        goods_receipts: ["view", "create", "edit", "post"], stock_transfers: ["view", "create", "edit", "post"], stock_adjustments: ["view", "create"],
        delivery_notes: ["view", "create", "edit", "post"], purchase_orders: ["view"], reorder: ["view"],
      }),
    });
  }
  if (modules.has("production")) {
    roles.push(
      {
        id: "rol_supervisor", key: "supervisor", label: "Production supervisor", description: "Plans and runs production on the floor.",
        grants: grants(on, {
          dashboard: ["view"], production_overview: ["view"], recipes: ["view"], production_orders: ["view", "create", "edit"],
          batches: ["view", "create", "edit"], resources: ["view"], capacity: ["view"], traceability: ["view"], artwork: ["view"],
          items: ["view"], stock: ["view"], ncr: ["view", "create", "edit"], production_reports: ["view"],
        }),
      },
      {
        id: "rol_qc", key: "qc", label: "Quality control", description: "Releases batches and inspects receipts.",
        grants: grants(on, {
          dashboard: ["view"], production_overview: ["view"], batches: ["view", "approve"], production_qc: ["view", "approve"],
          incoming_inspection: ["view", "approve"], ncr: ["view", "create", "edit", "approve"], lots: ["view", "approve"], traceability: ["view"], recipes: ["view"],
        }),
      },
    );
  }
  return roles;
}

/* --------------------------------------------------------------- approvals */

function defaultApprovals(on: Set<string>): NonNullable<BlueprintInput["approvals"]> {
  const out: NonNullable<BlueprintInput["approvals"]> = [
    { id: "apr_journal", label: "Manual journals", target: "journal", action: "post", stages: [{ id: "aps_jvowner", name: "Owner", roles: ["rol_owner"] }] },
  ];
  if (on.has("purchases")) {
    out.push({
      id: "apr_po", label: "Purchase orders", target: "purchase_order", action: "issue",
      stages: [
        { id: "aps_pomgr", name: "Manager", minAmount: 250_000, roles: ["rol_manager"] },
        { id: "aps_poowner", name: "Owner", minAmount: 1_000_000, roles: ["rol_owner"] },
      ],
    });
  }
  if (on.has("sales")) {
    out.push({
      id: "apr_cnote", label: "Credit notes", target: "credit_note", action: "post",
      stages: [{ id: "aps_cnmgr", name: "Manager", roles: ["rol_manager", "rol_owner"] }],
    });
  }
  return out;
}

/* ------------------------------------------------------------------- views */

function defaultViews(on: Set<string>): NonNullable<BlueprintInput["views"]> {
  const views: NonNullable<BlueprintInput["views"]> = [];
  if (on.has("sales")) {
    views.push({ id: "vw_sodue", target: "sales_order", label: "Due for delivery", type: "calendar", dateField: "delivery_date" });
  }
  if (on.has("production")) {
    views.push(
      { id: "vw_prodboard", target: "production_order", label: "Board", type: "kanban", groupBy: "status", default: true },
      { id: "vw_batchhold", target: "batch", label: "Waiting for QC", type: "table", filter: "status = 'qc_hold'", columns: ["number", "production_order", "machine", "output_quantity", "mfg_date"] },
    );
  }
  if (on.has("purchases")) {
    views.push({ id: "vw_billsdue", target: "bill", label: "Due this week", type: "table", filter: "due_date <= today() + 7 and amount_due > 0", sort: { field: "due_date", dir: "asc" } });
  }
  return views;
}

/* --------------------------------------------------------------- dashboard */

function defaultDashboard(on: Set<string>, ext: Set<ExtensionKey>): WidgetInput[] {
  const w = (id: string, metric: Extract<WidgetInput["source"], { kind: "builtin" }>["metric"], size: WidgetInput["size"] = "sm"): WidgetInput => ({
    id, size, source: { kind: "builtin", metric },
  });
  return [
    ...(on.has("sales") ? [w("wdg_sales", "sales_this_month"), w("wdg_overdue", "receivables_overdue")] : []),
    w("wdg_cash", "cash_position"),
    ...(on.has("purchases") ? [w("wdg_payables", "payables_due")] : []),
    ...(on.has("production") ? [w("wdg_jobs", "jobs_in_progress"), w("wdg_late", "jobs_late"), w("wdg_scrap", "scrap_pct_by_machine", "md")] : []),
    ...(ext.has("lots") ? [w("wdg_expiring", "lots_expiring")] : []),
    ...(on.has("inventory") ? [w("wdg_reorder", "stock_below_reorder")] : []),
    w("wdg_approvals", "pending_approvals"),
  ];
}

/**
 * Switch catalogue submodules off and drop the role grants, views and print
 * templates that pointed at them, so the blueprint has nothing dead in it.
 */
export function withoutSubmodules(bp: BlueprintInput, keys: readonly string[]): BlueprintInput {
  const off = new Set(keys);
  return {
    ...bp,
    modules: bp.modules.map((m) => {
      const mine = keys.filter((k) => SUBMODULE_BY_KEY.get(k)?.module === m.key);
      if (!mine.length) return m;
      const rest = (m.submodules ?? []).filter((s) => !off.has(s.key));
      return { ...m, submodules: [...rest, ...mine.map((key) => ({ key, enabled: false }))] };
    }),
    roles: bp.roles.map((r) => ({ ...r, grants: r.grants.filter((g) => !off.has(g.target)) })),
    views: bp.views?.filter((v) => !offRecord(v.target)),
    documents: bp.documents?.filter((d) => !offRecord(d.record)),
  };

  function offRecord(target: string) {
    const sub = SUBMODULE_FOR_RECORD.get(target as never);
    return sub !== undefined && off.has(sub);
  }
}

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}
