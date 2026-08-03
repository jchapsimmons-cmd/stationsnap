import { describe, expect, it } from "vitest";
import {
  employeeLoginSchema,
  managerLoginSchema,
  passwordResetConfirmSchema,
} from "@/server/auth/schemas";

describe("authentication input schemas", () => {
  it("requires a four-digit employee PIN", () => {
    const base = {
      organizationSlug: "demo-org",
      locationSlug: "downtown",
      employeeNumber: "1001",
    };
    expect(employeeLoginSchema.safeParse({ ...base, pin: "1234" }).success).toBe(true);
    expect(employeeLoginSchema.safeParse({ ...base, pin: "12345" }).success).toBe(false);
    expect(employeeLoginSchema.safeParse({ ...base, pin: "12ab" }).success).toBe(false);
  });

  it("requires strong manager password lengths", () => {
    expect(
      managerLoginSchema.safeParse({ email: "owner@example.com", password: "short" }).success,
    ).toBe(false);
  });

  it("requires matching password reset values", () => {
    expect(
      passwordResetConfirmSchema.safeParse({
        token: "a".repeat(48),
        password: "a sufficiently long password",
        passwordConfirmation: "a different long password",
      }).success,
    ).toBe(false);
  });
});
