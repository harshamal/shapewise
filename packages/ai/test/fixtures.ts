import { BlueprintPlan } from "../src";

/** A plan like the model should write for a bakery with a delivery van. */
export const bakeryPlan: BlueprintPlan = BlueprintPlan.parse({
  businessName: "Sunrise Bakery",
  industryDescription: "Bakery selling bread and cakes at a counter and to cafés",
  preset: "food",
  modules: ["sales", "pos", "purchases", "inventory", "production", "banking", "tax", "reports"],
  hideSubmodules: ["quotes", "delivery_notes"],
  extensions: ["lots", "pack_units", "ncr"],
  settings: { sales: { defaultPaymentTermsDays: 14 }, production: { useOperations: true } },
  customFields: [
    { record: "item", part: "header", key: "allergens", label: "Allergens", type: "multiselect", required: false, options: [{ value: "gluten", label: "Gluten" }, { value: "egg", label: "Egg" }], showOnDocuments: true, showInProduction: false },
    { record: "batch", part: "header", key: "oven_temp", label: "Oven temperature", type: "quantity", unit: "°C", required: false, showOnDocuments: false, showInProduction: false },
  ],
  recordTypes: [
    {
      key: "delivery_run",
      label: "Delivery run",
      labelPlural: "Delivery runs",
      module: "sales",
      titleField: "route",
      numberingPrefix: "RUN",
      why: "The van delivers to cafés each morning on fixed routes.",
      fields: [
        { key: "route", label: "Route", type: "text", required: true },
        { key: "driver", label: "Driver", type: "user", required: false },
        { key: "customer", label: "First stop", type: "ref", refTo: "customer", required: false },
        { key: "run_date", label: "Date", type: "date", required: true },
        { key: "crates", label: "Crates", type: "integer", required: false },
      ],
      workflow: {
        initial: "planned",
        states: [
          { key: "planned", label: "Planned", tone: "neutral" },
          { key: "out", label: "Out for delivery", tone: "info" },
          { key: "done", label: "Delivered", tone: "success", terminal: true },
        ],
        transitions: [
          { key: "leave", label: "Leave bakery", from: ["planned"], to: "out", permission: "edit" },
          { key: "finish", label: "Finish run", from: ["out"], to: "done", permission: "edit", requiredFields: ["crates"] },
        ],
      },
    },
  ],
  roles: [{ key: "driver", label: "Driver", description: "Delivers orders to cafés.", grants: [{ area: "delivery_run", actions: ["view", "edit"] }, { area: "customers", actions: ["view"] }] }],
  approvals: [{ label: "Big purchase orders", record: "purchase_order", action: "issue", stages: [{ name: "Owner", minAmount: 100000, roles: ["owner"], requireAll: false }] }],
  rules: [
    { label: "No zero-crate runs", record: "delivery_run", on: ["finish"], when: "crates = 0", effect: "reject", message: "A run must carry at least one crate." },
    { label: "Tell the owner about big orders", record: "sales_order", on: ["confirm"], when: "total > 50000", effect: "notify", message: "A big order was confirmed", roles: ["owner"] },
  ],
  views: [{ record: "delivery_run", label: "Today's runs", type: "kanban", groupBy: "status" }],
  seed: { resources: [{ code: "OVEN-1", name: "Deck oven", type: "machine" }] },
  assumptions: ["Cafés pay within 14 days."],
});
