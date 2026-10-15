import { z } from "zod";

/**
 * Engine bindings: how a blueprint entity attaches to a fixed core engine.
 * An entity with a binding gets the engine's fields, actions and postings; the
 * blueprint can add fields and relabel, but cannot change how the engine counts
 * money or stock.
 */
export const ENGINE_MODULES = ["parties", "inventory", "production", "sales", "purchasing", "accounting"] as const;
export type EngineModule = (typeof ENGINE_MODULES)[number];

export interface BindingSpec {
  module: EngineModule;
  label: string;
  /** Posts to the ledger. */
  money: boolean;
  /** Moves stock. */
  stock: boolean;
  /** Engine actions exposed as commands and tools. */
  actions: readonly string[];
  /** Actions that always need approval, whatever the blueprint says (safety floor). */
  alwaysApprove: readonly string[];
}

export const BINDINGS = {
  "parties.customer": { module: "parties", label: "Customer", money: false, stock: false, actions: [], alwaysApprove: [] },
  "parties.supplier": { module: "parties", label: "Supplier", money: false, stock: false, actions: [], alwaysApprove: [] },

  "inventory.item": { module: "inventory", label: "Item", money: false, stock: true, actions: ["adjust_stock", "transfer_stock"], alwaysApprove: [] },
  "inventory.location": { module: "inventory", label: "Location", money: false, stock: false, actions: [], alwaysApprove: [] },

  "production.resource": { module: "production", label: "Resource", money: false, stock: false, actions: [], alwaysApprove: [] },
  "production.bom": { module: "production", label: "Bill of materials", money: false, stock: false, actions: ["activate"], alwaysApprove: [] },
  "production.job": {
    module: "production",
    label: "Production job",
    money: true,
    stock: true,
    actions: ["release", "issue_materials", "complete_stage", "record_qc", "receive_output", "record_scrap", "close", "cancel"],
    alwaysApprove: [],
  },

  "sales.order": { module: "sales", label: "Sales order", money: false, stock: true, actions: ["confirm", "create_job", "cancel"], alwaysApprove: [] },
  "sales.delivery": { module: "sales", label: "Delivery", money: true, stock: true, actions: ["dispatch", "void"], alwaysApprove: ["void"] },
  "sales.invoice": { module: "sales", label: "Invoice", money: true, stock: false, actions: ["post", "void"], alwaysApprove: ["void"] },
  "sales.receipt": { module: "sales", label: "Receipt", money: true, stock: false, actions: ["post", "void"], alwaysApprove: ["void"] },

  "purchasing.order": { module: "purchasing", label: "Purchase order", money: false, stock: false, actions: ["submit", "cancel"], alwaysApprove: [] },
  "purchasing.receipt": { module: "purchasing", label: "Goods received note", money: true, stock: true, actions: ["receive", "void"], alwaysApprove: ["void"] },
  "purchasing.bill": { module: "purchasing", label: "Supplier bill", money: true, stock: false, actions: ["post", "void"], alwaysApprove: ["void"] },
  "purchasing.payment": { module: "purchasing", label: "Supplier payment", money: true, stock: false, actions: ["post", "void"], alwaysApprove: ["void"] },

  "accounting.journal": { module: "accounting", label: "Journal", money: true, stock: false, actions: ["post", "reverse"], alwaysApprove: ["post", "reverse"] },
} as const satisfies Record<string, BindingSpec>;

export type BindingKey = keyof typeof BINDINGS;
export const BindingKey = z.enum(Object.keys(BINDINGS) as [BindingKey, ...BindingKey[]]);

export function bindingSpec(key: BindingKey): BindingSpec {
  return BINDINGS[key];
}
