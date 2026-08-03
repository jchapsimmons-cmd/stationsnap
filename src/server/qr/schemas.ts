import { z } from "zod";

export const qrTargetTypeValues = ["station", "sop"] as const;
export const qrCodeStatusValues = ["active", "revoked"] as const;

export const qrCreateSchema = z.object({
  locationId: z.uuid(),
  targetType: z.enum(qrTargetTypeValues),
  targetId: z.uuid(),
  label: z.string().trim().max(120).default(""),
});

export const qrQuerySchema = z.object({
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  status: z.union([z.literal(""), z.enum(qrCodeStatusValues)]).default(""),
});

export type QrCreateInput = z.infer<typeof qrCreateSchema>;
export type QrQuery = z.infer<typeof qrQuerySchema>;
