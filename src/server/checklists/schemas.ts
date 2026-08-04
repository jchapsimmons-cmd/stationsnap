import { z } from "zod";

const revision = z.coerce.number().int().min(1);

export const checklistTypeValues = ["opening", "closing", "cleaning", "prep", "custom"] as const;
export const checklistRecurrenceTypeValues = ["once", "daily", "weekly"] as const;
export const checklistStatusValues = ["active", "disabled"] as const;
export const checklistRunStatusValues = [
  "in_progress",
  "awaiting_approval",
  "submitted",
  "rejected",
] as const;

const optionalUuid = z
  .union([z.literal(""), z.uuid()])
  .default("")
  .transform((value) => value || null);

const optionalTimerSeconds = z
  .union([z.literal(""), z.coerce.number().int().min(1).max(7_200)])
  .default("")
  .transform((value) => (value === "" ? null : value));

const checklistItemInputSchema = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1).max(160),
  instructions: z.string().trim().max(2_000).default(""),
  isRequired: z.coerce.boolean().default(true),
  timerSeconds: optionalTimerSeconds,
  requirePhoto: z.coerce.boolean().default(false),
  requireApproval: z.coerce.boolean().default(false),
  requireNote: z.coerce.boolean().default(false),
  referenceFileId: optionalUuid,
});

const checklistItemsSchema = z
  .array(checklistItemInputSchema)
  .min(1, "Add at least one item to the checklist.")
  .max(100, "A checklist may contain at most 100 items.");

const checklistDefinitionFieldsSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(""),
  type: z.enum(checklistTypeValues),
  recurrenceType: z.enum(checklistRecurrenceTypeValues).default("once"),
  status: z.enum(checklistStatusValues).default("active"),
});

export const checklistCreateSchema = checklistDefinitionFieldsSchema.extend({
  locationId: z.uuid(),
  stationId: optionalUuid,
  items: checklistItemsSchema,
});

export const checklistUpdateSchema = checklistDefinitionFieldsSchema.extend({
  items: checklistItemsSchema,
});

export const checklistQuerySchema = z.object({
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  status: z.union([z.literal(""), z.enum(checklistStatusValues)]).default(""),
  type: z.union([z.literal(""), z.enum(checklistTypeValues)]).default(""),
});

export const checklistRunQuerySchema = z.object({
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  status: z.union([z.literal(""), z.enum(checklistRunStatusValues)]).default(""),
});

export const checklistCompletionReportQuerySchema = z.object({
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  status: z.union([z.literal(""), z.enum(checklistRunStatusValues)]).default(""),
  search: z.string().trim().max(120).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const checklistItemActionValues = ["ticked", "unticked", "timer_completed"] as const;

export const checklistItemActionSchema = z.object({
  action: z.enum(checklistItemActionValues),
  expectedRevision: revision,
});

export const checklistItemNoteSchema = z.object({
  employeeNote: z.string().trim().max(500).default(""),
  expectedRevision: revision,
});

export const checklistItemEvidenceUploadFormSchema = z.object({
  employeeNote: z.string().trim().max(500).default(""),
  expectedRevision: revision,
});

export const checklistRunSubmitSchema = z.object({
  expectedRevision: revision,
});

export const checklistApprovalSubmissionStatusValues = [
  "pending",
  "approved",
  "rejected",
  "needs_correction",
] as const;

export const checklistApprovalDecisionValues = [
  "approved",
  "rejected",
  "needs_correction",
] as const;

const requiredDecisionNote = z
  .string()
  .trim()
  .min(1, "Explain what the employee must fix.")
  .max(1_000, "Keep the note under 1000 characters.");

export const checklistApprovalDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approved"),
    note: z.string().trim().max(1_000, "Keep the note under 1000 characters.").default(""),
  }),
  z.object({ decision: z.literal("rejected"), note: requiredDecisionNote }),
  z.object({ decision: z.literal("needs_correction"), note: requiredDecisionNote }),
]);

export type ChecklistType = (typeof checklistTypeValues)[number];
export type ChecklistRecurrenceType = (typeof checklistRecurrenceTypeValues)[number];
export type ChecklistItemInput = z.infer<typeof checklistItemInputSchema>;
export type ChecklistCreateInput = z.infer<typeof checklistCreateSchema>;
export type ChecklistUpdateInput = z.infer<typeof checklistUpdateSchema>;
export type ChecklistQuery = z.infer<typeof checklistQuerySchema>;
export type ChecklistRunQuery = z.infer<typeof checklistRunQuerySchema>;
export type ChecklistCompletionReportQuery = z.infer<typeof checklistCompletionReportQuerySchema>;
export type ChecklistItemActionInput = z.infer<typeof checklistItemActionSchema>;
export type ChecklistItemNoteInput = z.infer<typeof checklistItemNoteSchema>;
export type ChecklistItemEvidenceUploadFormInput = z.infer<
  typeof checklistItemEvidenceUploadFormSchema
>;
export type ChecklistRunSubmitInput = z.infer<typeof checklistRunSubmitSchema>;
export type ChecklistApprovalDecisionInput = z.infer<typeof checklistApprovalDecisionSchema>;
