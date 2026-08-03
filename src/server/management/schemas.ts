import { z } from "zod";

const name = z.string().trim().min(1).max(120);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens.");
const status = z.enum(["active", "disabled"]);
const language = z.enum(["en", "es"]);
const timezone = z
  .string()
  .trim()
  .refine((value) => {
    try {
      Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA timezone.");
const optionalHttpsUrl = z
  .union([
    z.literal(""),
    z
      .url()
      .max(2_048)
      .refine((value) => value.startsWith("https://"), "Use an HTTPS URL."),
  ])
  .transform((value) => value || null);

export const organizationUpdateSchema = z.object({
  name,
  logoUrl: optionalHttpsUrl,
  defaultLanguage: language,
  timezone,
  status,
});

export const locationCreateSchema = z.object({
  name,
  accessSlug: slug,
  timezone,
  status: status.default("active"),
});

export const locationUpdateSchema = locationCreateSchema.omit({ accessSlug: true }).extend({
  accessSlug: slug,
});

export const stationCreateSchema = z.object({
  locationId: z.uuid(),
  name,
  description: z.string().trim().max(2_000).default(""),
  imageUrl: optionalHttpsUrl,
  displayOrder: z.coerce.number().int().min(1).max(10_000),
  status: status.default("active"),
});

export const stationUpdateSchema = stationCreateSchema;

export const employeeCreateSchema = z.object({
  primaryLocationId: z.uuid(),
  employeeNumber: z.string().trim().min(1).max(40),
  displayName: name,
  jobRole: z.string().trim().min(1).max(80),
  language,
  pin: z.string().regex(/^\d{4}$/, "PIN must contain exactly four digits."),
  status: status.default("active"),
});

export const employeeUpdateSchema = employeeCreateSchema.omit({ pin: true });

export const employeeQuerySchema = z.object({
  search: z.string().trim().max(120).default(""),
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  status: z.union([z.literal(""), status]).default(""),
});

export const stationQuerySchema = z.object({
  locationId: z.union([z.literal(""), z.uuid()]).default(""),
  status: z.union([z.literal(""), status]).default(""),
});

export const managerLocationAssignmentSchema = z.object({
  locationIds: z.array(z.uuid()).max(100),
});

export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>;
export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
export type StationCreateInput = z.infer<typeof stationCreateSchema>;
export type StationUpdateInput = z.infer<typeof stationUpdateSchema>;
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
export type EmployeeQuery = z.infer<typeof employeeQuerySchema>;
export type StationQuery = z.infer<typeof stationQuerySchema>;
