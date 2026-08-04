import { z } from "zod";

const revision = z.coerce.number().int().min(1);

export const trainingAssignmentCreateSchema = z.object({
  employeeId: z.uuid(),
  sopId: z.uuid(),
  requiredMode: z.enum(["learn", "guided", "test", "demonstration"]).optional(),
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

export type TrainingAssignmentCreateInput = z.infer<typeof trainingAssignmentCreateSchema>;
export type TrainingSessionRevisionInput = z.infer<typeof trainingSessionRevisionSchema>;
export type TrainingStepActionInput = z.infer<typeof trainingStepActionSchema>;
export type TrainingAnswerSubmitInput = z.infer<typeof trainingAnswerSubmitSchema>;
export type TrainingEvidenceUploadFormInput = z.infer<typeof trainingEvidenceUploadFormSchema>;
export type TrainingSessionSubmitInput = z.infer<typeof trainingSessionSubmitSchema>;
