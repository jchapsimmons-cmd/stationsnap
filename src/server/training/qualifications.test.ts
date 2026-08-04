import { describe, expect, it } from "vitest";
import { classifyQualification, isOrderSatisfied } from "@/server/training/qualifications";
import {
  qualificationRevokeSchema,
  trainingPathCreateSchema,
  trainingPathQuerySchema,
  trainingPathUpdateSchema,
  qualificationOverviewQuerySchema,
} from "@/server/training/paths-schemas";

describe("isOrderSatisfied", () => {
  it("accepts items completed strictly in displayOrder order", () => {
    const result = isOrderSatisfied([
      { displayOrder: 1, completedAt: new Date("2026-01-01T00:00:00Z") },
      { displayOrder: 2, completedAt: new Date("2026-01-02T00:00:00Z") },
      { displayOrder: 3, completedAt: new Date("2026-01-03T00:00:00Z") },
    ]);
    expect(result).toBe(true);
  });

  it("accepts items completed at the exact same instant (non-decreasing, not strictly increasing)", () => {
    const same = new Date("2026-01-01T00:00:00Z");
    const result = isOrderSatisfied([
      { displayOrder: 1, completedAt: same },
      { displayOrder: 2, completedAt: same },
    ]);
    expect(result).toBe(true);
  });

  it("rejects an item completed before the item ahead of it in order", () => {
    const result = isOrderSatisfied([
      { displayOrder: 1, completedAt: new Date("2026-01-05T00:00:00Z") },
      { displayOrder: 2, completedAt: new Date("2026-01-01T00:00:00Z") },
    ]);
    expect(result).toBe(false);
  });

  it("is independent of input array order — it sorts by displayOrder first", () => {
    const result = isOrderSatisfied([
      { displayOrder: 2, completedAt: new Date("2026-01-01T00:00:00Z") },
      { displayOrder: 1, completedAt: new Date("2026-01-05T00:00:00Z") },
    ]);
    expect(result).toBe(false);
  });

  it("accepts a single item or an empty list trivially", () => {
    expect(isOrderSatisfied([])).toBe(true);
    expect(isOrderSatisfied([{ displayOrder: 1, completedAt: new Date() }])).toBe(true);
  });

  it("catches a violation buried among otherwise well-ordered items", () => {
    const result = isOrderSatisfied([
      { displayOrder: 1, completedAt: new Date("2026-01-01T00:00:00Z") },
      { displayOrder: 2, completedAt: new Date("2026-01-10T00:00:00Z") },
      { displayOrder: 3, completedAt: new Date("2026-01-05T00:00:00Z") },
      { displayOrder: 4, completedAt: new Date("2026-01-20T00:00:00Z") },
    ]);
    expect(result).toBe(false);
  });
});

describe("classifyQualification", () => {
  const now = new Date("2026-08-04T00:00:00Z");

  it("classifies a non-expiring active episode as qualified and never expiring soon", () => {
    const result = classifyQualification({
      hasActiveEpisode: true,
      expiresAt: null,
      hasNonTerminalTraining: false,
      now,
    });
    expect(result).toEqual({ classification: "qualified", isExpiringSoon: false });
  });

  it("classifies an active episode expiring well in the future as qualified, not expiring soon", () => {
    const expiresAt = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const result = classifyQualification({
      hasActiveEpisode: true,
      expiresAt,
      hasNonTerminalTraining: false,
      now,
    });
    expect(result).toEqual({ classification: "qualified", isExpiringSoon: false });
  });

  it("flags an active episode expiring within 30 days as qualified and expiring soon", () => {
    const expiresAt = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const result = classifyQualification({
      hasActiveEpisode: true,
      expiresAt,
      hasNonTerminalTraining: false,
      now,
    });
    expect(result).toEqual({ classification: "qualified", isExpiringSoon: true });
  });

  it("treats exactly the 30-day boundary as expiring soon", () => {
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const result = classifyQualification({
      hasActiveEpisode: true,
      expiresAt,
      hasNonTerminalTraining: false,
      now,
    });
    expect(result.isExpiringSoon).toBe(true);
  });

  it("classifies an active episode whose expiry has passed as expired, not qualified", () => {
    const expiresAt = new Date(now.getTime() - 1000);
    const result = classifyQualification({
      hasActiveEpisode: true,
      expiresAt,
      hasNonTerminalTraining: false,
      now,
    });
    expect(result).toEqual({ classification: "expired", isExpiringSoon: false });
  });

  it("classifies no episode with non-terminal training as training", () => {
    const result = classifyQualification({
      hasActiveEpisode: false,
      expiresAt: null,
      hasNonTerminalTraining: true,
      now,
    });
    expect(result).toEqual({ classification: "training", isExpiringSoon: false });
  });

  it("classifies no episode and no training as missing", () => {
    const result = classifyQualification({
      hasActiveEpisode: false,
      expiresAt: null,
      hasNonTerminalTraining: false,
      now,
    });
    expect(result).toEqual({ classification: "missing", isExpiringSoon: false });
  });
});

describe("Training path create schema", () => {
  it("accepts a well-formed path with one required and one optional item", () => {
    const result = trainingPathCreateSchema.parse({
      title: "Grill Certification",
      locationId: crypto.randomUUID(),
      items: [
        { sopId: crypto.randomUUID(), isRequired: true, versionPolicy: "current_version" },
        { sopId: crypto.randomUUID(), isRequired: false, versionPolicy: "any_passed_version" },
      ],
      definition: { name: "Grill Certified" },
    });
    expect(result.enforceOrder).toBe(true);
    expect(result.status).toBe("active");
    expect(result.stationId).toBeNull();
    expect(result.definition.defaultValidityDays).toBeNull();
    expect(result.items).toHaveLength(2);
  });

  it("defaults isRequired and versionPolicy per item", () => {
    const result = trainingPathCreateSchema.parse({
      title: "Grill Certification",
      locationId: crypto.randomUUID(),
      items: [{ sopId: crypto.randomUUID() }],
      definition: { name: "Grill Certified" },
    });
    expect(result.items[0]).toEqual({
      sopId: result.items[0]!.sopId,
      isRequired: true,
      versionPolicy: "current_version",
    });
  });

  it("rejects an empty items list", () => {
    expect(() =>
      trainingPathCreateSchema.parse({
        title: "Grill Certification",
        locationId: crypto.randomUUID(),
        items: [],
        definition: { name: "Grill Certified" },
      }),
    ).toThrow();
  });

  it("rejects more than 50 items", () => {
    expect(() =>
      trainingPathCreateSchema.parse({
        title: "Grill Certification",
        locationId: crypto.randomUUID(),
        items: Array.from({ length: 51 }, () => ({ sopId: crypto.randomUUID() })),
        definition: { name: "Grill Certified" },
      }),
    ).toThrow();
  });

  it("rejects a duplicate SOP appearing twice in the items list", () => {
    const sopId = crypto.randomUUID();
    expect(() =>
      trainingPathCreateSchema.parse({
        title: "Grill Certification",
        locationId: crypto.randomUUID(),
        items: [{ sopId }, { sopId }],
        definition: { name: "Grill Certified" },
      }),
    ).toThrow();
  });

  it("accepts and coerces a positive default validity days value", () => {
    const result = trainingPathCreateSchema.parse({
      title: "Grill Certification",
      locationId: crypto.randomUUID(),
      items: [{ sopId: crypto.randomUUID() }],
      definition: { name: "Grill Certified", defaultValidityDays: 90 },
    });
    expect(result.definition.defaultValidityDays).toBe(90);
  });

  it("rejects an unknown version policy", () => {
    expect(() =>
      trainingPathCreateSchema.parse({
        title: "Grill Certification",
        locationId: crypto.randomUUID(),
        items: [{ sopId: crypto.randomUUID(), versionPolicy: "latest" }],
        definition: { name: "Grill Certified" },
      }),
    ).toThrow();
  });

  it("accepts an explicit station scoping the path to one station", () => {
    const stationId = crypto.randomUUID();
    const result = trainingPathCreateSchema.parse({
      title: "Grill Certification",
      locationId: crypto.randomUUID(),
      stationId,
      items: [{ sopId: crypto.randomUUID() }],
      definition: { name: "Grill Certified" },
    });
    expect(result.stationId).toBe(stationId);
  });
});

describe("Training path update schema", () => {
  it("has no locationId or stationId fields — the path's location is immutable", () => {
    const result = trainingPathUpdateSchema.parse({
      title: "Grill Certification",
      items: [{ sopId: crypto.randomUUID() }],
      definition: { name: "Grill Certified" },
    });
    expect(result).not.toHaveProperty("locationId");
    expect(result).not.toHaveProperty("stationId");
  });

  it("accepts an archiving update (status: disabled)", () => {
    const result = trainingPathUpdateSchema.parse({
      title: "Grill Certification",
      status: "disabled",
      items: [{ sopId: crypto.randomUUID() }],
      definition: { name: "Grill Certified" },
    });
    expect(result.status).toBe("disabled");
  });
});

describe("Training path query schema", () => {
  it("defaults location and status filters to unset", () => {
    const result = trainingPathQuerySchema.parse({});
    expect(result.locationId).toBe("");
    expect(result.status).toBe("");
  });
});

describe("Qualification overview query schema", () => {
  it("defaults to no location filter and no tab (all rows)", () => {
    const result = qualificationOverviewQuerySchema.parse({});
    expect(result.locationId).toBe("");
    expect(result.tab).toBe("");
  });

  it("accepts every known tab", () => {
    for (const tab of ["qualified", "training", "missing", "expiring", "expired"]) {
      expect(qualificationOverviewQuerySchema.parse({ tab }).tab).toBe(tab);
    }
  });

  it("rejects an unknown tab", () => {
    expect(() => qualificationOverviewQuerySchema.parse({ tab: "archived" })).toThrow();
  });
});

describe("Qualification revoke schema", () => {
  it("defaults the note to an empty string", () => {
    expect(qualificationRevokeSchema.parse({}).note).toBe("");
  });

  it("trims and bounds the note length", () => {
    expect(qualificationRevokeSchema.parse({ note: "  Left the role.  " }).note).toBe(
      "Left the role.",
    );
    expect(() => qualificationRevokeSchema.parse({ note: "a".repeat(1001) })).toThrow();
  });
});
