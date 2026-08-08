import { describe, expect, it } from "vitest";
import {
  employeeCreateSchema,
  employeeUpdateSchema,
  organizationUpdateSchema,
  stationCreateSchema,
} from "@/server/management/schemas";

function validEmployee(overrides: Record<string, unknown> = {}) {
  return {
    primaryLocationId: crypto.randomUUID(),
    employeeNumber: "42",
    displayName: "Jamie",
    jobRole: "Cook",
    language: "en",
    pin: "1234",
    status: "active",
    ...overrides,
  };
}

describe("Phase 3 management schemas", () => {
  it("accepts valid organization settings and normalizes an empty logo", () => {
    expect(
      organizationUpdateSchema.parse({
        name: "Demo Kitchen",
        logoUrl: "",
        defaultLanguage: "en",
        timezone: "America/Chicago",
        status: "active",
      }).logoUrl,
    ).toBeNull();
  });

  it("rejects invalid timezones and insecure media URLs", () => {
    expect(() =>
      organizationUpdateSchema.parse({
        name: "Demo Kitchen",
        logoUrl: "http://example.com/logo.png",
        defaultLanguage: "en",
        timezone: "Central Time",
        status: "active",
      }),
    ).toThrow();
  });

  it("requires four-digit employee PINs", () => {
    expect(() =>
      employeeCreateSchema.parse({
        primaryLocationId: crypto.randomUUID(),
        employeeNumber: "42",
        displayName: "Jamie",
        jobRole: "Cook",
        language: "en",
        pin: "12345",
        status: "active",
      }),
    ).toThrow();
  });

  it("defaults phone and SMS opt-in to unset", () => {
    const result = employeeCreateSchema.parse(validEmployee());
    expect(result.phone).toBe("");
    expect(result.smsOptIn).toBe(false);
  });

  it("accepts a valid E.164 phone with SMS opted in", () => {
    const result = employeeCreateSchema.parse(
      validEmployee({ phone: "+15551234567", smsOptIn: true }),
    );
    expect(result.phone).toBe("+15551234567");
    expect(result.smsOptIn).toBe(true);
  });

  it("rejects a non-E.164 phone number", () => {
    expect(() => employeeCreateSchema.parse(validEmployee({ phone: "555-123-4567" }))).toThrow();
  });

  it("rejects SMS opt-in with no phone number, on create and update alike", () => {
    expect(() => employeeCreateSchema.parse(validEmployee({ smsOptIn: true }))).toThrow();
    const { pin: _pin, ...updateInput } = validEmployee({ smsOptIn: true });
    void _pin;
    expect(() => employeeUpdateSchema.parse(updateInput)).toThrow();
  });

  it("bounds station display order", () => {
    expect(() =>
      stationCreateSchema.parse({
        locationId: crypto.randomUUID(),
        name: "Grill",
        description: "",
        imageUrl: "",
        displayOrder: 0,
        status: "active",
      }),
    ).toThrow();
  });
});
