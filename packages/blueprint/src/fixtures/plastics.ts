import type { BlueprintInput } from "../index";

/** A small but complete plastics-factory blueprint used across contract tests. */
export const plasticsFactory: BlueprintInput = {
  schemaVersion: 1,
  version: 1,
  base: { id: "manufacturing", version: 1 },
  pack: { id: "plastics", version: 1 },
  business: { name: "Demo Plastics", currency: "LKR", locale: "en-LK", timezone: "Asia/Colombo", industry: "plastic injection moulding" },
  modules: [
    { id: "mod_sales", key: "sales", label: "Sales", engine: "sales", icon: "receipt" },
    { id: "mod_prod", key: "production", label: "Production", engine: "production", icon: "factory" },
    { id: "mod_inv", key: "inventory", label: "Inventory", engine: "inventory", icon: "boxes" },
  ],
  entities: [
    {
      id: "ent_customer",
      key: "customer",
      label: "Customer",
      labelPlural: "Customers",
      module: "mod_sales",
      binding: "parties.customer",
      titleField: "fld_cname",
      fields: [
        { id: "fld_cname", key: "name", label: "Name", type: "text", required: true, searchable: true, sortable: true },
        { id: "fld_cphone", key: "phone", label: "Phone", type: "phone", unique: true },
        { id: "fld_ccount", key: "order_count", label: "Orders", type: "computed", expr: "count(sales_order where customer = this)", resultType: "integer" },
      ],
    },
    {
      id: "ent_item",
      key: "item",
      label: "Item",
      labelPlural: "Items",
      module: "mod_inv",
      binding: "inventory.item",
      titleField: "fld_iname",
      lots: { enabled: true, expiry: false },
      fields: [
        { id: "fld_iname", key: "name", label: "Name", type: "text", required: true, searchable: true },
        { id: "fld_ikind", key: "kind", label: "Kind", type: "select", filterable: true, options: [
          { value: "raw", label: "Raw material" },
          { value: "finished", label: "Finished good" },
        ] },
        { id: "fld_iresin", key: "resin_grade", label: "Resin grade", type: "text", filterable: true },
      ],
    },
    {
      id: "ent_machine",
      key: "machine",
      label: "Machine",
      labelPlural: "Machines",
      module: "mod_prod",
      binding: "production.resource",
      titleField: "fld_mname",
      fields: [{ id: "fld_mname", key: "name", label: "Name", type: "text", required: true }],
    },
    {
      id: "ent_order",
      key: "sales_order",
      label: "Sales order",
      labelPlural: "Sales orders",
      module: "mod_sales",
      binding: "sales.order",
      titleField: "fld_ono",
      numbering: { pattern: "SO-{yyyy}-{seq:5}" },
      fields: [
        { id: "fld_ono", key: "number", label: "Number", type: "text", readonly: true, engineOwned: true },
        { id: "fld_ocust", key: "customer", label: "Customer", type: "ref", to: "ent_customer", required: true, filterable: true },
        { id: "fld_odue", key: "due_date", label: "Due date", type: "date", required: true, sortable: true },
        { id: "fld_olines", key: "lines", label: "Lines", type: "lines", item: "ent_item", engineOwned: true, columns: [
          { id: "fld_olitem", key: "item", label: "Item", type: "ref", to: "ent_item", required: true },
          { id: "fld_olqty", key: "quantity", label: "Quantity", type: "quantity", unitFromItem: "fld_olitem", required: true },
          { id: "fld_olprice", key: "unit_price", label: "Unit price", type: "money", required: true },
        ] },
        { id: "fld_ototal", key: "total", label: "Total", type: "money", readonly: true, engineOwned: true },
      ],
      workflow: {
        initial: "st_draft",
        states: [
          { id: "st_draft", key: "draft", label: "Draft" },
          { id: "st_conf", key: "confirmed", label: "Confirmed", tone: "info" },
          { id: "st_done", key: "fulfilled", label: "Fulfilled", tone: "success", terminal: true },
        ],
        transitions: [
          { id: "tr_conf", key: "confirm", label: "Confirm", from: ["st_draft"], to: "st_conf", engineAction: "confirm" },
          { id: "tr_done", key: "fulfil", label: "Mark fulfilled", from: ["st_conf"], to: "st_done" },
        ],
      },
    },
    {
      id: "ent_job",
      key: "production_job",
      label: "Production job",
      labelPlural: "Production jobs",
      module: "mod_prod",
      binding: "production.job",
      titleField: "fld_jno",
      numbering: { pattern: "JOB-{seq:5}" },
      fields: [
        { id: "fld_jno", key: "number", label: "Number", type: "text", readonly: true, engineOwned: true },
        { id: "fld_jitem", key: "product", label: "Product", type: "ref", to: "ent_item", required: true, filterable: true },
        { id: "fld_jqty", key: "planned_quantity", label: "Planned quantity", type: "quantity", unitFromItem: "fld_jitem", required: true },
        { id: "fld_jmach", key: "machine", label: "Machine", type: "ref", to: "ent_machine", filterable: true },
        { id: "fld_jsup", key: "supervisor", label: "Supervisor", type: "user" },
      ],
      stages: [
        { id: "stg_mix", key: "mixing", label: "Mixing" },
        { id: "stg_mould", key: "moulding", label: "Moulding", resource: "ent_machine", qc: [
          { id: "qc_weight", key: "weight", label: "Part weight", type: "number", unit: "g", min: 48, max: 52, onFail: "block" },
          { id: "qc_flash", key: "flash", label: "No flash", type: "boolean" },
        ] },
        { id: "stg_pack", key: "packing", label: "Packing", allowsScrap: false },
      ],
    },
  ],
  rules: [
    { id: "rul_loyal", key: "loyal_discount", label: "Loyal customer discount", entity: "ent_order", on: ["create"],
      when: "customer.order_count >= 5", then: { kind: "discount_percent", expr: "5" } },
  ],
  approvals: [
    { id: "apr_bigso", key: "large_order", label: "Large sales orders", on: [{ entity: "ent_order", action: "confirm" }],
      when: "record.total > 50000000", steps: [{ id: "aps_owner", roles: ["rol_owner"] }] },
  ],
  roles: [
    { id: "rol_owner", key: "owner", label: "Owner", owner: true, canChangeSystem: true, permissions: [{ entity: "*", actions: ["read", "create", "update", "delete", "transition:*", "action:*"] }] },
    { id: "rol_sup", key: "supervisor", label: "Supervisor", permissions: [
      { entity: "ent_job", actions: ["read", "update", "action:complete_stage", "action:record_qc", "action:record_scrap"], scope: { kind: "own", field: "fld_jsup" } },
      { entity: "ent_item", actions: ["read"] },
    ] },
  ],
  views: [
    { id: "vw_jobs", entity: "ent_job", label: "Floor", type: "kanban", groupBy: "stage", default: true },
    { id: "vw_orders", entity: "ent_order", label: "Due", type: "calendar", dateField: "fld_odue" },
  ],
  documents: [{ id: "doc_card", key: "job_card", label: "Job card", entity: "ent_job", template: "job_card" }],
  dashboard: [
    { id: "wdg_scrap", source: { kind: "builtin", metric: "scrap_pct_by_resource" }, size: "md" },
    { id: "wdg_late", source: { kind: "builtin", metric: "jobs_late" } },
  ],
};
