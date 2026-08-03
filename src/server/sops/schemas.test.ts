import { describe, expect, it } from "vitest";
import {
  employeeSopQuerySchema,
  retrainingRuleSchema,
  sopCreateSchema,
  sopDraftUpdateSchema,
  sopPublishSchema,
  sopQuerySchema,
  sopStepCreateSchema,
  sopStepReorderSchema,
  sopVersionCompareQuerySchema,
} from "@/server/sops/schemas";

const baseCreate = {
  title: "Grill sanitation",
  description: "",
  category: "cleaning",
  locationId: crypto.randomUUID(),
  stationId: "",
  estimatedMinutes: "",
  difficulty: "beginner",
  coverImageFileId: "",
  sourceVideoFileId: "",
  materials: [],
  warnings: [],
};

describe("Phase 4 SOP schemas", () => {
  it("accepts a minimal SOP and normalizes optional fields", () => {
    const result = sopCreateSchema.parse(baseCreate);
    expect(result.stationId).toBeNull();
    expect(result.estimatedMinutes).toBeNull();
    expect(result.coverImageFileId).toBeNull();
  });

  it("rejects a blank title", () => {
    expect(() => sopCreateSchema.parse({ ...baseCreate, title: "  " })).toThrow();
  });

  it("rejects an invalid category", () => {
    expect(() => sopCreateSchema.parse({ ...baseCreate, category: "not-a-category" })).toThrow();
  });

  it("bounds estimated completion time", () => {
    expect(() => sopCreateSchema.parse({ ...baseCreate, estimatedMinutes: "0" })).toThrow();
    expect(() => sopCreateSchema.parse({ ...baseCreate, estimatedMinutes: "601" })).toThrow();
  });

  it("accepts materials and warnings rows", () => {
    const result = sopCreateSchema.parse({
      ...baseCreate,
      materials: [{ kind: "ingredient", name: "Salt", quantity: "1", unit: "tsp" }],
      warnings: [{ text: "Hot surface" }],
    });
    expect(result.materials).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it("requires an expectedRevision for draft updates", () => {
    expect(() => sopDraftUpdateSchema.parse({ title: "Updated" })).toThrow();
    expect(
      sopDraftUpdateSchema.parse({ title: "Updated", expectedRevision: 1 }).expectedRevision,
    ).toBe(1);
  });

  it("defaults SOP query filters and bounds the page size", () => {
    const query = sopQuerySchema.parse({});
    expect(query.status).toBe("");
    expect(query.limit).toBe(20);
    expect(() => sopQuerySchema.parse({ limit: 500 })).toThrow();
  });

  it("requires step instructions and bounds timer seconds", () => {
    const baseStep = {
      instruction: "Preheat the grill",
      imageFileId: "",
      videoFileId: "",
      expectedRevision: 1,
    };
    expect(() => sopStepCreateSchema.parse({ ...baseStep, instruction: "" })).toThrow();
    expect(() => sopStepCreateSchema.parse({ ...baseStep, timerSeconds: "0" })).toThrow();
    const parsed = sopStepCreateSchema.parse(baseStep);
    expect(parsed.isRequired).toBe(true);
  });

  it("requires at least one step id when reordering", () => {
    expect(() => sopStepReorderSchema.parse({ orderedStepIds: [], expectedRevision: 1 })).toThrow();
  });
});

describe("Phase 5 SOP version schemas", () => {
  it("defaults the publish change summary and retraining rule", () => {
    const parsed = sopPublishSchema.parse({});
    expect(parsed.changeSummary).toBe("");
    expect(parsed.retrainingRule).toEqual({ type: "none" });
  });

  it("accepts a selected-roles retraining rule with at least one role", () => {
    const parsed = retrainingRuleSchema.parse({ type: "selected_roles", jobRoles: ["Cook"] });
    expect(parsed).toEqual({ type: "selected_roles", jobRoles: ["Cook"] });
    expect(() => retrainingRuleSchema.parse({ type: "selected_roles", jobRoles: [] })).toThrow();
  });

  it("accepts a selected-locations retraining rule with at least one location", () => {
    const locationId = crypto.randomUUID();
    const parsed = retrainingRuleSchema.parse({
      type: "selected_locations",
      locationIds: [locationId],
    });
    expect(parsed).toEqual({ type: "selected_locations", locationIds: [locationId] });
    expect(() =>
      retrainingRuleSchema.parse({ type: "selected_locations", locationIds: [] }),
    ).toThrow();
  });

  it("rejects an unknown retraining rule type", () => {
    expect(() => retrainingRuleSchema.parse({ type: "everyone" })).toThrow();
  });

  it("requires both version ids to compare", () => {
    expect(() => sopVersionCompareQuerySchema.parse({ from: crypto.randomUUID() })).toThrow();
    const from = crypto.randomUUID();
    const to = crypto.randomUUID();
    expect(sopVersionCompareQuerySchema.parse({ from, to })).toEqual({ from, to });
  });
});

describe("Phase 6 employee SOP library schema", () => {
  it("defaults filters and bounds the page size", () => {
    const query = employeeSopQuerySchema.parse({});
    expect(query.category).toBe("");
    expect(query.stationId).toBe("");
    expect(query.limit).toBe(20);
    expect(() => employeeSopQuerySchema.parse({ limit: 500 })).toThrow();
  });

  it("rejects an invalid category", () => {
    expect(() => employeeSopQuerySchema.parse({ category: "not-a-category" })).toThrow();
  });
});
