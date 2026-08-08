import { describe, expect, it } from "vitest";
import {
  AI_TRANSLATION_DRAFT_SCHEMA_VERSION,
  AiTranslationDraftSchemaValidationError,
  parseAiTranslationDraft,
} from "@/server/ai/translation-draft-schema";

describe("Phase 20 AI translation draft schema", () => {
  it("accepts a valid translation draft at the current schema version", () => {
    const result = parseAiTranslationDraft(AI_TRANSLATION_DRAFT_SCHEMA_VERSION, {
      translatedText: "Lávese las manos.",
    });
    expect(result.translatedText).toBe("Lávese las manos.");
  });

  it("trims the translated text", () => {
    const result = parseAiTranslationDraft(AI_TRANSLATION_DRAFT_SCHEMA_VERSION, {
      translatedText: "  Lávese las manos.  ",
    });
    expect(result.translatedText).toBe("Lávese las manos.");
  });

  it("rejects an empty translated text", () => {
    expect(() =>
      parseAiTranslationDraft(AI_TRANSLATION_DRAFT_SCHEMA_VERSION, { translatedText: "" }),
    ).toThrow(AiTranslationDraftSchemaValidationError);
    expect(() =>
      parseAiTranslationDraft(AI_TRANSLATION_DRAFT_SCHEMA_VERSION, { translatedText: "   " }),
    ).toThrow(AiTranslationDraftSchemaValidationError);
  });

  it("rejects a missing translatedText field", () => {
    expect(() => parseAiTranslationDraft(AI_TRANSLATION_DRAFT_SCHEMA_VERSION, {})).toThrow(
      AiTranslationDraftSchemaValidationError,
    );
  });

  it("rejects a non-string translatedText", () => {
    expect(() =>
      parseAiTranslationDraft(AI_TRANSLATION_DRAFT_SCHEMA_VERSION, { translatedText: 42 }),
    ).toThrow(AiTranslationDraftSchemaValidationError);
  });

  it("rejects text over the schema's own bound", () => {
    expect(() =>
      parseAiTranslationDraft(AI_TRANSLATION_DRAFT_SCHEMA_VERSION, {
        translatedText: "x".repeat(4_001),
      }),
    ).toThrow(AiTranslationDraftSchemaValidationError);
  });

  it("rejects a non-object payload", () => {
    expect(() =>
      parseAiTranslationDraft(AI_TRANSLATION_DRAFT_SCHEMA_VERSION, "not an object"),
    ).toThrow(AiTranslationDraftSchemaValidationError);
    expect(() => parseAiTranslationDraft(AI_TRANSLATION_DRAFT_SCHEMA_VERSION, null)).toThrow(
      AiTranslationDraftSchemaValidationError,
    );
  });

  it("rejects an unsupported schema version", () => {
    expect(() => parseAiTranslationDraft(999, { translatedText: "Lávese las manos." })).toThrow(
      AiTranslationDraftSchemaValidationError,
    );
    expect(() => parseAiTranslationDraft(0, { translatedText: "Lávese las manos." })).toThrow(
      AiTranslationDraftSchemaValidationError,
    );
  });
});
