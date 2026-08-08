import { z } from "zod";

export const createVideoDraftJobSchema = z.object({
  sourceFileId: z.uuid(),
});

export type CreateVideoDraftJobInput = z.infer<typeof createVideoDraftJobSchema>;

export const applyAiJobOutputSchema = z.object({
  outputId: z.uuid(),
});

export type ApplyAiJobOutputInput = z.infer<typeof applyAiJobOutputSchema>;
