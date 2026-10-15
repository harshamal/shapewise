import type { z } from "zod";
import type { CustomField } from "../schema";

/**
 * Ready-made custom field sets, added in one click (SyncBooks' FIELD_TEMPLATES,
 * extended). Ids are derived from the key so applying a set twice is a no-op.
 */
type CustomFieldInput = z.input<typeof CustomField>;

const id = (key: string) => `fld_${key.replaceAll("_", "")}`.slice(0, 28);

const num = (target: CustomFieldInput["target"], key: string, label: string, unit?: string): CustomFieldInput => ({
  target,
  field: unit ? { id: id(key), key, label, type: "quantity", unit } : { id: id(key), key, label, type: "decimal" },
});

export const FIELD_SETS: Readonly<Record<string, { name: string; summary: string; fields: readonly CustomFieldInput[] }>> = {
  product_specs: {
    name: "Product specifications",
    summary: "Length, width, height, volume, weight and shape on items.",
    fields: [
      num("item", "length_mm", "Length", "mm"),
      num("item", "width_mm", "Width", "mm"),
      num("item", "height_mm", "Height", "mm"),
      num("item", "volume_ml", "Volume", "ml"),
      num("item", "weight_g", "Weight", "g"),
      {
        target: "item",
        field: {
          id: id("shape"), key: "shape", label: "Shape", type: "select", filterable: true,
          options: [{ value: "round", label: "Round" }, { value: "square", label: "Square" }, { value: "rectangle", label: "Rectangle" }, { value: "oval", label: "Oval" }],
        },
      },
    ],
  },
  order_specs: {
    name: "Order specifications",
    summary: "Colour code, label version and special instructions on each sales order line.",
    fields: [
      { target: "sales_order", part: "line", showInProduction: true, field: { id: id("colour_code"), key: "colour_code", label: "Colour code", type: "text", description: "RAL or Pantone, for example RAL 5015" } },
      { target: "sales_order", part: "line", showInProduction: true, field: { id: id("colour_approved"), key: "colour_approved", label: "Colour approved by customer", type: "boolean" } },
      { target: "sales_order", part: "line", showInProduction: true, field: { id: id("label_version"), key: "label_version", label: "Label version", type: "text", description: "Artwork or label revision, for example IML-500RD v3" } },
      { target: "sales_order", part: "line", showInProduction: true, field: { id: id("special_instructions"), key: "special_instructions", label: "Special instructions", type: "text" } },
    ],
  },
  food_item: {
    name: "Food item details",
    summary: "Allergens, storage temperature and net weight on items.",
    fields: [
      {
        target: "item",
        field: {
          id: id("allergens"), key: "allergens", label: "Allergens", type: "multiselect", filterable: true,
          options: [
            { value: "gluten", label: "Gluten" }, { value: "milk", label: "Milk" }, { value: "egg", label: "Egg" },
            { value: "nuts", label: "Nuts" }, { value: "soy", label: "Soy" }, { value: "sesame", label: "Sesame" },
          ],
        },
      },
      { target: "item", field: { id: id("storage"), key: "storage", label: "Storage", type: "select", options: [{ value: "ambient", label: "Ambient" }, { value: "chilled", label: "Chilled" }, { value: "frozen", label: "Frozen" }] } },
      num("item", "net_weight_g", "Net weight", "g"),
    ],
  },
  garment_specs: {
    name: "Garment specifications",
    summary: "Size, colour and style on items; size breakdown note on order lines.",
    fields: [
      { target: "item", field: { id: id("style_no"), key: "style_no", label: "Style number", type: "text", searchable: true } },
      { target: "item", field: { id: id("size"), key: "size", label: "Size", type: "select", filterable: true, options: ["xs", "s", "m", "l", "xl", "xxl"].map((v) => ({ value: v, label: v.toUpperCase() })) } },
      { target: "item", field: { id: id("colour"), key: "colour", label: "Colour", type: "text", filterable: true } },
      { target: "sales_order", part: "line", showInProduction: true, field: { id: id("size_breakdown"), key: "size_breakdown", label: "Size breakdown", type: "text" } },
    ],
  },
};
