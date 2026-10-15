# 02 · The blueprint

How Shapewise describes one business. Code: `packages/blueprint`.

---

## 1. The idea

Shapewise has a **fixed catalogue** and a **per-business blueprint**.

- The **catalogue** is code, the same for everyone, modelled on SyncBooks. It holds the modules and submodules, the core records (invoice, batch, GRN and so on) with their fields, lifecycles, postings and conversions, the extensions, and the industry presets.
- The **blueprint** is data, one per business and versioned. It *configures* the catalogue, for example which modules and extensions are on and what the settings are. It also adds the things the catalogue leaves open: custom fields, custom record types, rules, approvals, roles, views, print templates, dashboard widgets and starter data.

A blueprint can never change how a core record counts money or stock. It can relabel an invoice, add fields to it, put an approval on posting it or a rule on creating it, but `post` always means the same balanced ledger entry. That is what keeps an AI-generated system safe.

## 2. Catalogue

| Piece | File | What it holds |
|---|---|---|
| Permission actions | `catalogue/actions.ts` | `view`, `create`, `edit`, `approve`, `post`, `void`, `file`, `manage` (as in SyncBooks) |
| Core records | `catalogue/records.ts` | 44 record types: fields (stable keys), line fields, lifecycle states and actions (with permission, approvable, effects), payment status, where custom fields may go, amount field for approvals, conversions, printable |
| Modules | `catalogue/modules.ts` | Sections → modules → submodules. Each submodule has its kind (records, page, report, settings), the record it lists, its allowed actions, and whether it is core, on by default, or owned by an extension |
| Extensions | `catalogue/extensions.ts` | 21 optional capabilities, from SyncBooks' list, with requirements (`bins` needs `lots`) and the modules they need |
| Presets | `presets/` | Industry presets (general, plastics, food, chemicals, pharma, garments, printing, distribution) that merge SyncBooks' manufacturing templates and extension bundles; custom field sets; a builder that produces a complete valid blueprint |

### Modules and submodules

| Section | Module | Submodules |
|---|---|---|
| Workspace | Overview | Dashboard |
| Operations | Sales | Customers, Quotes, Sales orders, Delivery notes, Invoices, Payments received, Credit notes, Recurring invoices*, Customer statements, Salespersons, Sales analytics |
| | Point of sale | Terminal, POS sales, Shifts, POS analytics |
| | Purchases | Vendors, Supplier qualification*, Purchase orders, Goods received, Bills, Three-way match*, Payments made, Vendor credits, Vendor advances, Expenses, Recurring bills*, Purchase analytics |
| | Inventory | Items, Stock on hand, Lots and expiry*, Reorder suggestions*, Warehouses, Stock adjustments, Stock transfers, Price lists*, Inventory analytics |
| | Production | Floor, Recipes, Production orders, Batches, Quality control, Incoming inspection*, Non-conformance*, Artwork*, Machines and resources, Capacity*, Traceability, Operations reports* |
| Finance | Banking | Bank and cash, Bank rules, Cheques |
| | Accounting | Chart of accounts, Manual journals, Recurring journals*, General ledger, Trial balance, Financial statements, Budgets, Fixed assets, Book close |
| | Tax | VAT returns, WHT certificates, Tax rates |
| | Reports | All reports |
| Governance | Governance | Approvals, System changes, Audit log |
| Settings | Settings | Organisation, Users, Roles, Extensions, Custom fields*, Approval rules, Numbering, Inventory rules, Units, Item classes, Production setup, Agents and MCP |

\* Shown only while its extension is on.

### Production follows SyncBooks

Routing belongs to the **recipe**, not to the job. A recipe has versions, inputs (by quantity or as % of mix) and, with `useOperations` on, operations: work centre, machine, mould or tool, labour, setup and run minutes, and parameters with min, target and max from the parameter library. With `useOutputs` on it also has co-products, by-products and regrind. A **production order** has **batches**. Batches move through draft → materials issued → in process → QC hold → released or rejected. QC templates and incoming inspection use the same parameter library.

Machines, moulds, parameters, operation types and QC templates are **business data**, edited in Settings › Production setup. The blueprint only seeds them (`seed.production`), and applying seed never overwrites existing rows.

## 3. Blueprint shape

```
schemaVersion: 2, version, preset?
business        name, currency, country, locale, timezone, fiscal year, TIN/VAT/BR
modules[]       catalogue module on/off, label, order, submodule overrides
customModules[] extra modules for custom record types
extensions[]    switched-on extensions
settings        general · sales · purchasing · inventory · production · accounting · tax · agents
customFields[]  extra fields on core records (header or line), print / show in production
entities[]      custom record types: fields, optional workflow, numbering, placed in a module
rules[]         on create/update/action of a record: set, reject, warn, discount, notify
approvals[]     action on a record type → stages with min amount and roles (SyncBooks-style), optional channels
roles[]         grants per submodule (or custom record type): actions + row scope
views[]         table, kanban, calendar on any record type
documents[]     print templates for printable core records
dashboard[]     built-in metrics or aggregates
seed            units, item classes, warehouses, resources, parameters, operation types, QC templates
```

## 4. Validation

`validateBlueprint()` parses with Zod, then checks what a schema can't:

- Modules and submodules exist and are in the right module. Core ones can't be switched off. An extension's submodules need the extension.
- Extensions have their requirements and modules.
- Custom fields go only where the record allows and don't clash with built-in fields.
- Custom workflows have real states, no reserved action names, and reachable states.
- Rules and approvals use real actions. Approvals are only placed on approvable actions, and stage amounts go up.
- Roles grant only the actions each submodule has, and there is an owner role.
- Views, documents and widgets reference real fields of the right type.
- Ids are unique, and seed codes resolve.

Every issue carries a path and a plain message. This is the feedback the AI repair loop sends back to Gemini (at most three rounds, then the preset unchanged).

## 5. Changes

Every change is an **overlay**: a list of small ops (`set_module`, `set_submodule`, `set_extension`, `set_setting`, `set_grant`, `add_seed`, `add`, `update`, `remove`, `move`). Catalogue things are addressed by key, the business's own things by stable id. The change studio, presets and undo all produce overlays, so every change is a readable, validated and reversible diff.

## 6. Not yet built

- Expression language (rule conditions, computed fields, view filters) is stored as bounded strings; the parser and type checker come next.
- Compiler (slot map, tool list, permission matrix, dependency graph) and overlay application.
- Recipe operations (routing, parameters) and outputs (co-products, by-products, regrind) are described above but not yet in the catalogue's field lists; the recipe record has inputs only so far.
- Chart of accounts templates (`lk_services`, `lk_trading`, `lk_manufacturing`) are named but not yet defined.
