import { z } from "zod";
import { domainEventTypeValues } from "@/server/events";

export const activityQuerySchema = z.object({
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  type: z.union([z.literal(""), z.enum(domainEventTypeValues)]).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ActivityQueryInput = z.infer<typeof activityQuerySchema>;
