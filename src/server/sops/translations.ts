import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { toAppError, AppError } from "@/lib/errors";
import { AiProviderError, claudeTranslationDraftingProvider } from "@/server/ai/providers";
import {
  AI_TRANSLATION_DRAFT_SCHEMA_VERSION,
  AiTranslationDraftSchemaValidationError,
  parseAiTranslationDraft,
} from "@/server/ai/translation-draft-schema";
import type { TranslationDraftingProvider } from "@/server/ai/types";
import { writeAuditEvent } from "@/server/audit";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import { translations } from "@/server/db/schema";
import { writeDomainEvent } from "@/server/events";
import { dispatchNotificationsForDomainEvent } from "@/server/notifications/service";
import { getPublishedSopForEmployee, getSop } from "@/server/sops/service";
import {
  translationUpsertSchema,
  type translationTargetLocaleValues,
  type TranslationDraftGenerateInput,
  type TranslationUpsertInput,
} from "@/server/sops/schemas";

type TranslationEntityType = "sop_version" | "sop_material" | "sop_warning" | "sop_step";
type TranslationFieldName = "title" | "description" | "name" | "text" | "instruction" | "warning";
type TranslationTargetLocale = (typeof translationTargetLocaleValues)[number];

/** English is the only supported source locale for manually authored SOP content. */
const SOURCE_LOCALE = "en" as const;

/** Every row this application writes uses "es" as its target locale; this only narrows the type. */
function asTargetLocale(locale: "en" | "es"): TranslationTargetLocale {
  if (locale !== "es") {
    throw new AppError("INTERNAL_ERROR", "Unsupported translation target locale.");
  }
  return locale;
}

export interface TranslationMatrixRow {
  translationId: string | null;
  entityType: TranslationEntityType;
  entityId: string;
  field: TranslationFieldName;
  contextLabel: string;
  sourceText: string;
  translatedText: string;
  /** "untranslated" has no stored row at all; it is never persisted as a status value. */
  status: "untranslated" | "pending_review" | "approved";
  /** The source text changed since this translation was entered or approved; it needs review. */
  stale: boolean;
  approvedAt: string | null;
  /** Who last wrote the stored `translatedText`; null when there is no stored row yet. Purely
   * informational for the UI (e.g. an "AI drafted" badge) — approval always requires the same
   * explicit manager action regardless of provider. */
  provider: "manual" | "ai" | null;
}

function hashSourceText(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

interface SourceField {
  entityType: TranslationEntityType;
  entityId: string;
  field: TranslationFieldName;
  contextLabel: string;
  sourceText: string;
}

type SopDetail = Awaited<ReturnType<typeof getSop>>;

/**
 * Every translatable field of a published SOP version, in a stable order. Quantities, units,
 * equipment settings, and timers are deliberately excluded: they are protected measurements
 * that must never be altered by translation, in any locale.
 */
function listSourceFields(sop: SopDetail): SourceField[] {
  const fields: SourceField[] = [
    {
      entityType: "sop_version",
      entityId: sop.version.id,
      field: "title",
      contextLabel: "Title",
      sourceText: sop.version.title,
    },
    {
      entityType: "sop_version",
      entityId: sop.version.id,
      field: "description",
      contextLabel: "Description",
      sourceText: sop.version.description,
    },
    ...sop.materials.map((material) => ({
      entityType: "sop_material" as const,
      entityId: material.id,
      field: "name" as const,
      contextLabel: `Material: ${material.name}`,
      sourceText: material.name,
    })),
    ...sop.warnings.map((warning, index) => ({
      entityType: "sop_warning" as const,
      entityId: warning.id,
      field: "text" as const,
      contextLabel: `Warning ${index + 1}`,
      sourceText: warning.text,
    })),
    ...sop.steps.flatMap((step) => [
      {
        entityType: "sop_step" as const,
        entityId: step.id,
        field: "title" as const,
        contextLabel: `Step ${step.displayOrder} title`,
        sourceText: step.title ?? "",
      },
      {
        entityType: "sop_step" as const,
        entityId: step.id,
        field: "instruction" as const,
        contextLabel: `Step ${step.displayOrder} instructions`,
        sourceText: step.instruction,
      },
      {
        entityType: "sop_step" as const,
        entityId: step.id,
        field: "warning" as const,
        contextLabel: `Step ${step.displayOrder} warning`,
        sourceText: step.warning ?? "",
      },
    ]),
  ];
  return fields.filter((entry) => entry.sourceText.trim().length > 0);
}

function findSourceField(sop: SopDetail, entityType: string, entityId: string, field: string) {
  const match = listSourceFields(sop).find(
    (entry) =>
      entry.entityType === entityType && entry.entityId === entityId && entry.field === field,
  );
  if (!match) {
    throw new AppError("NOT_FOUND", "That field is not part of the current published version.");
  }
  return match;
}

async function requirePublishedSop(
  actor: ManagerSessionContext,
  sopId: string,
): Promise<SopDetail> {
  const sop = await getSop(actor, sopId);
  if (sop.status !== "published") {
    throw new AppError(
      "CONFLICT",
      "Publish this SOP before adding translations. Translations always apply to the current published version.",
    );
  }
  return sop;
}

async function buildMatrix(
  organizationId: string,
  sop: SopDetail,
  targetLocale: TranslationTargetLocale,
): Promise<TranslationMatrixRow[]> {
  const sourceFields = listSourceFields(sop);
  const entityIds = [...new Set(sourceFields.map((entry) => entry.entityId))];
  const existing =
    entityIds.length > 0
      ? await getDb()
          .select()
          .from(translations)
          .where(
            and(
              eq(translations.organizationId, organizationId),
              eq(translations.targetLocale, targetLocale),
              inArray(translations.entityId, entityIds),
            ),
          )
      : [];
  const byKey = new Map(existing.map((row) => [`${row.entityId}:${row.field}`, row]));

  return sourceFields.map((source) => {
    const row = byKey.get(`${source.entityId}:${source.field}`);
    const stale = row ? row.sourceTextHash !== hashSourceText(source.sourceText) : false;
    return {
      translationId: row?.id ?? null,
      entityType: source.entityType,
      entityId: source.entityId,
      field: source.field,
      contextLabel: source.contextLabel,
      sourceText: source.sourceText,
      translatedText: row?.translatedText ?? "",
      status: row ? row.status : "untranslated",
      stale,
      approvedAt: row?.approvedAt?.toISOString() ?? null,
      provider: row?.provider ?? null,
    };
  });
}

export async function getTranslationMatrix(
  actor: ManagerSessionContext,
  sopId: string,
  targetLocale: TranslationTargetLocale,
): Promise<{
  sopId: string;
  versionNumber: number;
  targetLocale: TranslationTargetLocale;
  rows: TranslationMatrixRow[];
}> {
  const sop = await requirePublishedSop(actor, sopId);
  const rows = await buildMatrix(actor.organizationId, sop, targetLocale);
  return { sopId, versionNumber: sop.version.versionNumber, targetLocale, rows };
}

export async function upsertTranslation(
  actor: ManagerSessionContext,
  sopId: string,
  input: TranslationUpsertInput,
  requestId?: string,
): Promise<{
  sopId: string;
  versionNumber: number;
  targetLocale: TranslationTargetLocale;
  rows: TranslationMatrixRow[];
}> {
  const sop = await requirePublishedSop(actor, sopId);
  const source = findSourceField(sop, input.entityType, input.entityId, input.field);
  const sourceTextHash = hashSourceText(source.sourceText);

  await getDb()
    .insert(translations)
    .values({
      id: randomUUID(),
      organizationId: actor.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      field: input.field,
      sourceLocale: SOURCE_LOCALE,
      targetLocale: input.targetLocale,
      sourceTextHash,
      translatedText: input.translatedText,
      status: "pending_review",
      provider: "manual",
    })
    .onConflictDoUpdate({
      target: [translations.entityId, translations.field, translations.targetLocale],
      set: {
        translatedText: input.translatedText,
        sourceTextHash,
        status: "pending_review",
        // A manual save always reclaims the row as manually authored, even if the previous text
        // came from an AI draft — the manager just reviewed and rewrote it themselves.
        provider: "manual",
        reviewerManagerUserId: null,
        approvedAt: null,
        updatedAt: new Date(),
      },
    });

  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: sop.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "translation.updated",
    targetType: "sop",
    targetId: sopId,
    metadata: {
      entityType: input.entityType,
      field: input.field,
      targetLocale: input.targetLocale,
    },
    requestId,
  });

  const rows = await buildMatrix(actor.organizationId, sop, input.targetLocale);
  return {
    sopId,
    versionNumber: sop.version.versionNumber,
    targetLocale: input.targetLocale,
    rows,
  };
}

export interface TranslationDraftDeps {
  drafting: TranslationDraftingProvider;
}

/** Production wiring: the real, paid Anthropic provider. Never imported by a test — tests always
 * pass an explicit `deps` built from `@/server/ai/fakes` instead, the same convention
 * `productionAiJobRunnerDeps` in `ai-sop-job-runner.ts` establishes for video-to-draft. */
export const productionTranslationDraftDeps: TranslationDraftDeps = {
  drafting: claudeTranslationDraftingProvider,
};

/** Canned, non-secret messages for AI translation drafting failures — mirrors
 * `SAFE_ERROR_MESSAGES` in `ai-sop-job-runner.ts`; never surface a caught exception's own message
 * to the client, since it could echo back a URL, header, or environment fragment. Unlike the job
 * runner, this path is synchronous and request-scoped (see the Phase 20 job-runner decision in
 * docs/implementation-plan.md), so the failure is returned directly rather than recorded on a
 * durable row. */
function translationDraftError(error: unknown): AppError {
  if (error instanceof AiTranslationDraftSchemaValidationError) {
    return new AppError(
      "SERVICE_UNAVAILABLE",
      "The AI translation service returned an unusable response. Try again, or enter the translation manually.",
    );
  }
  if (error instanceof AiProviderError) {
    const message =
      error.code === "provider_not_configured"
        ? "AI-assisted translation is not configured."
        : "The AI translation service could not be reached. Try again, or enter the translation manually.";
    return new AppError("SERVICE_UNAVAILABLE", message);
  }
  return toAppError(error);
}

/**
 * A manager's explicit "draft this with AI" action for one field/locale. Reuses the exact same
 * untrusted-AI-output → versioned-schema → draft pipeline `ai-sop-job-runner.ts` established in
 * Part 1 of this phase, but as one bounded synchronous call rather than a durable cron-advanced
 * job — translating a single already-short field/step is not a multi-minute operation the way
 * video transcription is, so there is no job row, lease, or retry state to manage here.
 *
 * The generated text lands in exactly the same `translations` row shape, at the same
 * `pending_review` status, that manual entry (`upsertTranslation`) produces — a manager must still
 * explicitly call `approveTranslation` before it is ever shown to an employee. Never generates
 * (let alone overwrites) a draft for a field/locale whose current translation is already
 * `approved`: that check happens twice — once up front against the read we already did, and once
 * more, atomically, in the write itself via `setWhere` — so a second request racing a concurrent
 * approval can never clobber it.
 */
export async function generateTranslationDraft(
  actor: ManagerSessionContext,
  sopId: string,
  input: TranslationDraftGenerateInput,
  deps: TranslationDraftDeps,
  requestId?: string,
): Promise<{
  sopId: string;
  versionNumber: number;
  targetLocale: TranslationTargetLocale;
  rows: TranslationMatrixRow[];
}> {
  const sop = await requirePublishedSop(actor, sopId);
  const source = findSourceField(sop, input.entityType, input.entityId, input.field);
  const sourceTextHash = hashSourceText(source.sourceText);

  const [existing] = await getDb()
    .select({ status: translations.status })
    .from(translations)
    .where(
      and(
        eq(translations.organizationId, actor.organizationId),
        eq(translations.entityId, input.entityId),
        eq(translations.field, input.field),
        eq(translations.targetLocale, input.targetLocale),
      ),
    )
    .limit(1);
  if (existing?.status === "approved") {
    throw new AppError(
      "CONFLICT",
      "This translation is already approved. AI drafting never overwrites an approved translation — edit it manually if you want to change it.",
    );
  }

  let raw: unknown;
  try {
    const result = await deps.drafting.draftTranslation({
      sourceText: source.sourceText,
      targetLocale: input.targetLocale,
      contextLabel: source.contextLabel,
    });
    raw = result.raw;
  } catch (error) {
    throw translationDraftError(error);
  }

  const parsed = (() => {
    try {
      return parseAiTranslationDraft(AI_TRANSLATION_DRAFT_SCHEMA_VERSION, raw);
    } catch (error) {
      throw translationDraftError(error);
    }
  })();

  // Re-run the parsed text through the exact per-field/entity-type bound `translationUpsertSchema`
  // uses for manual entry, so a technically well-formed but over-length AI response (e.g. a
  // material name Claude drafted at 300 characters) is rejected the same as any other malformed
  // AI output — it never becomes a draft.
  const bounded = translationUpsertSchema.safeParse({
    entityType: input.entityType,
    entityId: input.entityId,
    field: input.field,
    targetLocale: input.targetLocale,
    translatedText: parsed.translatedText,
  });
  if (!bounded.success) {
    throw translationDraftError(
      new AiTranslationDraftSchemaValidationError(
        bounded.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
      ),
    );
  }
  const translatedText = bounded.data.translatedText;

  await getDb()
    .insert(translations)
    .values({
      id: randomUUID(),
      organizationId: actor.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      field: input.field,
      sourceLocale: SOURCE_LOCALE,
      targetLocale: input.targetLocale,
      sourceTextHash,
      translatedText,
      status: "pending_review",
      provider: "ai",
    })
    .onConflictDoUpdate({
      target: [translations.entityId, translations.field, translations.targetLocale],
      set: {
        translatedText,
        sourceTextHash,
        status: "pending_review",
        provider: "ai",
        reviewerManagerUserId: null,
        approvedAt: null,
        updatedAt: new Date(),
      },
      // Belt-and-suspenders against the race the up-front check above cannot fully close: if
      // another request approved this exact row between our read and this write, the conflicting
      // update is simply skipped rather than clobbering the now-approved translation.
      setWhere: ne(translations.status, "approved"),
    });

  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: sop.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "translation.ai_drafted",
    targetType: "sop",
    targetId: sopId,
    metadata: {
      entityType: input.entityType,
      field: input.field,
      targetLocale: input.targetLocale,
    },
    requestId,
  });

  const rows = await buildMatrix(actor.organizationId, sop, input.targetLocale);
  return {
    sopId,
    versionNumber: sop.version.versionNumber,
    targetLocale: input.targetLocale,
    rows,
  };
}

export async function approveTranslation(
  actor: ManagerSessionContext,
  sopId: string,
  translationId: string,
  requestId?: string,
): Promise<{
  sopId: string;
  versionNumber: number;
  targetLocale: TranslationTargetLocale;
  rows: TranslationMatrixRow[];
}> {
  const sop = await requirePublishedSop(actor, sopId);
  const [row] = await getDb()
    .select()
    .from(translations)
    .where(
      and(
        eq(translations.id, translationId),
        eq(translations.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Translation not found.");
  const source = findSourceField(sop, row.entityType, row.entityId, row.field);
  if (!row.translatedText.trim()) {
    throw new AppError("BAD_REQUEST", "Enter a translation before approving it.");
  }
  if (row.sourceTextHash !== hashSourceText(source.sourceText)) {
    throw new AppError(
      "CONFLICT",
      "The source text changed since this translation was entered. Save it again before approving.",
    );
  }

  await getDb()
    .update(translations)
    .set({
      status: "approved",
      reviewerManagerUserId: actor.managerUserId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(translations.id, translationId));

  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: sop.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "translation.approved",
    targetType: "sop",
    targetId: sopId,
    metadata: { entityType: row.entityType, field: row.field, targetLocale: row.targetLocale },
    requestId,
  });
  const translationApprovedEvent = await writeDomainEvent({
    organizationId: actor.organizationId,
    locationId: sop.locationId,
    type: "translation.approved",
    subjectType: "sop",
    subjectId: sopId,
    payload: { entityType: row.entityType, field: row.field, targetLocale: row.targetLocale },
  });
  await dispatchNotificationsForDomainEvent(translationApprovedEvent);

  const targetLocale = asTargetLocale(row.targetLocale);
  const rows = await buildMatrix(actor.organizationId, sop, targetLocale);
  return { sopId, versionNumber: sop.version.versionNumber, targetLocale, rows };
}

export interface LocalizedText {
  text: string;
  translated: boolean;
}

function localize(
  byKey: Map<string, string>,
  entityId: string,
  field: TranslationFieldName,
  original: string,
): LocalizedText {
  const translated = byKey.get(`${entityId}:${field}`);
  return translated !== undefined
    ? { text: translated, translated: true }
    : { text: original, translated: false };
}

/**
 * The employee-facing SOP reader, localized to the requested locale. Only approved translations
 * are ever shown; anything untranslated (or an English request) falls back to the original text.
 * Quantities, units, equipment settings, and timers are never translated. Switching locale is
 * purely a display choice — it never touches training progress, session state, or evidence.
 */
export async function getLocalizedSopForEmployee(
  session: EmployeeSessionContext,
  sopId: string,
  locale: "en" | "es",
) {
  const sop = await getPublishedSopForEmployee(session, sopId);
  const entityIds = [
    sop.version.id,
    ...sop.materials.map((material) => material.id),
    ...sop.warnings.map((warning) => warning.id),
    ...sop.steps.map((step) => step.id),
  ];
  const byKey = new Map<string, string>();
  if (locale !== "en" && entityIds.length > 0) {
    const rows = await getDb()
      .select({
        entityId: translations.entityId,
        field: translations.field,
        translatedText: translations.translatedText,
      })
      .from(translations)
      .where(
        and(
          eq(translations.organizationId, session.organizationId),
          eq(translations.targetLocale, locale),
          eq(translations.status, "approved"),
          inArray(translations.entityId, entityIds),
        ),
      );
    for (const row of rows) byKey.set(`${row.entityId}:${row.field}`, row.translatedText);
  }

  return {
    ...sop,
    locale,
    version: {
      ...sop.version,
      title: localize(byKey, sop.version.id, "title", sop.version.title),
      description: localize(byKey, sop.version.id, "description", sop.version.description),
    },
    materials: sop.materials.map((material) => ({
      ...material,
      name: localize(byKey, material.id, "name", material.name),
    })),
    warnings: sop.warnings.map((warning) => ({
      ...warning,
      text: localize(byKey, warning.id, "text", warning.text),
    })),
    steps: sop.steps.map((step) => ({
      ...step,
      title: step.title ? localize(byKey, step.id, "title", step.title) : null,
      instruction: localize(byKey, step.id, "instruction", step.instruction),
      warning: step.warning ? localize(byKey, step.id, "warning", step.warning) : null,
    })),
  };
}
