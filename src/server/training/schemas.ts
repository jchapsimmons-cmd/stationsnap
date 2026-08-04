import { z } from "zod";

const revision = z.coerce.number().int().min(1);

export const trainingAssignmentStatusValues = [
  "assigned",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
] as const;

export const trainingAssignmentSkipReasonValues = [
  "duplicate_active",
  "employee_inactive",
  "location_mismatch",
  "not_found",
] as const;

const dueDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Enter a valid calendar date.");

const employeesTargetSchema = z.object({
  type: z.literal("employees"),
  employeeIds: z
    .array(z.uuid())
    .min(1, "Choose at least one employee.")
    .max(200, "Choose at most 200 employees.")
    .transform((ids) => [...new Set(ids)]),
});

const jobRolesTargetSchema = z.object({
  type: z.literal("jobRoles"),
  jobRoles: z
    .array(z.string().trim().min(1).max(80))
    .min(1, "Choose at least one job role.")
    .max(20, "Choose at most 20 job roles.")
    .transform((roles) => [...new Set(roles)]),
});

const locationTargetSchema = z.object({
  type: z.literal("location"),
});

export const trainingAssignmentTargetSchema = z.discriminatedUnion("type", [
  employeesTargetSchema,
  jobRolesTargetSchema,
  locationTargetSchema,
]);

export const trainingAssignmentCreateSchema = z.object({
  sopId: z.uuid(),
  requiredMode: z.enum(["learn", "guided", "test", "demonstration"]).optional(),
  dueDate: dueDateSchema.optional(),
  target: trainingAssignmentTargetSchema,
});

export const trainingAssignmentQuerySchema = z.object({
  status: z.union([z.literal(""), z.enum(trainingAssignmentStatusValues)]).default(""),
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
});

export const trainingProgressReportQuerySchema = z.object({
  status: z.union([z.literal(""), z.enum(trainingAssignmentStatusValues)]).default(""),
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  search: z.string().trim().max(120).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const trainingSessionRevisionSchema = z.object({
  expectedRevision: revision,
});

export const trainingStepActionValues = [
  "viewed",
  "confirmed",
  "video_watched",
  "timer_completed",
] as const;

export const trainingStepActionSchema = z.object({
  action: z.enum(trainingStepActionValues),
  expectedRevision: revision,
});

export const trainingAnswerSubmitSchema = z.object({
  selectedChoiceIds: z.array(z.uuid()).min(1).max(8),
  expectedRevision: revision,
});

export const trainingEvidenceUploadFormSchema = z.object({
  employeeNote: z.string().trim().max(500).default(""),
  expectedRevision: revision,
});

export const trainingSessionSubmitSchema = z.object({
  expectedRevision: revision,
});

export const approvalSubmissionStatusValues = [
  "pending",
  "approved",
  "rejected",
  "needs_correction",
] as const;

export const approvalDecisionValues = ["approved", "rejected", "needs_correction"] as const;

/**
 * Manager approval queue filters. Mirrors `trainingAssignmentQuerySchema`, except the status
 * default is `pending`: the queue's purpose is undecided work, and the decided statuses are
 * history views a manager opts into.
 */
export const approvalQueueQuerySchema = z.object({
  status: z.union([z.literal(""), z.enum(approvalSubmissionStatusValues)]).default("pending"),
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
});

const requiredDecisionNote = z
  .string()
  .trim()
  .min(1, "Explain what the employee must fix.")
  .max(1000, "Keep the note under 1000 characters.");

/**
 * A decision is a discriminated union so the note requirement is expressed once, structurally:
 * `rejected` and `needs_correction` carry a mandatory non-empty note, `approved` an optional one.
 */
export const approvalDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approved"),
    note: z.string().trim().max(1000, "Keep the note under 1000 characters.").default(""),
  }),
  z.object({ decision: z.literal("rejected"), note: requiredDecisionNote }),
  z.object({ decision: z.literal("needs_correction"), note: requiredDecisionNote }),
]);

/** Employee resubmission of replacement evidence against an open correction request. */
export const approvalResubmitFormSchema = z.object({
  stepId: z.uuid(),
  employeeNote: z.string().trim().max(500).default(""),
  expectedRevision: revision,
});

export type TrainingAssignmentTargetInput = z.infer<typeof trainingAssignmentTargetSchema>;
export type TrainingAssignmentCreateInput = z.infer<typeof trainingAssignmentCreateSchema>;
export type TrainingAssignmentQuery = z.infer<typeof trainingAssignmentQuerySchema>;
export type TrainingAssignmentSkipReason = (typeof trainingAssignmentSkipReasonValues)[number];
export type TrainingSessionRevisionInput = z.infer<typeof trainingSessionRevisionSchema>;
export type TrainingStepActionInput = z.infer<typeof trainingStepActionSchema>;
export type TrainingAnswerSubmitInput = z.infer<typeof trainingAnswerSubmitSchema>;
export type TrainingEvidenceUploadFormInput = z.infer<typeof trainingEvidenceUploadFormSchema>;
export type TrainingSessionSubmitInput = z.infer<typeof trainingSessionSubmitSchema>;
export type ApprovalSubmissionStatus = (typeof approvalSubmissionStatusValues)[number];
export type ApprovalDecisionValue = (typeof approvalDecisionValues)[number];
export type ApprovalQueueQuery = z.infer<typeof approvalQueueQuerySchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
export type ApprovalResubmitFormInput = z.infer<typeof approvalResubmitFormSchema>;
export type TrainingProgressReportQuery = z.infer<typeof trainingProgressReportQuerySchema>;
