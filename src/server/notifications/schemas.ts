import { z } from "zod";
import { notificationTypeValues } from "@/server/notifications/labels";

/** List-page query for both `/manager/notifications` and `/employee/notifications`, mirroring
 * `activityQuerySchema`'s empty-string-is-no-filter convention. */
export const notificationQuerySchema = z.object({
  unreadOnly: z.union([z.literal(""), z.literal("1")]).default(""),
  type: z.union([z.literal(""), z.enum(notificationTypeValues)]).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
