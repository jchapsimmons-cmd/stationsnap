import { describe, expect, it } from "vitest";
import {
  employeeCreateSchema,
  organizationUpdateSchema,
  stationCreateSchema,
} from "@/server/management/schemas";

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
