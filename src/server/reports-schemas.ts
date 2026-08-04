import { z } from "zod";

export const approvalHistoryDecisionValues = ["approved", "rejected", "needs_correction"] as const;

export const approvalHistoryReportQuerySchema = z.object({
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  decision: z.union([z.literal(""), z.enum(approvalHistoryDecisionValues)]).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ApprovalHistoryReportQuery = z.infer<typeof approvalHistoryReportQuerySchema>;
