import { describe, expect, it } from "vitest";
import {
  AI_DRAFT_SCHEMA_VERSION,
  AiDraftSchemaValidationError,
  parseAiDraftedSop,
} from "@/server/ai/draft-schema";

const validDraft = {
  title: "Grill line: burger cook",
  description: "Cook a burger patty to order.",
  materials: [{ kind: "ingredient", name: "Burger patty", quantity: "1", unit: "each" }],
  warnings: [{ text: "The grill surface stays hot after use." }],
  steps: [
    {
      title: "Cook the patty",
      instruction: "Place the patty on the grill and cook for 4 minutes per side.",
      warning: "",
      quantity: "",
      unit: "",
      equipmentSetting: "400F",
      timerSeconds: 240,
    },
  ],
};

describe("Phase 20 AI draft schema", () => {
  it("accepts a fully valid structured draft at the current schema version", () => {
    const result = parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, validDraft);
    expect(result.title).toBe("Grill line: burger cook");
    expect(result.steps).toHaveLength(1);
  });

  it("fills in defaults for optional fields", () => {
    const result = parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, {
      title: "Minimal draft",
      steps: [{ instruction: "Do the thing." }],
    });
    expect(result.description).toBe("");
    expect(result.materials).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.steps[0]).toMatchObject({ title: "", warning: "", timerSeconds: null });
  });

  it("rejects a payload missing a required step instruction", () => {
    expect(() =>
      parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, {
        title: "Bad draft",
        steps: [{ title: "No instruction field" }],
      }),
    ).toThrow(AiDraftSchemaValidationError);
  });

  it("rejects a payload with zero steps", () => {
    expect(() =>
      parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, { title: "Empty draft", steps: [] }),
    ).toThrow(AiDraftSchemaValidationError);
  });

  it("rejects a missing title", () => {
    expect(() =>
      parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, {
        steps: [{ instruction: "Do the thing." }],
      }),
    ).toThrow(AiDraftSchemaValidationError);
  });

  it("coerces an out-of-range timer to null rather than rejecting the whole draft", () => {
    // A single hallucinated number (e.g. a nonsensical timer) shouldn't discard an otherwise
    // usable draft; only a genuinely missing/invalid structural field (like a step with no
    // instruction) fails the schema outright — see the tests above.
    const result = parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, {
      title: "Bad timer",
      steps: [{ instruction: "Do the thing.", timerSeconds: 999_999 }],
    });
    expect(result.steps[0]?.timerSeconds).toBeNull();
  });

  it("rejects an invalid material kind", () => {
    expect(() =>
      parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, {
        title: "Bad material",
        materials: [{ kind: "not-a-kind", name: "Salt", quantity: "", unit: "" }],
        steps: [{ instruction: "Do the thing." }],
      }),
    ).toThrow(AiDraftSchemaValidationError);
  });

  it("rejects an unsupported schema version", () => {
    expect(() => parseAiDraftedSop(999, validDraft)).toThrow(AiDraftSchemaValidationError);
    expect(() => parseAiDraftedSop(0, validDraft)).toThrow(AiDraftSchemaValidationError);
  });

  it("rejects a non-object payload", () => {
    expect(() => parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, "not an object")).toThrow(
      AiDraftSchemaValidationError,
    );
    expect(() => parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, null)).toThrow(
      AiDraftSchemaValidationError,
    );
  });

  it("trims and bounds string field lengths", () => {
    const result = parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, {
      title: "  Trimmed title  ",
      steps: [{ instruction: "  Trimmed instruction  " }],
    });
    expect(result.title).toBe("Trimmed title");
    expect(result.steps[0]?.instruction).toBe("Trimmed instruction");
    expect(() =>
      parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, {
        title: "x".repeat(161),
        steps: [{ instruction: "Do the thing." }],
      }),
    ).toThrow(AiDraftSchemaValidationError);
  });
});
