import { z } from "zod";

/**
 * Versioned Zod schema for the structured SOP draft Claude produces from a transcript. AI output
 * is untrusted input (see docs/implementation-plan.md's "Security concerns" list): it must pass
 * this schema before it becomes an `ai_sop_job_outputs` row, and it is only ever offered to a
 * manager as something to apply onto an editable SOP draft — never written directly onto a
 * published `sop_versions` row, and applying it never publishes anything.
 *
 * `AI_DRAFT_SCHEMA_VERSION` is recorded on every `ai_sop_job_outputs` row so a later phase can
 * change this shape (add a field, tighten a bound) without breaking the ability to read an older
 * output — the same "schema version travels with the record" precedent
 * `training_configs`/`sop_versions` already establish for immutable published content. Field
 * shapes deliberately mirror `sopCreateSchema`/`sopStepCreateSchema` in
 * `src/server/sops/schemas.ts` (materials/warnings/steps) so a valid AI draft maps onto the exact
 * same manual-editing fields a manager already knows.
 */
export const AI_DRAFT_SCHEMA_VERSION = 1;

const aiDraftMaterialSchemaV1 = z.object({
  kind: z.enum(["material", "ingredient"]),
  name: z.string().trim().min(1).max(160),
  quantity: z.string().trim().max(40).default(""),
  unit: z.string().trim().max(40).default(""),
});

const aiDraftWarningSchemaV1 = z.object({
  text: z.string().trim().min(1).max(500),
});

const aiDraftStepSchemaV1 = z.object({
  title: z.string().trim().max(160).default(""),
  instruction: z.string().trim().min(1).max(4_000),
  warning: z.string().trim().max(500).default(""),
  quantity: z.string().trim().max(40).default(""),
  unit: z.string().trim().max(40).default(""),
  equipmentSetting: z.string().trim().max(160).default(""),
  timerSeconds: z
    .union([z.null(), z.number().int().min(1).max(7_200)])
    .default(null)
    .catch(null),
});

export const aiDraftedSopSchemaV1 = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4_000).default(""),
  materials: z.array(aiDraftMaterialSchemaV1).max(60).default([]),
  warnings: z.array(aiDraftWarningSchemaV1).max(30).default([]),
  steps: z.array(aiDraftStepSchemaV1).min(1).max(100),
});

export type AiDraftedSopV1 = z.infer<typeof aiDraftedSopSchemaV1>;

export class AiDraftSchemaValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`AI-drafted SOP output failed schema validation: ${issues.join("; ")}`);
    this.name = "AiDraftSchemaValidationError";
    this.issues = issues;
  }
}

/**
 * Validates raw AI output against the schema version it claims. An unsupported (too new or too
 * old, from a future or historical build of this job runner) `schemaVersion` is rejected the same
 * as a structurally invalid payload — both are "untrusted input that failed the schema", not two
 * different kinds of error the caller needs to distinguish.
 */
export function parseAiDraftedSop(schemaVersion: number, raw: unknown): AiDraftedSopV1 {
  if (schemaVersion !== AI_DRAFT_SCHEMA_VERSION) {
    throw new AiDraftSchemaValidationError([`unsupported schema version ${schemaVersion}`]);
  }
  const result = aiDraftedSopSchemaV1.safeParse(raw);
  if (!result.success) {
    throw new AiDraftSchemaValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
    );
  }
  return result.data;
}
