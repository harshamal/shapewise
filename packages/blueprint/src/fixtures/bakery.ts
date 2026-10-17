import type { BlueprintInput } from "../schema";
import { presetBlueprint, withoutSubmodules } from "../presets/build";

/** The demo bakery from the build plan: food preset, a shop counter (POS) and wholesale to cafés. */
function build(): BlueprintInput {
  const preset = presetBlueprint("food", {
    name: "Demo Bakery",
    currency: "LKR",
    locale: "en-LK",
    timezone: "Asia/Colombo",
    industry: "Bakery: bread, buns and cakes for a shop and wholesale",
  });

  // A small bakery doesn't issue quotes, delivery notes or vendor credits.
  const bp = withoutSubmodules(preset, ["quotes", "delivery_notes", "vendor_credits"]);
  bp.settings = { ...bp.settings, inventory: { expiryAlertDays: [2, 1, 0] } };

  bp.reports = [
    { key: "daily_takings", places: ["module", "reports"] },
    { key: "sales_summary", places: ["dashboard", "module", "reports"] },
    { key: "sales_by_item", places: ["module", "reports"] },
    { key: "yield", places: ["module", "reports"] },
  ];

  const seed = bp.seed ?? {};
  bp.seed = {
    ...seed,
    production: {
      ...seed.production,
      resources: [
        { code: "OVEN-1", name: "Deck oven", type: "machine", hoursPerDay: 14 },
        { code: "MIXER-1", name: "Spiral mixer 60 L", type: "machine", hoursPerDay: 14 },
        { code: "PROOFER", name: "Proofing cabinet", type: "equipment" },
        { code: "BAKER", name: "Baker", type: "labour", hourlyRate: 400 },
      ],
    },
  };
  return bp;
}

export const bakery: BlueprintInput = build();
