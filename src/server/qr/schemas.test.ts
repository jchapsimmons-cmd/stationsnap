import { describe, expect, it } from "vitest";
import { qrCreateSchema, qrQuerySchema } from "@/server/qr/schemas";

describe("Phase 6 QR schemas", () => {
  it("accepts a minimal QR creation request and defaults the label", () => {
    const parsed = qrCreateSchema.parse({
      locationId: crypto.randomUUID(),
      targetType: "station",
      targetId: crypto.randomUUID(),
    });
    expect(parsed.label).toBe("");
  });

  it("rejects an unknown target type", () => {
    expect(() =>
      qrCreateSchema.parse({
        locationId: crypto.randomUUID(),
        targetType: "employee",
        targetId: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it("requires a valid target id", () => {
    expect(() =>
      qrCreateSchema.parse({
        locationId: crypto.randomUUID(),
        targetType: "sop",
        targetId: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("defaults the query filters", () => {
    const query = qrQuerySchema.parse({});
    expect(query.locationId).toBe("");
    expect(query.status).toBe("");
  });

  it("rejects an unknown status filter", () => {
    expect(() => qrQuerySchema.parse({ status: "expired" })).toThrow();
  });
});
