import { z } from "zod";

export const sopCategoryValues = [
  "recipe",
  "cleaning",
  "opening",
  "closing",
  "safety",
  "equipment",
  "customer_service",
  "general_procedure",
] as const;

export const sopStatusValues = ["draft", "published", "archived"] as const;
export const sopDifficultyValues = ["beginner", "intermediate", "advanced"] as const;

const category = z.enum(sopCategoryValues);
const status = z.enum(sopStatusValues);
const difficulty = z.enum(sopDifficultyValues);
const optionalUuid = z.union([z.literal(""), z.uuid()]).transform((value) => value || null);
const revision = z.coerce.number().int().min(1);

const materialSchema = z.object({
  kind: z.enum(["material", "ingredient"]),
  name: z.string().trim().min(1).max(160),
  quantity: z.string().trim().max(40).default(""),
  unit: z.string().trim().max(40).default(""),
});

const warningSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

export const sopCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4_000).default(""),
  category,
  locationId: z.uuid(),
  stationId: optionalUuid,
  estimatedMinutes: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(600)])
    .default("")
    .transform((value) => (value === "" ? null : value)),
  difficulty: difficulty.default("beginner"),
  coverImageFileId: optionalUuid,
  sourceVideoFileId: optionalUuid,
  materials: z.array(materialSchema).max(60).default([]),
  warnings: z.array(warningSchema).max(30).default([]),
});

export const sopDraftUpdateSchema = sopCreateSchema.partial().extend({
  expectedRevision: revision,
});

export const sopQuerySchema = z.object({
  search: z.string().trim().max(120).default(""),
  category: z.union([z.literal(""), category]).default(""),
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  stationId: z.union([z.literal(""), z.uuid()]).default(""),
  status: z.union([z.literal(""), status]).default(""),
  cursor: z.string().trim().max(500).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const sopStepCreateSchema = z.object({
  title: z.string().trim().max(160).default(""),
  instruction: z.string().trim().min(1).max(4_000),
  imageFileId: optionalUuid,
  videoFileId: optionalUuid,
  warning: z.string().trim().max(500).default(""),
  quantity: z.string().trim().max(40).default(""),
  unit: z.string().trim().max(40).default(""),
  equipmentSetting: z.string().trim().max(160).default(""),
  timerSeconds: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(7_200)])
    .default("")
    .transform((value) => (value === "" ? null : value)),
  isRequired: z.coerce.boolean().default(true),
  expectedRevision: revision,
});

export const sopStepUpdateSchema = sopStepCreateSchema;

export const sopStepReorderSchema = z.object({
  orderedStepIds: z.array(z.uuid()).min(1).max(200),
  expectedRevision: revision,
});

export const sopRevisionOnlySchema = z.object({
  expectedRevision: revision,
});

export const retrainingRuleTypeValues = [
  "none",
  "all_qualified",
  "selected_roles",
  "selected_locations",
] as const;

export const retrainingRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("all_qualified") }),
  z.object({
    type: z.literal("selected_roles"),
    jobRoles: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
  }),
  z.object({
    type: z.literal("selected_locations"),
    locationIds: z.array(z.uuid()).min(1).max(100),
  }),
]);

export const sopPublishSchema = z.object({
  expectedRevision: revision.optional(),
  changeSummary: z.string().trim().max(2_000).default(""),
  retrainingRule: retrainingRuleSchema.default({ type: "none" }),
});

export const sopVersionIdParamSchema = z.object({
  versionId: z.uuid(),
});

export const sopVersionCompareQuerySchema = z.object({
  from: z.uuid(),
  to: z.uuid(),
});

export type SopCreateInput = z.infer<typeof sopCreateSchema>;
export type SopDraftUpdateInput = z.infer<typeof sopDraftUpdateSchema>;
export type SopQuery = z.infer<typeof sopQuerySchema>;
export type SopStepCreateInput = z.infer<typeof sopStepCreateSchema>;
export type SopStepUpdateInput = z.infer<typeof sopStepUpdateSchema>;
export type SopStepReorderInput = z.infer<typeof sopStepReorderSchema>;
export type SopRevisionOnlyInput = z.infer<typeof sopRevisionOnlySchema>;
export type SopPublishInput = z.infer<typeof sopPublishSchema>;
export type RetrainingRuleInput = z.infer<typeof retrainingRuleSchema>;
