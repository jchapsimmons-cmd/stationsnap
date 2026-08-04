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

export const employeeSopQuerySchema = z.object({
  search: z.string().trim().max(120).default(""),
  category: z.union([z.literal(""), category]).default(""),
  stationId: z.union([z.literal(""), z.uuid()]).default(""),
  cursor: z.string().trim().max(500).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const sopVersionIdParamSchema = z.object({
  versionId: z.uuid(),
});

export const sopVersionCompareQuerySchema = z.object({
  from: z.uuid(),
  to: z.uuid(),
});

export const trainingRequirementStateValues = ["disabled", "optional", "required"] as const;
export const trainingModeValues = ["learn", "guided", "test", "demonstration"] as const;
export const trainingQuestionTypeValues = [
  "single_choice",
  "multiple_choice",
  "true_false",
] as const;
export const trainingQuestionPlacementValues = ["before_step", "after_step", "final"] as const;
export const trainingExplanationPolicyValues = ["never", "on_incorrect", "always"] as const;

const trainingRequirementState = z.enum(trainingRequirementStateValues);
const trainingMode = z.enum(trainingModeValues);
const trainingQuestionType = z.enum(trainingQuestionTypeValues);
const trainingQuestionPlacement = z.enum(trainingQuestionPlacementValues);
const trainingExplanationPolicy = z.enum(trainingExplanationPolicyValues);

const optionalBoundedInt = (min: number, max: number) =>
  z
    .union([z.literal(""), z.coerce.number().int().min(min).max(max)])
    .default("")
    .transform((value) => (value === "" ? null : value));

export const trainingConfigUpdateSchema = z
  .object({
    requirementState: trainingRequirementState.default("disabled"),
    defaultMode: trainingMode.default("learn"),
    allowBacktracking: z.coerce.boolean().default(true),
    requireSequentialProgress: z.coerce.boolean().default(true),
    requireFullVideoWatch: z.coerce.boolean().default(false),
    requireEvidenceApproval: z.coerce.boolean().default(true),
    passingScorePercent: z.coerce.number().int().min(0).max(100).default(80),
    maxAttempts: z.coerce.number().int().min(1).max(20).default(3),
    qualificationValidityDays: optionalBoundedInt(1, 3_650),
    retrainingGraceDays: optionalBoundedInt(0, 365),
    expectedRevision: revision,
  })
  .refine(
    (value) =>
      value.requirementState !== "disabled" ||
      (value.qualificationValidityDays === null && value.retrainingGraceDays === null),
    {
      message:
        "Qualification validity and retraining grace only apply when training is optional or required.",
      path: ["requirementState"],
    },
  );

export const stepTrainingRequirementsSchema = z
  .object({
    requireFullVideo: z.coerce.boolean().default(false),
    requireConfirmation: z.coerce.boolean().default(false),
    requireTimer: z.coerce.boolean().default(false),
    requireQuestion: z.coerce.boolean().default(false),
    requirePhoto: z.coerce.boolean().default(false),
    requireVideo: z.coerce.boolean().default(false),
    requireApproval: z.coerce.boolean().default(false),
    expectedRevision: revision,
  })
  .refine(
    (value) =>
      !value.requireApproval ||
      value.requireConfirmation ||
      value.requireQuestion ||
      value.requirePhoto ||
      value.requireVideo,
    {
      message:
        "Approval requires at least one submitted requirement: confirmation, question, photo, or video.",
      path: ["requireApproval"],
    },
  );

const trainingQuestionChoiceSchema = z.object({
  text: z.string().trim().min(1).max(300),
  isCorrect: z.coerce.boolean().default(false),
});

export const trainingQuestionCreateSchema = z
  .object({
    stepId: optionalUuid,
    type: trainingQuestionType,
    text: z.string().trim().min(1).max(1_000),
    explanation: z.string().trim().max(2_000).default(""),
    points: z.coerce.number().int().min(1).max(100).default(1),
    placement: trainingQuestionPlacement,
    explanationPolicy: trainingExplanationPolicy.default("on_incorrect"),
    choices: z.array(trainingQuestionChoiceSchema).min(2).max(8),
    expectedRevision: revision,
  })
  .refine((value) => (value.stepId ? value.placement !== "final" : value.placement === "final"), {
    message:
      "Step questions must use the before/after-step placement; final questions must use the final placement.",
    path: ["placement"],
  })
  .refine(
    (value) => {
      const correctCount = value.choices.filter((choice) => choice.isCorrect).length;
      if (value.type === "true_false") return value.choices.length === 2 && correctCount === 1;
      if (value.type === "single_choice") return correctCount === 1;
      return correctCount >= 1;
    },
    {
      message:
        "True/false questions need exactly two choices with one correct; single-choice questions need exactly one correct choice; multiple-choice questions need at least one correct choice.",
      path: ["choices"],
    },
  );

export const trainingQuestionUpdateSchema = trainingQuestionCreateSchema;

export const trainingQuestionReorderSchema = z.object({
  stepId: optionalUuid.optional().default(null),
  orderedQuestionIds: z.array(z.uuid()).min(1).max(200),
  expectedRevision: revision,
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
export type EmployeeSopQuery = z.infer<typeof employeeSopQuerySchema>;
export type TrainingConfigUpdateInput = z.infer<typeof trainingConfigUpdateSchema>;
export type StepTrainingRequirementsInput = z.infer<typeof stepTrainingRequirementsSchema>;
export type TrainingQuestionCreateInput = z.infer<typeof trainingQuestionCreateSchema>;
export type TrainingQuestionUpdateInput = z.infer<typeof trainingQuestionUpdateSchema>;
export type TrainingQuestionReorderInput = z.infer<typeof trainingQuestionReorderSchema>;

// Manual translations are English-source, Spanish-target only for this phase; AI-assisted
// drafting and additional target locales are deferred to Phase 20.
export const translationSourceLocaleValues = ["en"] as const;
export const translationTargetLocaleValues = ["es"] as const;

export const translationUpsertSchema = z.discriminatedUnion("entityType", [
  z.object({
    entityType: z.literal("sop_version"),
    entityId: z.uuid(),
    field: z.enum(["title", "description"]),
    targetLocale: z.enum(translationTargetLocaleValues),
    translatedText: z.string().trim().max(4_000),
  }),
  z.object({
    entityType: z.literal("sop_material"),
    entityId: z.uuid(),
    field: z.literal("name"),
    targetLocale: z.enum(translationTargetLocaleValues),
    translatedText: z.string().trim().max(160),
  }),
  z.object({
    entityType: z.literal("sop_warning"),
    entityId: z.uuid(),
    field: z.literal("text"),
    targetLocale: z.enum(translationTargetLocaleValues),
    translatedText: z.string().trim().max(500),
  }),
  z.object({
    entityType: z.literal("sop_step"),
    entityId: z.uuid(),
    field: z.enum(["title", "instruction", "warning"]),
    targetLocale: z.enum(translationTargetLocaleValues),
    translatedText: z.string().trim().max(4_000),
  }),
]);

export const translationMatrixQuerySchema = z.object({
  targetLocale: z.enum(translationTargetLocaleValues).default("es"),
});

export const employeeSopLocaleQuerySchema = z.object({
  lang: z.enum(["en", ...translationTargetLocaleValues]).default("en"),
});

export type TranslationUpsertInput = z.infer<typeof translationUpsertSchema>;
export type TranslationMatrixQuery = z.infer<typeof translationMatrixQuerySchema>;
export type EmployeeSopLocaleQuery = z.infer<typeof employeeSopLocaleQuerySchema>;
