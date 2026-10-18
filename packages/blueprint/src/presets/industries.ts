import type { z } from "zod";
import type { ExtensionKey } from "../catalogue/extensions";
import type { ProductionSettings } from "../settings";
import type { SeedInput as SeedInputMaybe, SeedQcTemplate } from "../seed";

type SeedInput = NonNullable<SeedInputMaybe>;

/**
 * Industry presets: SyncBooks' manufacturing templates and extension bundles
 * merged into one starting point per kind of business. A preset picks the
 * modules and extensions, the production settings, custom field sets and the
 * seed data (parameter library, operation types, QC templates).
 *
 * The AI starts from the nearest preset and adapts it, and falls back to the
 * preset unchanged if generation fails validation three times.
 */

type QcParamInput = z.input<typeof SeedQcTemplate>["params"][number];

export interface IndustryPreset {
  key: string;
  label: string;
  description: string;
  examples: string;
  /** Catalogue modules switched on. */
  modules: readonly string[];
  extensions: readonly ExtensionKey[];
  production?: z.input<typeof ProductionSettings>;
  /** Custom field sets from FIELD_SETS. */
  fieldSets: readonly string[];
  chartTemplate: "services" | "trading" | "manufacturing";
  seed: SeedInput;
}

const passFail = (name: string, method?: string): QcParamInput => ({ name, dataType: "choice", options: ["Pass", "Fail"], targetText: "Pass", method });

const ALL_OPERATIONS = ["sales", "purchases", "inventory", "banking", "accounting", "tax", "reports"] as const;
const MAKERS = [...ALL_OPERATIONS, "production"] as const;

const FACTORY_WAREHOUSES: SeedInput["warehouses"] = [
  { code: "RM", name: "Raw materials", kind: "raw_material" },
  { code: "PKG", name: "Packaging", kind: "packaging" },
  { code: "WIP", name: "Work in progress", kind: "wip" },
  { code: "FG", name: "Finished goods", kind: "finished_goods" },
];
const BASE_UNITS: SeedInput["units"] = [
  { code: "pcs", name: "Pieces" },
  { code: "kg", name: "Kilograms" },
  { code: "g", name: "Grams" },
  { code: "l", name: "Litres" },
  { code: "ml", name: "Millilitres" },
  { code: "m", name: "Metres" },
  { code: "ctn", name: "Cartons" },
];

export const INDUSTRY_PRESETS: readonly IndustryPreset[] = [
  {
    key: "general",
    label: "General manufacturing",
    description: "Assembly and simple conversion. Materials in, finished goods out, basic checks.",
    examples: "Furniture, assembly, light engineering",
    modules: MAKERS,
    extensions: ["custom_fields", "lots", "ops_reports"],
    production: { useOperations: false, useOutputs: false, mixModeDefault: false },
    fieldSets: ["product_specs"],
    chartTemplate: "manufacturing",
    seed: {
      units: BASE_UNITS,
      warehouses: [{ code: "RM", name: "Raw materials", kind: "raw_material" }, { code: "FG", name: "Finished goods", kind: "finished_goods" }],
      production: {
        template: "general",
        parameters: [
          { code: "CYCLE_TIME", name: "Cycle time", unit: "s" },
          { code: "WEIGHT", name: "Weight", category: "quality", unit: "g" },
        ],
        operationTypes: [{ name: "Preparation" }, { name: "Assembly" }, { name: "Inspection" }, { name: "Packing" }],
        qcTemplates: [
          { name: "Final inspection", description: "Basic release check for finished goods.", params: [passFail("Appearance", "Visual check"), passFail("Dimensions", "Gauge or ruler"), passFail("Packaging and label")] },
        ],
      },
    },
  },
  {
    key: "plastics",
    label: "Plastics and packaging",
    description: "Injection moulding, IML, blow moulding and extrusion. Formulas as % of mix, moulds, machine settings, regrind.",
    examples: "Containers, bottles, caps, film, pipes",
    modules: MAKERS,
    extensions: ["custom_fields", "moq", "price_breaks", "pod", "supplier_qualification", "reorder_suggestions", "three_way_match", "production_purchasing", "ops_reports", "artwork", "customer_portal", "pack_units", "lots", "bins", "incoming_qc", "ncr", "capacity"],
    production: { useOperations: true, useOutputs: true, mixModeDefault: true, autoNcrOnFail: true },
    fieldSets: ["product_specs", "order_specs"],
    chartTemplate: "manufacturing",
    seed: {
      units: BASE_UNITS,
      warehouses: FACTORY_WAREHOUSES,
      itemClasses: [
        { code: "RESIN", name: "Resin" },
        { code: "MB", name: "Masterbatch" },
        { code: "LABEL", name: "Labels" },
        { code: "PKG", name: "Packaging" },
        { code: "FG", name: "Finished goods" },
        { code: "REGRIND", name: "Regrind" },
      ],
      production: {
        template: "plastics",
        parameters: [
          { code: "BARREL_TEMP", name: "Barrel temperature", unit: "°C", min: 180, max: 260 },
          { code: "MOULD_TEMP", name: "Mould temperature", unit: "°C", min: 20, max: 80 },
          { code: "INJ_PRESSURE", name: "Injection pressure", unit: "bar", min: 500, max: 1500 },
          { code: "HOLD_PRESSURE", name: "Holding pressure", unit: "bar" },
          { code: "CYCLE_TIME", name: "Cycle time", unit: "s" },
          { code: "SCREW_RPM", name: "Screw speed", unit: "rpm" },
          { code: "COOLING_TIME", name: "Cooling time", unit: "s" },
          { code: "DRYING_TEMP", name: "Resin drying temperature", unit: "°C" },
          { code: "WEIGHT", name: "Part weight", category: "quality", unit: "g" },
          { code: "WALL_THICKNESS", name: "Wall thickness", category: "quality", unit: "mm" },
          { code: "CAPACITY", name: "Capacity", category: "quality", unit: "ml" },
          { code: "THICKNESS_MICRON", name: "Film thickness", category: "quality", unit: "micron" },
        ],
        operationTypes: [
          { name: "Material preparation", description: "Drying, blending resin with masterbatch and regrind", params: ["DRYING_TEMP"] },
          { name: "Injection moulding", params: ["BARREL_TEMP", "MOULD_TEMP", "INJ_PRESSURE", "HOLD_PRESSURE", "CYCLE_TIME", "COOLING_TIME"] },
          { name: "In-mould labelling (IML)", params: ["CYCLE_TIME"] },
          { name: "Blow moulding", params: ["BARREL_TEMP", "CYCLE_TIME"] },
          { name: "Extrusion", params: ["BARREL_TEMP", "SCREW_RPM"] },
          { name: "Trimming and deflashing" },
          { name: "Visual inspection" },
          { name: "Packing" },
          { name: "Regrinding", description: "Grinding runners and rejects for reuse" },
        ],
        qcTemplates: [
          {
            name: "Plastic container final inspection",
            description: "Release check for moulded containers and lids.",
            params: [
              { code: "WEIGHT", name: "Part weight", unit: "g", method: "Weigh 5 samples", frequency: "Every batch" },
              { code: "WALL_THICKNESS", name: "Wall thickness", unit: "mm", method: "Micrometer at 4 points" },
              { code: "CAPACITY", name: "Capacity", unit: "ml", mandatory: false },
              passFail("Appearance (no flash, short shot, black specks)", "Visual"),
              passFail("IML adhesion and registration", "Peel test and visual"),
              passFail("Lid fit and tamper lock"),
              passFail("Leak test"),
            ],
          },
          {
            name: "Incoming resin inspection",
            description: "Receipt check for resin and masterbatch.",
            appliesTo: "receipt",
            params: [passFail("Grade and lot matches CoA"), passFail("Moisture and contamination", "Visual"), passFail("Colour match against master")],
          },
        ],
      },
    },
  },
  {
    key: "food",
    label: "Food and beverage",
    description: "Recipes as % of batch, cooking and cooling steps, expiry, food safety checks.",
    examples: "Bakery, snacks, sauces, beverages, dairy",
    modules: [...MAKERS, "pos"],
    extensions: ["custom_fields", "pack_units", "lots", "incoming_qc", "ncr", "supplier_qualification", "ops_reports"],
    production: { useOperations: true, useOutputs: false, mixModeDefault: true, coaBeforeDispatch: false },
    fieldSets: ["food_item"],
    chartTemplate: "manufacturing",
    seed: {
      units: BASE_UNITS,
      warehouses: [
        { code: "DRY", name: "Dry store", kind: "raw_material" },
        { code: "COLD", name: "Cold room", kind: "raw_material" },
        { code: "FG", name: "Finished goods", kind: "finished_goods" },
      ],
      production: {
        template: "food",
        parameters: [
          { code: "COOK_TEMP", name: "Cooking temperature", unit: "°C" },
          { code: "COOK_TIME", name: "Cooking time", unit: "min" },
          { code: "CORE_TEMP", name: "Core temperature", unit: "°C", min: 72 },
          { code: "COOL_TEMP", name: "Cooling end temperature", unit: "°C", max: 5 },
          { code: "MIX_TIME", name: "Mixing time", unit: "min" },
          { code: "PROOF_TIME", name: "Proofing time", unit: "min" },
          { code: "MOISTURE", name: "Moisture", category: "quality", unit: "%" },
          { code: "PH", name: "pH", category: "quality" },
          { code: "BRIX", name: "Brix", category: "quality", unit: "°Bx" },
          { code: "NET_WEIGHT", name: "Net weight", category: "quality", unit: "g" },
        ],
        operationTypes: [
          { name: "Weighing" },
          { name: "Mixing", params: ["MIX_TIME"] },
          { name: "Fermentation / proofing", params: ["PROOF_TIME"] },
          { name: "Cooking / baking", params: ["COOK_TEMP", "COOK_TIME", "CORE_TEMP"] },
          { name: "Cooling", params: ["COOL_TEMP"] },
          { name: "Filling" },
          { name: "Packing" },
        ],
        qcTemplates: [
          {
            name: "Food final release",
            description: "Release check for packed food.",
            params: [
              { code: "NET_WEIGHT", name: "Net weight", unit: "g" },
              { code: "MOISTURE", name: "Moisture", unit: "%", mandatory: false },
              { code: "PH", name: "pH", mandatory: false },
              passFail("Taste, smell and appearance"),
              passFail("Seal integrity"),
              passFail("Label, batch and expiry printed correctly"),
              passFail("Foreign matter check"),
            ],
          },
          {
            name: "Ingredient receiving",
            appliesTo: "receipt",
            params: [{ name: "Delivery temperature", unit: "°C", max: 5, mandatory: false }, passFail("Packaging intact"), passFail("Within shelf life"), passFail("No pests or contamination")],
          },
        ],
      },
    },
  },
  {
    key: "chemicals",
    label: "Chemicals and cleaning products",
    description: "Formulas by weight or volume, mixing and reaction steps, pH and density checks.",
    examples: "Detergents, paints, adhesives, cosmetics",
    modules: MAKERS,
    extensions: ["custom_fields", "pack_units", "lots", "incoming_qc", "ncr", "ops_reports"],
    production: { useOperations: true, useOutputs: false, mixModeDefault: true },
    fieldSets: ["product_specs"],
    chartTemplate: "manufacturing",
    seed: {
      units: BASE_UNITS,
      warehouses: FACTORY_WAREHOUSES,
      production: {
        template: "chemicals",
        parameters: [
          { code: "MIX_SPEED", name: "Mixing speed", unit: "rpm" },
          { code: "MIX_TIME", name: "Mixing time", unit: "min" },
          { code: "REACTION_TEMP", name: "Reaction temperature", unit: "°C" },
          { code: "PH", name: "pH", category: "quality" },
          { code: "DENSITY", name: "Density", category: "quality", unit: "g/ml" },
          { code: "VISCOSITY", name: "Viscosity", category: "quality", unit: "cP" },
          { code: "ACTIVE_CONTENT", name: "Active content", category: "quality", unit: "%" },
        ],
        operationTypes: [
          { name: "Charging raw materials" },
          { name: "Mixing", params: ["MIX_SPEED", "MIX_TIME"] },
          { name: "Reaction / heating", params: ["REACTION_TEMP"] },
          { name: "Filtration" },
          { name: "Filling" },
          { name: "Packing" },
        ],
        qcTemplates: [
          {
            name: "Chemical batch release",
            params: [
              { code: "PH", name: "pH" },
              { code: "DENSITY", name: "Density", unit: "g/ml" },
              { code: "VISCOSITY", name: "Viscosity", unit: "cP", mandatory: false },
              passFail("Colour and clarity"),
              passFail("Fill level and cap torque"),
            ],
          },
        ],
      },
    },
  },
  {
    key: "pharma",
    label: "Pharmaceutical and nutraceutical",
    description: "Strict formulas, in-process checks, assay and release by QA.",
    examples: "Tablets, capsules, syrups, supplements",
    modules: MAKERS,
    extensions: ["custom_fields", "lots", "incoming_qc", "ncr", "supplier_qualification", "ops_reports"],
    production: { useOperations: true, useOutputs: false, mixModeDefault: true, qcHoldByDefault: true, autoNcrOnFail: true, coaBeforeDispatch: true },
    fieldSets: ["product_specs"],
    chartTemplate: "manufacturing",
    seed: {
      units: BASE_UNITS,
      warehouses: FACTORY_WAREHOUSES,
      production: {
        template: "pharma",
        parameters: [
          { code: "GRANULATION_TIME", name: "Granulation time", unit: "min" },
          { code: "DRYING_LOD", name: "Loss on drying", category: "quality", unit: "%" },
          { code: "TABLET_WEIGHT", name: "Tablet weight", category: "quality", unit: "mg" },
          { code: "HARDNESS", name: "Hardness", category: "quality", unit: "N" },
          { code: "DISINTEGRATION", name: "Disintegration time", category: "quality", unit: "min" },
          { code: "ASSAY", name: "Assay", category: "quality", unit: "%" },
        ],
        operationTypes: [{ name: "Dispensing" }, { name: "Granulation", params: ["GRANULATION_TIME"] }, { name: "Drying" }, { name: "Compression" }, { name: "Coating" }, { name: "Blister packing" }],
        qcTemplates: [
          {
            name: "Finished product release",
            params: [
              { code: "TABLET_WEIGHT", name: "Average weight", unit: "mg" },
              { code: "HARDNESS", name: "Hardness", unit: "N" },
              { code: "DISINTEGRATION", name: "Disintegration time", unit: "min" },
              { code: "ASSAY", name: "Assay", unit: "%", min: 95, max: 105 },
              passFail("Appearance"),
            ],
          },
        ],
      },
    },
  },
  {
    key: "garments",
    label: "Garments and textiles",
    description: "Cutting, sewing and finishing with measurement and workmanship checks.",
    examples: "Apparel, uniforms, home textiles",
    modules: MAKERS,
    extensions: ["custom_fields", "pack_units", "ncr", "capacity", "ops_reports"],
    production: { useOperations: true, useOutputs: true, mixModeDefault: false },
    fieldSets: ["garment_specs"],
    chartTemplate: "manufacturing",
    seed: {
      units: BASE_UNITS,
      warehouses: FACTORY_WAREHOUSES,
      production: {
        template: "garments",
        parameters: [
          { code: "STITCH_SPI", name: "Stitches per inch", unit: "spi" },
          { code: "GSM", name: "Fabric GSM", category: "quality", unit: "gsm" },
          { code: "CHEST", name: "Chest measurement", category: "quality", unit: "cm" },
          { code: "LENGTH", name: "Body length", category: "quality", unit: "cm" },
        ],
        operationTypes: [{ name: "Cutting" }, { name: "Sewing", params: ["STITCH_SPI"] }, { name: "Printing / embroidery" }, { name: "Finishing and pressing" }, { name: "Packing" }],
        qcTemplates: [
          { name: "Garment final audit", params: [{ code: "CHEST", name: "Chest", unit: "cm" }, { code: "LENGTH", name: "Length", unit: "cm" }, passFail("Workmanship"), passFail("Shade match"), passFail("Labels and tags")] },
        ],
      },
    },
  },
  {
    key: "printing",
    label: "Printing and converting",
    description: "Print runs, die cutting and gluing with colour and register checks.",
    examples: "Cartons, labels, flexible packaging",
    modules: MAKERS,
    extensions: ["custom_fields", "artwork", "customer_portal", "pod", "capacity", "ops_reports", "ncr"],
    production: { useOperations: true, useOutputs: true, mixModeDefault: false },
    fieldSets: ["order_specs"],
    chartTemplate: "manufacturing",
    seed: {
      units: BASE_UNITS,
      warehouses: FACTORY_WAREHOUSES,
      production: {
        template: "printing",
        parameters: [
          { code: "PRINT_SPEED", name: "Print speed", unit: "m/min" },
          { code: "INK_VISCOSITY", name: "Ink viscosity", unit: "s" },
          { code: "DELTA_E", name: "Colour difference (ΔE)", category: "quality", max: 2 },
          { code: "BOARD_GSM", name: "Board GSM", category: "quality", unit: "gsm" },
        ],
        operationTypes: [{ name: "Printing", params: ["PRINT_SPEED", "INK_VISCOSITY"] }, { name: "Lamination" }, { name: "Die cutting" }, { name: "Folding and gluing" }, { name: "Packing" }],
        qcTemplates: [{ name: "Print job release", params: [{ code: "DELTA_E", name: "Colour ΔE vs proof", max: 2 }, passFail("Register"), passFail("Text and barcode readable"), passFail("Die cut and crease")] }],
      },
    },
  },
  {
    key: "distribution",
    label: "Wholesale and distribution",
    description: "Buy, store and sell. Cartons and pallets, lots and expiry, bins and delivery proof.",
    examples: "FMCG distributors, hardware wholesalers, importers",
    modules: ALL_OPERATIONS,
    extensions: ["pack_units", "lots", "bins", "pod", "price_breaks", "price_lists", "reorder_suggestions", "moq"],
    fieldSets: [],
    chartTemplate: "trading",
    seed: { units: BASE_UNITS, warehouses: [{ code: "MAIN", name: "Main warehouse", kind: "general" }] },
  },
];

export const PRESET_BY_KEY: ReadonlyMap<string, IndustryPreset> = new Map(INDUSTRY_PRESETS.map((p) => [p.key, p]));
