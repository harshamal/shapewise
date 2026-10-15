import type { BlueprintInput } from "../schema";
import { presetBlueprint } from "../presets/build";

/**
 * A DP Plastics-style injection moulding factory: the plastics preset plus
 * the kind of customisations the AI adds from an interview. Used by tests and
 * as the demo workspace.
 */
function build(): BlueprintInput {
  const bp = presetBlueprint("plastics", {
    name: "Demo Plastics",
    legalName: "Demo Plastics (Pvt) Ltd",
    currency: "LKR",
    locale: "en-LK",
    timezone: "Asia/Colombo",
    industry: "Plastic injection moulding and IML containers",
    tin: "114567890",
  });

  bp.settings = {
    ...bp.settings,
    sales: { moqMode: "block", creditLimitMode: "warn" },
    tax: { vatRegistered: true, ssclRegistered: true, irdTaxInvoice: true },
    general: { numbering: [{ record: "batch", pattern: "DP{yy}{mm}-{seq:4}" }] },
  };

  // Resin grade on items, filterable.
  bp.customFields = [
    ...(bp.customFields ?? []),
    {
      target: "item",
      field: {
        id: "fld_resingrade", key: "resin_grade", label: "Resin grade", type: "select", filterable: true,
        options: [{ value: "pp_homo", label: "PP homopolymer" }, { value: "pp_copo", label: "PP copolymer" }, { value: "hdpe", label: "HDPE" }, { value: "ldpe", label: "LDPE" }],
      },
    },
  ];

  // A custom record type: planned and breakdown maintenance on machines and moulds.
  bp.entities = [
    {
      id: "ent_maint",
      key: "maintenance",
      label: "Maintenance job",
      labelPlural: "Maintenance",
      module: "production",
      icon: "wrench",
      titleField: "fld_mtitle",
      numbering: { pattern: "MNT-{seq:4}" },
      fields: [
        { id: "fld_mtitle", key: "title", label: "What", type: "text", required: true, searchable: true },
        { id: "fld_mres", key: "resource", label: "Machine or mould", type: "ref", to: "resource", required: true, filterable: true },
        { id: "fld_mkind", key: "kind", label: "Kind", type: "select", filterable: true, options: [{ value: "planned", label: "Planned" }, { value: "breakdown", label: "Breakdown", tone: "danger" }] },
        { id: "fld_mdue", key: "due_date", label: "Due", type: "date", sortable: true },
        { id: "fld_mtech", key: "technician", label: "Technician", type: "user", filterable: true },
        { id: "fld_mdown", key: "downtime_min", label: "Downtime (min)", type: "integer", min: 0 },
        { id: "fld_mcost", key: "cost", label: "Cost", type: "money" },
        { id: "fld_mnotes", key: "notes", label: "Notes", type: "longtext" },
      ],
      workflow: {
        initial: "st_mopen",
        states: [
          { id: "st_mopen", key: "open", label: "Open", tone: "warning" },
          { id: "st_mprog", key: "in_progress", label: "In progress", tone: "info" },
          { id: "st_mdone", key: "done", label: "Done", tone: "success", terminal: true },
        ],
        transitions: [
          { id: "tr_mstart", key: "start", label: "Start", from: ["st_mopen"], to: "st_mprog" },
          { id: "tr_mdone", key: "complete", label: "Complete", from: ["st_mprog"], to: "st_mdone", requires: ["fld_mdown"] },
        ],
      },
    },
  ];

  bp.rules = [
    {
      id: "rul_loyal", key: "loyal_discount", label: "5% for customers with 5 or more orders", target: "sales_order", on: ["create"],
      when: "customer.order_count >= 5", then: { kind: "discount_percent", expr: "5" },
    },
    {
      id: "rul_credit", key: "credit_hold", label: "No new orders for customers over 90 days overdue", target: "sales_order", on: ["confirm"],
      when: "customer.days_overdue > 90", then: { kind: "reject", message: "This customer has invoices more than 90 days overdue." },
    },
    {
      id: "rul_brkdn", key: "breakdown_alert", label: "Tell the supervisor about breakdowns", target: "ent_maint", on: ["create"],
      when: "kind = 'breakdown'", then: { kind: "notify", roles: ["rol_supervisor", "rol_manager"], message: "Machine breakdown logged" },
    },
  ];

  bp.approvals = [
    ...(bp.approvals ?? []),
    {
      id: "apr_bigso", label: "Large sales orders", target: "sales_order", action: "confirm",
      stages: [{ id: "aps_bigsoown", name: "Owner", minAmount: 5_000_000, roles: ["rol_owner"] }],
    },
    {
      id: "apr_agentgrn", label: "Goods received by agents", target: "goods_receipt", action: "post", channels: ["mcp", "assistant"],
      stages: [{ id: "aps_agentgrn", name: "Stores", roles: ["rol_stores", "rol_manager"] }],
    },
  ];

  bp.views = [
    ...(bp.views ?? []),
    { id: "vw_maintboard", target: "ent_maint", label: "Board", type: "kanban", groupBy: "status", default: true },
    { id: "vw_items", target: "item", label: "By resin", type: "table", columns: ["sku", "name", "resin_grade", "on_hand"], sort: { field: "name", dir: "asc" } },
  ];

  bp.roles = (bp.roles ?? []).map((r) =>
    r.key === "supervisor"
      ? { ...r, grants: [...r.grants, { target: "ent_maint", actions: ["view", "create", "edit"], scope: { kind: "own" as const, field: "technician" } }] }
      : r,
  );

  bp.dashboard = [
    ...(bp.dashboard ?? []),
    { id: "wdg_downtime", label: "Breakdown downtime this month", source: { kind: "aggregate", target: "ent_maint", agg: "sum", field: "downtime_min", filter: "kind = 'breakdown'", period: "month" } },
  ];

  // Machines and moulds on the floor.
  const seed = bp.seed ?? {};
  bp.seed = {
    ...seed,
    production: {
      ...seed.production,
      resources: [
        { code: "MOULDING", name: "Moulding hall", type: "work_centre", hoursPerDay: 22 },
        { code: "IMM-01", name: "Haitian 250T", type: "machine", parent: "MOULDING", hourlyRate: 2_400, hoursPerDay: 22 },
        { code: "IMM-02", name: "Haitian 160T", type: "machine", parent: "MOULDING", hourlyRate: 1_900, hoursPerDay: 22 },
        { code: "IMM-03", name: "Engel 200T IML", type: "machine", parent: "MOULDING", hourlyRate: 2_800, hoursPerDay: 22 },
        { code: "M-500RD", name: "500 ml round container mould (4 cav)", type: "mould" },
        { code: "M-1LSQ", name: "1 L square container mould (2 cav)", type: "mould" },
        { code: "M-LID95", name: "95 mm lid mould (8 cav)", type: "mould" },
        { code: "OPERATOR", name: "Machine operator", type: "labour", hourlyRate: 450 },
        { code: "GRANULATOR", name: "Granulator", type: "equipment" },
      ],
    },
  };

  return bp;
}

export const plasticsFactory: BlueprintInput = build();
