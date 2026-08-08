import { z } from "zod";

/**
 * Versioned Zod schema for the structured translation draft Claude produces for a single SOP
 * field/locale. Same "untrusted AI output → versioned schema → draft" shape `draft-schema.ts`
 * establishes for video-to-draft: this schema only proves the JSON is *shaped* right (a single
 * non-empty string). The field/entity-type-specific length bound (e.g. a material name topping
 * out at 160 characters, a step instruction at 4,000) is deliberately not duplicated here — the
 * caller (`generateTranslationDraft` in `src/server/sops/translations.ts`) re-validates the
 * parsed text through the exact same `translationUpsertSchema` manual entry already uses, so an
 * AI response that is well-formed JSON but too long for its specific field is rejected the same
 * way any other malformed AI output is: it never becomes a draft.
 *
 * `AI_TRANSLATION_DRAFT_SCHEMA_VERSION` travels with nothing persisted today (translation drafting
 * is synchronous, unlike the durable `ai_sop_job_outputs` rows video-to-draft writes — see the
 * Phase 20 job-runner decision in docs/implementation-plan.md), but is still versioned and checked
 * the same way so a future schema change fails closed instead of silently accepting a shape this
 * code was never written to expect.
 */
export const AI_TRANSLATION_DRAFT_SCHEMA_VERSION = 1;

const aiTranslationDraftSchemaV1 = z.object({
  translatedText: z.string().trim().min(1).max(4_000),
});

export type AiTranslationDraftV1 = z.infer<typeof aiTranslationDraftSchemaV1>;

export class AiTranslationDraftSchemaValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`AI-drafted translation output failed schema validation: ${issues.join("; ")}`);
    this.name = "AiTranslationDraftSchemaValidationError";
    this.issues = issues;
  }
}

/**
 * Validates raw AI output against the schema version it claims. An unsupported schema version is
 * rejected the same as a structurally invalid payload — both are "untrusted input that failed the
 * schema", not two different kinds of error the caller needs to distinguish.
 */
export function parseAiTranslationDraft(schemaVersion: number, raw: unknown): AiTranslationDraftV1 {
  if (schemaVersion !== AI_TRANSLATION_DRAFT_SCHEMA_VERSION) {
    throw new AiTranslationDraftSchemaValidationError([
      `unsupported schema version ${schemaVersion}`,
    ]);
  }
  const result = aiTranslationDraftSchemaV1.safeParse(raw);
  if (!result.success) {
    throw new AiTranslationDraftSchemaValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
    );
  }
  return result.data;
}
