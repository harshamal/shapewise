import { z } from "zod";
import { Label } from "./ids";

/**
 * Starter data copied into the business once, when the blueprint is first
 * applied or an industry template is added. Applying seed never removes
 * anything and never overwrites rows the business already has (matched by
 * code or name), the same rule as SyncBooks' apply_mfg_template.
 *
 * After that these are ordinary records the business edits in Settings ›
 * Production, Units and so on, not part of the live blueprint.
 */

/** Codes like BARREL_TEMP, RM, IMM-01. */
export const Code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.\-]{0,31}$/, "Codes use letters, digits, _ . -");

const ParamDataType = z.enum(["number", "text", "boolean", "choice"]);

export const SeedParameter = z.object({
  code: Code,
  name: Label,
  category: z.enum(["process", "quality"]).default("process"),
  dataType: ParamDataType.default("number"),
  unit: z.string().max(16).optional(),
  min: z.number().optional(),
  target: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string().max(60)).max(30).optional(),
});

export const SeedOperationType = z.object({
  name: Label,
  description: z.string().max(200).optional(),
  /** Parameter codes suggested for this step. */
  params: z.array(Code).max(20).optional(),
});

export const SeedQcParam = z.object({
  /** Library parameter, when the check measures one. */
  code: Code.optional(),
  name: z.string().min(1).max(120),
  dataType: ParamDataType.default("number"),
  unit: z.string().max(16).optional(),
  min: z.number().optional(),
  target: z.number().optional(),
  max: z.number().optional(),
  targetText: z.string().max(60).optional(),
  options: z.array(z.string().max(60)).max(30).optional(),
  method: z.string().max(120).optional(),
  frequency: z.string().max(60).optional(),
  mandatory: z.boolean().default(true),
});

export const SeedQcTemplate = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(200).optional(),
  /** Production batch release, or receipt inspection. */
  appliesTo: z.enum(["batch", "receipt"]).default("batch"),
  params: z.array(SeedQcParam).min(1).max(40),
});

export const SeedResource = z.object({
  code: Code,
  name: Label,
  type: z.enum(["work_centre", "machine", "mould", "tool", "labour", "equipment"]),
  /** Code of the resource it belongs to, e.g. the work centre a machine sits in. */
  parent: Code.optional(),
  hourlyRate: z.number().min(0).optional(),
  hoursPerDay: z.number().min(0).max(24).optional(),
});

export const Seed = z
  .object({
    units: z.array(z.object({ code: Code, name: Label })).max(60).default([]),
    /** Tax rates for the country and registrations (see jurisdiction.ts), created as tax codes. */
    taxCodes: z
      .array(z.object({ name: Label, rate: z.number().min(0).max(100), kind: z.enum(["vat", "sscl", "wht", "exempt", "zero_rated"]) }))
      .max(20)
      .default([]),
    itemClasses: z.array(z.object({ code: Code, name: Label, parent: Code.optional() })).max(100).default([]),
    warehouses: z
      .array(z.object({ code: Code, name: Label, kind: z.enum(["raw_material", "packaging", "wip", "finished_goods", "general"]).default("general") }))
      .max(30)
      .default([]),
    production: z
      .object({
        /** Industry template the rest came from, if any. */
        template: z.string().max(40).optional(),
        resources: z.array(SeedResource).max(200).default([]),
        parameters: z.array(SeedParameter).max(200).default([]),
        operationTypes: z.array(SeedOperationType).max(60).default([]),
        qcTemplates: z.array(SeedQcTemplate).max(40).default([]),
      })
      .prefault({}),
  })
  .prefault({});
export type Seed = z.infer<typeof Seed>;
export type SeedInput = z.input<typeof Seed>;
