import { z } from "zod";

export const managerLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(256),
  returnTo: z.string().max(2_048).optional(),
});

export const employeeAccessSchema = z.object({
  organizationSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,64}$/),
  locationSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,64}$/),
  returnTo: z.string().max(2_048).optional(),
});

export const employeeLoginSchema = employeeAccessSchema.extend({
  employeeNumber: z.string().trim().min(1).max(32),
  pin: z.string().regex(/^\d{4}$/),
});

export const passwordResetRequestSchema = z.object({ email: z.string().trim().email().max(254) });

export const passwordResetConfirmSchema = z
  .object({
    token: z.string().min(32).max(256),
    password: z.string().min(12).max(256),
    passwordConfirmation: z.string().min(12).max(256),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "Passwords do not match",
  });

export const pinResetSchema = z.object({
  employeeId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
});
