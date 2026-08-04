import { z } from "zod";

export const trainingPathVersionPolicyValues = ["current_version", "any_passed_version"] as const;
export const trainingPathStatusValues = ["active", "disabled"] as const;
export const qualificationOverviewTabValues = [
  "qualified",
  "training",
  "missing",
  "expiring",
  "expired",
] as const;

const optionalUuid = z
  .union([z.literal(""), z.uuid()])
  .default("")
  .transform((value) => value || null);

const definitionInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(""),
  defaultValidityDays: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(3_650)])
    .default("")
    .transform((value) => (value === "" ? null : value)),
});

const pathItemInputSchema = z.object({
  sopId: z.uuid(),
  isRequired: z.coerce.boolean().default(true),
  versionPolicy: z.enum(trainingPathVersionPolicyValues).default("current_version"),
});

const pathItemsSchema = z
  .array(pathItemInputSchema)
  .min(1, "Add at least one SOP to the path.")
  .max(50, "A path may contain at most 50 SOPs.")
  .refine(
    (items) => new Set(items.map((item) => item.sopId)).size === items.length,
    "Each SOP may appear at most once in a path.",
  );

export const trainingPathCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(""),
  locationId: z.uuid(),
  stationId: optionalUuid,
  enforceOrder: z.coerce.boolean().default(true),
  status: z.enum(trainingPathStatusValues).default("active"),
  definition: definitionInputSchema,
  items: pathItemsSchema,
});

export const trainingPathUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(""),
  enforceOrder: z.coerce.boolean().default(true),
  status: z.enum(trainingPathStatusValues).default("active"),
  definition: definitionInputSchema,
  items: pathItemsSchema,
});

export const trainingPathQuerySchema = z.object({
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  status: z.union([z.literal(""), z.enum(trainingPathStatusValues)]).default(""),
});

export const qualificationOverviewQuerySchema = z.object({
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  tab: z.union([z.literal(""), z.enum(qualificationOverviewTabValues)]).default(""),
});

export const qualificationRevokeSchema = z.object({
  note: z.string().trim().max(1_000).default(""),
});

export type TrainingPathVersionPolicy = (typeof trainingPathVersionPolicyValues)[number];
export type TrainingPathItemInput = z.infer<typeof pathItemInputSchema>;
export type TrainingPathCreateInput = z.infer<typeof trainingPathCreateSchema>;
export type TrainingPathUpdateInput = z.infer<typeof trainingPathUpdateSchema>;
export type TrainingPathQuery = z.infer<typeof trainingPathQuerySchema>;
export type QualificationOverviewTab = (typeof qualificationOverviewTabValues)[number];
export type QualificationOverviewQuery = z.infer<typeof qualificationOverviewQuerySchema>;
export type QualificationRevokeInput = z.infer<typeof qualificationRevokeSchema>;
