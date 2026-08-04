import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import { translations } from "@/server/db/schema";
import { getPublishedSopForEmployee, getSop } from "@/server/sops/service";
import type { translationTargetLocaleValues, TranslationUpsertInput } from "@/server/sops/schemas";

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
