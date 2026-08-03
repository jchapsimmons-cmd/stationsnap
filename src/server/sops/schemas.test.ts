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
  stepTrainingRequirementsSchema,
  trainingConfigUpdateSchema,
  trainingQuestionCreateSchema,
  trainingQuestionReorderSchema,
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

describe("Phase 7 training config schema", () => {
  const baseConfig = { expectedRevision: 1 };

  it("defaults to a disabled, learn-mode configuration", () => {
    const parsed = trainingConfigUpdateSchema.parse(baseConfig);
    expect(parsed.requirementState).toBe("disabled");
    expect(parsed.defaultMode).toBe("learn");
    expect(parsed.passingScorePercent).toBe(80);
    expect(parsed.maxAttempts).toBe(3);
    expect(parsed.qualificationValidityDays).toBeNull();
    expect(parsed.retrainingGraceDays).toBeNull();
  });

  it("bounds the passing score and maximum attempts", () => {
    expect(() =>
      trainingConfigUpdateSchema.parse({ ...baseConfig, passingScorePercent: -1 }),
    ).toThrow();
    expect(() =>
      trainingConfigUpdateSchema.parse({ ...baseConfig, passingScorePercent: 101 }),
    ).toThrow();
    expect(() => trainingConfigUpdateSchema.parse({ ...baseConfig, maxAttempts: 0 })).toThrow();
    expect(() => trainingConfigUpdateSchema.parse({ ...baseConfig, maxAttempts: 21 })).toThrow();
  });

  it("bounds qualification validity and retraining grace when set", () => {
    expect(() =>
      trainingConfigUpdateSchema.parse({
        ...baseConfig,
        requirementState: "required",
        qualificationValidityDays: 0,
      }),
    ).toThrow();
    expect(() =>
      trainingConfigUpdateSchema.parse({
        ...baseConfig,
        requirementState: "required",
        retrainingGraceDays: -1,
      }),
    ).toThrow();
    const parsed = trainingConfigUpdateSchema.parse({
      ...baseConfig,
      requirementState: "required",
      qualificationValidityDays: 365,
      retrainingGraceDays: 14,
    });
    expect(parsed.qualificationValidityDays).toBe(365);
    expect(parsed.retrainingGraceDays).toBe(14);
  });

  it("rejects qualification or retraining values when training is disabled", () => {
    expect(() =>
      trainingConfigUpdateSchema.parse({
        ...baseConfig,
        requirementState: "disabled",
        qualificationValidityDays: 30,
      }),
    ).toThrow();
    expect(() =>
      trainingConfigUpdateSchema.parse({
        ...baseConfig,
        requirementState: "disabled",
        retrainingGraceDays: 7,
      }),
    ).toThrow();
  });

  it("requires an expectedRevision", () => {
    expect(() => trainingConfigUpdateSchema.parse({})).toThrow();
  });
});

describe("Phase 7 step training requirements schema", () => {
  const base = { expectedRevision: 1 };

  it("defaults every requirement to false", () => {
    const parsed = stepTrainingRequirementsSchema.parse(base);
    expect(parsed.requireFullVideo).toBe(false);
    expect(parsed.requireApproval).toBe(false);
  });

  it("rejects approval without any submitted requirement", () => {
    expect(() =>
      stepTrainingRequirementsSchema.parse({ ...base, requireApproval: true }),
    ).toThrow();
  });

  it("accepts approval paired with a submitted requirement", () => {
    const parsed = stepTrainingRequirementsSchema.parse({
      ...base,
      requireApproval: true,
      requirePhoto: true,
    });
    expect(parsed.requireApproval).toBe(true);
    expect(parsed.requirePhoto).toBe(true);
  });
});

describe("Phase 7 training question schema", () => {
  function trueFalseQuestion(overrides: Record<string, unknown> = {}) {
    return {
      stepId: "",
      type: "true_false",
      text: "Must the grill be preheated first?",
      placement: "final",
      choices: [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ],
      expectedRevision: 1,
      ...overrides,
    };
  }

  it("accepts a minimal final true/false question", () => {
    const parsed = trainingQuestionCreateSchema.parse(trueFalseQuestion());
    expect(parsed.stepId).toBeNull();
    expect(parsed.placement).toBe("final");
    expect(parsed.explanationPolicy).toBe("on_incorrect");
    expect(parsed.points).toBe(1);
  });

  it("rejects a blank question text", () => {
    expect(() => trainingQuestionCreateSchema.parse(trueFalseQuestion({ text: "  " }))).toThrow();
  });

  it("bounds points", () => {
    expect(() => trainingQuestionCreateSchema.parse(trueFalseQuestion({ points: 0 }))).toThrow();
    expect(() => trainingQuestionCreateSchema.parse(trueFalseQuestion({ points: 101 }))).toThrow();
  });

  it("requires final placement when no step is attached", () => {
    expect(() =>
      trainingQuestionCreateSchema.parse(trueFalseQuestion({ placement: "after_step" })),
    ).toThrow();
  });

  it("requires a non-final placement when a step is attached", () => {
    const stepId = crypto.randomUUID();
    expect(() =>
      trainingQuestionCreateSchema.parse(trueFalseQuestion({ stepId, placement: "final" })),
    ).toThrow();
    const parsed = trainingQuestionCreateSchema.parse(
      trueFalseQuestion({ stepId, placement: "after_step" }),
    );
    expect(parsed.stepId).toBe(stepId);
  });

  it("requires exactly two choices with one correct for true/false questions", () => {
    expect(() =>
      trainingQuestionCreateSchema.parse(
        trueFalseQuestion({
          choices: [
            { text: "True", isCorrect: true },
            { text: "False", isCorrect: true },
          ],
        }),
      ),
    ).toThrow();
    expect(() =>
      trainingQuestionCreateSchema.parse(
        trueFalseQuestion({
          choices: [
            { text: "True", isCorrect: true },
            { text: "False", isCorrect: false },
            { text: "Maybe", isCorrect: false },
          ],
        }),
      ),
    ).toThrow();
  });

  it("requires exactly one correct choice for single-choice questions", () => {
    const base = trueFalseQuestion({
      type: "single_choice",
      choices: [
        { text: "Grill", isCorrect: false },
        { text: "Fryer", isCorrect: false },
        { text: "Prep", isCorrect: false },
      ],
    });
    expect(() => trainingQuestionCreateSchema.parse(base)).toThrow();
    const parsed = trainingQuestionCreateSchema.parse({
      ...base,
      choices: [
        { text: "Grill", isCorrect: true },
        { text: "Fryer", isCorrect: false },
        { text: "Prep", isCorrect: false },
      ],
    });
    expect(parsed.choices.filter((choice) => choice.isCorrect)).toHaveLength(1);
  });

  it("requires at least one correct choice for multiple-choice questions", () => {
    const base = trueFalseQuestion({
      type: "multiple_choice",
      choices: [
        { text: "Grill", isCorrect: false },
        { text: "Fryer", isCorrect: false },
      ],
    });
    expect(() => trainingQuestionCreateSchema.parse(base)).toThrow();
    const parsed = trainingQuestionCreateSchema.parse({
      ...base,
      choices: [
        { text: "Grill", isCorrect: true },
        { text: "Fryer", isCorrect: true },
      ],
    });
    expect(parsed.choices.filter((choice) => choice.isCorrect)).toHaveLength(2);
  });

  it("bounds the number of choices", () => {
    expect(() =>
      trainingQuestionCreateSchema.parse(
        trueFalseQuestion({
          type: "multiple_choice",
          choices: [{ text: "Only one", isCorrect: true }],
        }),
      ),
    ).toThrow();
  });
});

describe("Phase 7 training question reorder schema", () => {
  it("requires at least one question id", () => {
    expect(() =>
      trainingQuestionReorderSchema.parse({ orderedQuestionIds: [], expectedRevision: 1 }),
    ).toThrow();
  });

  it("accepts an optional stepId scope", () => {
    const parsed = trainingQuestionReorderSchema.parse({
      orderedQuestionIds: [crypto.randomUUID()],
      expectedRevision: 1,
    });
    expect(parsed.stepId).toBeNull();
  });
});
