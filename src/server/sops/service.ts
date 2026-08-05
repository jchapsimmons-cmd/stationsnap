import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import { requireManagerManagedLocation } from "@/server/auth/authorization";
import { writeDomainEvent } from "@/server/events";
import { dispatchNotificationsForDomainEvent } from "@/server/notifications/service";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import {
  files,
  locations,
  sopMaterials,
  sopRecentViews,
  sopRetrainingRuleLocations,
  sopRetrainingRuleRoles,
  sopRetrainingRules,
  sops,
  sopSteps,
  sopVersions,
  sopWarnings,
  stations,
  stepTrainingRequirements,
  trainingConfigs,
  trainingQuestionChoices,
  trainingQuestions,
} from "@/server/db/schema";
import { getManagedLocationIds, requireActiveManagedLocation } from "@/server/management/service";
import type {
  EmployeeSopQuery,
  RetrainingRuleInput,
  SopCreateInput,
  SopDraftUpdateInput,
  SopPublishInput,
  SopQuery,
  SopStepCreateInput,
  SopStepUpdateInput,
  SopVersionHistoryReportQuery,
  StepTrainingRequirementsInput,
  TrainingConfigUpdateInput,
  TrainingQuestionCreateInput,
  TrainingQuestionUpdateInput,
} from "@/server/sops/schemas";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export function defaultTrainingConfigValues() {
  return {
    requirementState: "disabled" as const,
    defaultMode: "learn" as const,
    allowBacktracking: true,
    requireSequentialProgress: true,
    requireFullVideoWatch: false,
    requireEvidenceApproval: true,
    passingScorePercent: 80,
    maxAttempts: 3,
    qualificationValidityDays: null as number | null,
    retrainingGraceDays: null as number | null,
  };
}

export function defaultStepRequirementValues() {
  return {
    requireFullVideo: false,
    requireConfirmation: false,
    requireTimer: false,
    requireQuestion: false,
    requirePhoto: false,
    requireVideo: false,
    requireApproval: false,
  };
}

async function auditSop(
  actor: ManagerSessionContext,
  action:
    | "sop.created"
    | "sop.updated"
    | "sop.step_deleted"
    | "sop.archived"
    | "sop.previewed"
    | "sop.published"
    | "sop.draft_created"
    | "sop.version_restored",
  sopId: string,
  locationId?: string,
  requestId?: string,
): Promise<void> {
  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action,
    targetType: "sop",
    targetId: sopId,
    requestId,
  });
}

async function assertStationInLocation(
  organizationId: string,
  stationId: string,
  locationId: string,
): Promise<void> {
  const [row] = await getDb()
    .select({ id: stations.id })
    .from(stations)
    .where(
      and(
        eq(stations.id, stationId),
        eq(stations.organizationId, organizationId),
        eq(stations.locationId, locationId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new AppError("BAD_REQUEST", "That station is not part of the selected location.");
  }
}

async function assertFileReady(organizationId: string, fileId: string): Promise<void> {
  const [row] = await getDb()
    .select({ status: files.status })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.organizationId, organizationId)))
    .limit(1);
  if (!row || row.status !== "ready") {
    throw new AppError("BAD_REQUEST", "Finish uploading the media before saving.");
  }
}

async function loadSopDetail(organizationId: string, sopId: string) {
  const [row] = await getDb()
    .select({
      sop: sops,
      version: sopVersions,
      locationName: locations.name,
      stationName: stations.name,
    })
    .from(sops)
    .innerJoin(
      sopVersions,
      and(
        eq(sopVersions.id, sops.currentVersionId),
        eq(sopVersions.organizationId, sops.organizationId),
      ),
    )
    .innerJoin(
      locations,
      and(eq(locations.id, sops.locationId), eq(locations.organizationId, sops.organizationId)),
    )
    .leftJoin(
      stations,
      and(eq(stations.id, sops.stationId), eq(stations.organizationId, sops.organizationId)),
    )
    .where(and(eq(sops.id, sopId), eq(sops.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function requireManageableSop(actor: ManagerSessionContext, sopId: string) {
  const detail = await loadSopDetail(actor.organizationId, sopId);
  if (!detail) throw new AppError("NOT_FOUND", "SOP not found.");
  await requireManagerManagedLocation(actor, detail.sop.locationId);
  return detail;
}

async function findDraftVersion(organizationId: string, sopId: string) {
  const [row] = await getDb()
    .select()
    .from(sopVersions)
    .where(
      and(
        eq(sopVersions.sopId, sopId),
        eq(sopVersions.organizationId, organizationId),
        eq(sopVersions.status, "draft"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findVersionById(organizationId: string, sopId: string, versionId: string) {
  const [row] = await getDb()
    .select()
    .from(sopVersions)
    .where(
      and(
        eq(sopVersions.id, versionId),
        eq(sopVersions.sopId, sopId),
        eq(sopVersions.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function requireDraftForEdit(actor: ManagerSessionContext, sopId: string) {
  const base = await requireManageableSop(actor, sopId);
  const draftVersion = await findDraftVersion(actor.organizationId, sopId);
  if (!draftVersion) {
    throw new AppError(
      "CONFLICT",
      "This SOP does not have a draft in progress. Start a new draft to make changes.",
    );
  }
  return {
    sop: base.sop,
    version: draftVersion,
    locationName: base.locationName,
    stationName: base.stationName,
  };
}

async function bumpRevision(
  tx: Tx,
  organizationId: string,
  sopVersionId: string,
  expectedRevision: number,
  extraSet: Record<string, unknown> = {},
): Promise<number> {
  const [row] = await tx
    .update(sopVersions)
    .set({ ...extraSet, revision: expectedRevision + 1, updatedAt: new Date() })
    .where(
      and(
        eq(sopVersions.id, sopVersionId),
        eq(sopVersions.organizationId, organizationId),
        eq(sopVersions.revision, expectedRevision),
      ),
    )
    .returning({ revision: sopVersions.revision });
  if (!row) {
    const [current] = await tx
      .select({ revision: sopVersions.revision })
      .from(sopVersions)
      .where(eq(sopVersions.id, sopVersionId))
      .limit(1);
    throw new AppError(
      "CONFLICT",
      "This SOP draft changed elsewhere. Reload to continue editing.",
      { details: { currentRevision: current?.revision ?? null } },
    );
  }
  return row.revision;
}

async function replaceMaterials(
  tx: Tx,
  organizationId: string,
  sopVersionId: string,
  materials: SopCreateInput["materials"],
): Promise<void> {
  await tx.delete(sopMaterials).where(eq(sopMaterials.sopVersionId, sopVersionId));
  if (materials.length === 0) return;
  await tx.insert(sopMaterials).values(
    materials.map((material, index) => ({
      id: randomUUID(),
      sopVersionId,
      organizationId,
      kind: material.kind,
      name: material.name,
      quantity: material.quantity,
      unit: material.unit,
      displayOrder: index + 1,
    })),
  );
}

async function replaceWarnings(
  tx: Tx,
  organizationId: string,
  sopVersionId: string,
  warnings: SopCreateInput["warnings"],
): Promise<void> {
  await tx.delete(sopWarnings).where(eq(sopWarnings.sopVersionId, sopVersionId));
  if (warnings.length === 0) return;
  await tx.insert(sopWarnings).values(
    warnings.map((warning, index) => ({
      id: randomUUID(),
      sopVersionId,
      organizationId,
      text: warning.text,
      displayOrder: index + 1,
    })),
  );
}

function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ u: updatedAt.toISOString(), i: id }), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): { updatedAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      u: string;
      i: string;
    };
    const updatedAt = new Date(parsed.u);
    if (Number.isNaN(updatedAt.getTime()) || typeof parsed.i !== "string") return null;
    return { updatedAt, id: parsed.i };
  } catch {
    return null;
  }
}

export async function listSops(actor: ManagerSessionContext, query: SopQuery) {
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return { items: [], nextCursor: null };
  if (query.locationId && !managedIds.includes(query.locationId)) {
    return { items: [], nextCursor: null };
  }

  const conditions: SQL[] = [
    eq(sops.organizationId, actor.organizationId),
    inArray(sops.locationId, query.locationId ? [query.locationId] : managedIds),
  ];
  if (query.category) conditions.push(eq(sops.category, query.category));
  if (query.stationId) conditions.push(eq(sops.stationId, query.stationId));
  if (query.status) conditions.push(eq(sops.status, query.status));
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(
      or(ilike(sopVersions.title, pattern), ilike(sopVersions.description, pattern))!,
    );
  }
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor) {
    conditions.push(
      or(
        lt(sops.updatedAt, cursor.updatedAt),
        and(eq(sops.updatedAt, cursor.updatedAt), lt(sops.id, cursor.id)),
      )!,
    );
  }

  const rows = await getDb()
    .select({
      id: sops.id,
      title: sopVersions.title,
      category: sops.category,
      status: sops.status,
      difficulty: sopVersions.difficulty,
      estimatedMinutes: sopVersions.estimatedMinutes,
      locationId: sops.locationId,
      locationName: locations.name,
      stationId: sops.stationId,
      stationName: stations.name,
      updatedAt: sops.updatedAt,
    })
    .from(sops)
    .innerJoin(
      sopVersions,
      and(
        eq(sopVersions.id, sops.currentVersionId),
        eq(sopVersions.organizationId, sops.organizationId),
      ),
    )
    .innerJoin(
      locations,
      and(eq(locations.id, sops.locationId), eq(locations.organizationId, sops.organizationId)),
    )
    .leftJoin(
      stations,
      and(eq(stations.id, sops.stationId), eq(stations.organizationId, sops.organizationId)),
    )
    .where(and(...conditions))
    .orderBy(desc(sops.updatedAt), desc(sops.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last.updatedAt, last.id) : null,
  };
}

async function loadFileSummaries(organizationId: string, fileIds: readonly (string | null)[]) {
  const uniqueIds = [...new Set(fileIds.filter((id): id is string => Boolean(id)))];
  if (uniqueIds.length === 0)
    return new Map<
      string,
      { id: string; originalName: string; mimeType: string; mediaType: "image" | "video" }
    >();
  const rows = await getDb()
    .select({
      id: files.id,
      originalName: files.originalName,
      mimeType: files.mimeType,
      mediaType: files.mediaType,
    })
    .from(files)
    .where(and(inArray(files.id, uniqueIds), eq(files.organizationId, organizationId)));
  return new Map(rows.map((row) => [row.id, row]));
}

interface SopDetailBase {
  sop: typeof sops.$inferSelect;
  version: typeof sopVersions.$inferSelect;
  locationName: string;
  stationName: string | null;
}

async function buildSopDetail(actor: { organizationId: string }, detail: SopDetailBase) {
  const [steps, materials, warnings] = await Promise.all([
    getDb()
      .select()
      .from(sopSteps)
      .where(eq(sopSteps.sopVersionId, detail.version.id))
      .orderBy(asc(sopSteps.displayOrder)),
    getDb()
      .select()
      .from(sopMaterials)
      .where(eq(sopMaterials.sopVersionId, detail.version.id))
      .orderBy(asc(sopMaterials.displayOrder)),
    getDb()
      .select()
      .from(sopWarnings)
      .where(eq(sopWarnings.sopVersionId, detail.version.id))
      .orderBy(asc(sopWarnings.displayOrder)),
  ]);
  const fileMap = await loadFileSummaries(actor.organizationId, [
    detail.version.coverImageFileId,
    detail.version.sourceVideoFileId,
    ...steps.map((step) => step.imageFileId),
    ...steps.map((step) => step.videoFileId),
  ]);
  return {
    id: detail.sop.id,
    locationId: detail.sop.locationId,
    locationName: detail.locationName,
    stationId: detail.sop.stationId,
    stationName: detail.stationName,
    category: detail.sop.category,
    status: detail.sop.status,
    currentVersionId: detail.sop.currentVersionId,
    createdByManagerUserId: detail.sop.createdByManagerUserId,
    version: {
      ...detail.version,
      coverImageFile: detail.version.coverImageFileId
        ? (fileMap.get(detail.version.coverImageFileId) ?? null)
        : null,
      sourceVideoFile: detail.version.sourceVideoFileId
        ? (fileMap.get(detail.version.sourceVideoFileId) ?? null)
        : null,
    },
    steps: steps.map((step) => ({
      ...step,
      imageFile: step.imageFileId ? (fileMap.get(step.imageFileId) ?? null) : null,
      videoFile: step.videoFileId ? (fileMap.get(step.videoFileId) ?? null) : null,
    })),
    materials,
    warnings,
  };
}

export async function getSop(actor: ManagerSessionContext, sopId: string) {
  const detail = await requireManageableSop(actor, sopId);
  return buildSopDetail(actor, detail);
}

/** The in-progress draft version, distinct from the SOP's current published version. */
export async function getSopDraft(actor: ManagerSessionContext, sopId: string) {
  const detail = await requireDraftForEdit(actor, sopId);
  return buildSopDetail(actor, detail);
}

/** Whether this SOP currently has a draft version, whatever the SOP's overall status. */
export async function hasDraftVersion(
  actor: ManagerSessionContext,
  sopId: string,
): Promise<boolean> {
  await requireManageableSop(actor, sopId);
  return Boolean(await findDraftVersion(actor.organizationId, sopId));
}

export async function createSop(
  actor: ManagerSessionContext,
  input: SopCreateInput,
  requestId?: string,
) {
  await requireActiveManagedLocation(actor, input.locationId, requestId);
  if (input.stationId)
    await assertStationInLocation(actor.organizationId, input.stationId, input.locationId);
  if (input.coverImageFileId) await assertFileReady(actor.organizationId, input.coverImageFileId);
  if (input.sourceVideoFileId) await assertFileReady(actor.organizationId, input.sourceVideoFileId);

  const sopId = randomUUID();
  const versionId = randomUUID();

  await getDb().transaction(async (tx) => {
    await tx.insert(sops).values({
      id: sopId,
      organizationId: actor.organizationId,
      locationId: input.locationId,
      stationId: input.stationId,
      category: input.category,
      status: "draft",
      createdByManagerUserId: actor.managerUserId,
    });
    await tx.insert(sopVersions).values({
      id: versionId,
      sopId,
      organizationId: actor.organizationId,
      versionNumber: 1,
      status: "draft",
      title: input.title,
      description: input.description,
      category: input.category,
      estimatedMinutes: input.estimatedMinutes,
      difficulty: input.difficulty,
      coverImageFileId: input.coverImageFileId,
      sourceVideoFileId: input.sourceVideoFileId,
    });
    await tx.update(sops).set({ currentVersionId: versionId }).where(eq(sops.id, sopId));
    await replaceMaterials(tx, actor.organizationId, versionId, input.materials);
    await replaceWarnings(tx, actor.organizationId, versionId, input.warnings);
  });

  await auditSop(actor, "sop.created", sopId, input.locationId, requestId);
  return getSop(actor, sopId);
}

export async function autosaveSopDraft(
  actor: ManagerSessionContext,
  sopId: string,
  input: SopDraftUpdateInput,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);
  const nextLocationId = input.locationId ?? detail.sop.locationId;
  const nextStationId = input.stationId !== undefined ? input.stationId : detail.sop.stationId;

  if (input.locationId && input.locationId !== detail.sop.locationId) {
    await requireActiveManagedLocation(actor, input.locationId, requestId);
  }
  if (nextStationId) {
    await assertStationInLocation(actor.organizationId, nextStationId, nextLocationId);
  }
  if (input.coverImageFileId) await assertFileReady(actor.organizationId, input.coverImageFileId);
  if (input.sourceVideoFileId) {
    await assertFileReady(actor.organizationId, input.sourceVideoFileId);
  }

  const versionSet: Record<string, unknown> = {};
  if (input.title !== undefined) versionSet["title"] = input.title;
  if (input.description !== undefined) versionSet["description"] = input.description;
  if (input.category !== undefined) versionSet["category"] = input.category;
  if (input.estimatedMinutes !== undefined) versionSet["estimatedMinutes"] = input.estimatedMinutes;
  if (input.difficulty !== undefined) versionSet["difficulty"] = input.difficulty;
  if (input.coverImageFileId !== undefined) versionSet["coverImageFileId"] = input.coverImageFileId;
  if (input.sourceVideoFileId !== undefined) {
    versionSet["sourceVideoFileId"] = input.sourceVideoFileId;
  }

  await getDb().transaction(async (tx) => {
    await bumpRevision(
      tx,
      actor.organizationId,
      detail.version.id,
      input.expectedRevision,
      versionSet,
    );
    if (
      input.locationId !== undefined ||
      input.stationId !== undefined ||
      input.category !== undefined
    ) {
      const sopSet: Record<string, unknown> = { updatedAt: new Date() };
      if (input.locationId !== undefined) sopSet["locationId"] = input.locationId;
      if (input.stationId !== undefined) sopSet["stationId"] = input.stationId;
      if (input.category !== undefined) sopSet["category"] = input.category;
      await tx.update(sops).set(sopSet).where(eq(sops.id, sopId));
    }
    if (input.materials !== undefined) {
      await replaceMaterials(tx, actor.organizationId, detail.version.id, input.materials);
    }
    if (input.warnings !== undefined) {
      await replaceWarnings(tx, actor.organizationId, detail.version.id, input.warnings);
    }
  });

  await auditSop(actor, "sop.updated", sopId, nextLocationId, requestId);
  return getSopDraft(actor, sopId);
}

export async function createStep(
  actor: ManagerSessionContext,
  sopId: string,
  input: SopStepCreateInput,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);
  if (input.imageFileId) await assertFileReady(actor.organizationId, input.imageFileId);
  if (input.videoFileId) await assertFileReady(actor.organizationId, input.videoFileId);

  await getDb().transaction(async (tx) => {
    await bumpRevision(tx, actor.organizationId, detail.version.id, input.expectedRevision);
    const maxOrderRows = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${sopSteps.displayOrder}), 0)` })
      .from(sopSteps)
      .where(eq(sopSteps.sopVersionId, detail.version.id));
    const maxOrder = maxOrderRows[0]?.maxOrder ?? 0;
    await tx.insert(sopSteps).values({
      id: randomUUID(),
      sopVersionId: detail.version.id,
      organizationId: actor.organizationId,
      displayOrder: maxOrder + 1,
      title: input.title || null,
      instruction: input.instruction,
      imageFileId: input.imageFileId,
      videoFileId: input.videoFileId,
      warning: input.warning || null,
      quantity: input.quantity || null,
      unit: input.unit || null,
      equipmentSetting: input.equipmentSetting || null,
      timerSeconds: input.timerSeconds,
      isRequired: input.isRequired,
    });
  });

  await auditSop(actor, "sop.updated", sopId, detail.sop.locationId, requestId);
  return getSopDraft(actor, sopId);
}

export async function updateStep(
  actor: ManagerSessionContext,
  sopId: string,
  stepId: string,
  input: SopStepUpdateInput,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);
  if (input.imageFileId) await assertFileReady(actor.organizationId, input.imageFileId);
  if (input.videoFileId) await assertFileReady(actor.organizationId, input.videoFileId);

  await getDb().transaction(async (tx) => {
    await bumpRevision(tx, actor.organizationId, detail.version.id, input.expectedRevision);
    const [row] = await tx
      .update(sopSteps)
      .set({
        title: input.title || null,
        instruction: input.instruction,
        imageFileId: input.imageFileId,
        videoFileId: input.videoFileId,
        warning: input.warning || null,
        quantity: input.quantity || null,
        unit: input.unit || null,
        equipmentSetting: input.equipmentSetting || null,
        timerSeconds: input.timerSeconds,
        isRequired: input.isRequired,
        updatedAt: new Date(),
      })
      .where(and(eq(sopSteps.id, stepId), eq(sopSteps.sopVersionId, detail.version.id)))
      .returning({ id: sopSteps.id });
    if (!row) throw new AppError("NOT_FOUND", "Step not found.");
  });

  await auditSop(actor, "sop.updated", sopId, detail.sop.locationId, requestId);
  return getSopDraft(actor, sopId);
}

export async function duplicateStep(
  actor: ManagerSessionContext,
  sopId: string,
  stepId: string,
  expectedRevision: number,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);

  await getDb().transaction(async (tx) => {
    await bumpRevision(tx, actor.organizationId, detail.version.id, expectedRevision);
    const [original] = await tx
      .select()
      .from(sopSteps)
      .where(and(eq(sopSteps.id, stepId), eq(sopSteps.sopVersionId, detail.version.id)))
      .limit(1);
    if (!original) throw new AppError("NOT_FOUND", "Step not found.");
    const maxOrderRows = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${sopSteps.displayOrder}), 0)` })
      .from(sopSteps)
      .where(eq(sopSteps.sopVersionId, detail.version.id));
    const maxOrder = maxOrderRows[0]?.maxOrder ?? 0;
    await tx.insert(sopSteps).values({
      id: randomUUID(),
      sopVersionId: detail.version.id,
      organizationId: actor.organizationId,
      displayOrder: maxOrder + 1,
      title: original.title,
      instruction: original.instruction,
      imageFileId: original.imageFileId,
      videoFileId: original.videoFileId,
      warning: original.warning,
      quantity: original.quantity,
      unit: original.unit,
      equipmentSetting: original.equipmentSetting,
      timerSeconds: original.timerSeconds,
      isRequired: original.isRequired,
    });
  });

  await auditSop(actor, "sop.updated", sopId, detail.sop.locationId, requestId);
  return getSopDraft(actor, sopId);
}

export async function deleteStep(
  actor: ManagerSessionContext,
  sopId: string,
  stepId: string,
  expectedRevision: number,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);

  await getDb().transaction(async (tx) => {
    await bumpRevision(tx, actor.organizationId, detail.version.id, expectedRevision);
    const [row] = await tx
      .delete(sopSteps)
      .where(and(eq(sopSteps.id, stepId), eq(sopSteps.sopVersionId, detail.version.id)))
      .returning({ id: sopSteps.id });
    if (!row) throw new AppError("NOT_FOUND", "Step not found.");
    const remaining = await tx
      .select({ id: sopSteps.id })
      .from(sopSteps)
      .where(eq(sopSteps.sopVersionId, detail.version.id))
      .orderBy(asc(sopSteps.displayOrder));
    for (let index = 0; index < remaining.length; index += 1) {
      const step = remaining[index];
      if (!step) continue;
      await tx
        .update(sopSteps)
        .set({ displayOrder: index + 1 })
        .where(eq(sopSteps.id, step.id));
    }
  });

  await auditSop(actor, "sop.step_deleted", sopId, detail.sop.locationId, requestId);
  return getSopDraft(actor, sopId);
}

export async function reorderSteps(
  actor: ManagerSessionContext,
  sopId: string,
  orderedStepIds: readonly string[],
  expectedRevision: number,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);

  await getDb().transaction(async (tx) => {
    await bumpRevision(tx, actor.organizationId, detail.version.id, expectedRevision);
    const existing = await tx
      .select({ id: sopSteps.id })
      .from(sopSteps)
      .where(eq(sopSteps.sopVersionId, detail.version.id));
    const existingIds = new Set(existing.map((row) => row.id));
    if (
      orderedStepIds.length !== existingIds.size ||
      !orderedStepIds.every((id) => existingIds.has(id))
    ) {
      throw new AppError("BAD_REQUEST", "The step order is invalid.");
    }
    for (let index = 0; index < orderedStepIds.length; index += 1) {
      await tx
        .update(sopSteps)
        .set({ displayOrder: index + 1 })
        .where(eq(sopSteps.id, orderedStepIds[index]!));
    }
  });

  await auditSop(actor, "sop.updated", sopId, detail.sop.locationId, requestId);
  return getSopDraft(actor, sopId);
}

export async function loadTrainingConfig(organizationId: string, sopVersionId: string) {
  const [row] = await getDb()
    .select()
    .from(trainingConfigs)
    .where(
      and(
        eq(trainingConfigs.sopVersionId, sopVersionId),
        eq(trainingConfigs.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return defaultTrainingConfigValues();
  return {
    requirementState: row.requirementState,
    defaultMode: row.defaultMode,
    allowBacktracking: row.allowBacktracking,
    requireSequentialProgress: row.requireSequentialProgress,
    requireFullVideoWatch: row.requireFullVideoWatch,
    requireEvidenceApproval: row.requireEvidenceApproval,
    passingScorePercent: row.passingScorePercent,
    maxAttempts: row.maxAttempts,
    qualificationValidityDays: row.qualificationValidityDays,
    retrainingGraceDays: row.retrainingGraceDays,
  };
}

/** The in-progress draft's training configuration, or defaults when none has been saved yet. */
export async function getTrainingConfigDraft(actor: ManagerSessionContext, sopId: string) {
  const detail = await requireDraftForEdit(actor, sopId);
  const config = await loadTrainingConfig(actor.organizationId, detail.version.id);
  return { sopId, revision: detail.version.revision, config };
}

export async function updateTrainingConfig(
  actor: ManagerSessionContext,
  sopId: string,
  input: TrainingConfigUpdateInput,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);
  const values = {
    requirementState: input.requirementState,
    defaultMode: input.defaultMode,
    allowBacktracking: input.allowBacktracking,
    requireSequentialProgress: input.requireSequentialProgress,
    requireFullVideoWatch: input.requireFullVideoWatch,
    requireEvidenceApproval: input.requireEvidenceApproval,
    passingScorePercent: input.passingScorePercent,
    maxAttempts: input.maxAttempts,
    qualificationValidityDays: input.qualificationValidityDays,
    retrainingGraceDays: input.retrainingGraceDays,
  };

  await getDb().transaction(async (tx) => {
    await bumpRevision(tx, actor.organizationId, detail.version.id, input.expectedRevision);
    await tx
      .insert(trainingConfigs)
      .values({
        id: randomUUID(),
        sopVersionId: detail.version.id,
        organizationId: actor.organizationId,
        ...values,
      })
      .onConflictDoUpdate({
        target: trainingConfigs.sopVersionId,
        set: { ...values, updatedAt: new Date() },
      });
  });

  await auditSop(actor, "sop.updated", sopId, detail.sop.locationId, requestId);
  return getTrainingConfigDraft(actor, sopId);
}

export async function loadStepTrainingRequirementsMap(sopVersionId: string) {
  const steps = await getDb()
    .select({ id: sopSteps.id })
    .from(sopSteps)
    .where(eq(sopSteps.sopVersionId, sopVersionId));
  const rows =
    steps.length > 0
      ? await getDb()
          .select()
          .from(stepTrainingRequirements)
          .where(
            inArray(
              stepTrainingRequirements.stepId,
              steps.map((step) => step.id),
            ),
          )
      : [];
  const rowByStepId = new Map(rows.map((row) => [row.stepId, row]));
  const requirementsByStepId: Record<string, ReturnType<typeof defaultStepRequirementValues>> = {};
  for (const step of steps) {
    const row = rowByStepId.get(step.id);
    requirementsByStepId[step.id] = row
      ? {
          requireFullVideo: row.requireFullVideo,
          requireConfirmation: row.requireConfirmation,
          requireTimer: row.requireTimer,
          requireQuestion: row.requireQuestion,
          requirePhoto: row.requirePhoto,
          requireVideo: row.requireVideo,
          requireApproval: row.requireApproval,
        }
      : defaultStepRequirementValues();
  }
  return requirementsByStepId;
}

/** Every step's training requirements for the in-progress draft, defaulted where unset. */
export async function getStepTrainingRequirementsDraft(
  actor: ManagerSessionContext,
  sopId: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);
  const requirementsByStepId = await loadStepTrainingRequirementsMap(detail.version.id);
  return { sopId, revision: detail.version.revision, requirementsByStepId };
}

export async function updateStepTrainingRequirements(
  actor: ManagerSessionContext,
  sopId: string,
  stepId: string,
  input: StepTrainingRequirementsInput,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);
  const [step] = await getDb()
    .select()
    .from(sopSteps)
    .where(and(eq(sopSteps.id, stepId), eq(sopSteps.sopVersionId, detail.version.id)))
    .limit(1);
  if (!step) throw new AppError("NOT_FOUND", "Step not found.");
  if (input.requireTimer && !step.timerSeconds) {
    throw new AppError("BAD_REQUEST", "Add a step timer before requiring it in training.");
  }
  if (input.requireFullVideo && !step.videoFileId) {
    throw new AppError("BAD_REQUEST", "Add a step video before requiring it to be fully watched.");
  }

  const values = {
    requireFullVideo: input.requireFullVideo,
    requireConfirmation: input.requireConfirmation,
    requireTimer: input.requireTimer,
    requireQuestion: input.requireQuestion,
    requirePhoto: input.requirePhoto,
    requireVideo: input.requireVideo,
    requireApproval: input.requireApproval,
  };

  await getDb().transaction(async (tx) => {
    await bumpRevision(tx, actor.organizationId, detail.version.id, input.expectedRevision);
    await tx
      .insert(stepTrainingRequirements)
      .values({ id: randomUUID(), stepId, organizationId: actor.organizationId, ...values })
      .onConflictDoUpdate({
        target: stepTrainingRequirements.stepId,
        set: { ...values, updatedAt: new Date() },
      });
  });

  await auditSop(actor, "sop.updated", sopId, detail.sop.locationId, requestId);
  return getStepTrainingRequirementsDraft(actor, sopId);
}

function questionGroupCondition(sopVersionId: string, stepId: string | null) {
  return stepId
    ? and(eq(trainingQuestions.sopVersionId, sopVersionId), eq(trainingQuestions.stepId, stepId))
    : and(eq(trainingQuestions.sopVersionId, sopVersionId), isNull(trainingQuestions.stepId));
}

export async function loadTrainingQuestions(sopVersionId: string) {
  const questions = await getDb()
    .select()
    .from(trainingQuestions)
    .where(eq(trainingQuestions.sopVersionId, sopVersionId))
    .orderBy(asc(trainingQuestions.displayOrder));
  if (questions.length === 0) return [];
  const choices = await getDb()
    .select()
    .from(trainingQuestionChoices)
    .where(
      inArray(
        trainingQuestionChoices.questionId,
        questions.map((question) => question.id),
      ),
    )
    .orderBy(asc(trainingQuestionChoices.displayOrder));
  const choicesByQuestionId = new Map<string, typeof choices>();
  for (const choice of choices) {
    const list = choicesByQuestionId.get(choice.questionId) ?? [];
    list.push(choice);
    choicesByQuestionId.set(choice.questionId, list);
  }
  return questions.map((question) => ({
    ...question,
    choices: choicesByQuestionId.get(question.id) ?? [],
  }));
}

/** The in-progress draft's step and final questions, each with their ordered choices. */
export async function getTrainingQuestionsDraft(actor: ManagerSessionContext, sopId: string) {
  const detail = await requireDraftForEdit(actor, sopId);
  return {
    sopId,
    revision: detail.version.revision,
    questions: await loadTrainingQuestions(detail.version.id),
  };
}

export async function getTrainingQuestion(
  actor: ManagerSessionContext,
  sopId: string,
  questionId: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);
  const [question] = await getDb()
    .select()
    .from(trainingQuestions)
    .where(
      and(
        eq(trainingQuestions.id, questionId),
        eq(trainingQuestions.sopVersionId, detail.version.id),
      ),
    )
    .limit(1);
  if (!question) throw new AppError("NOT_FOUND", "Question not found.");
  const choices = await getDb()
    .select()
    .from(trainingQuestionChoices)
    .where(eq(trainingQuestionChoices.questionId, questionId))
    .orderBy(asc(trainingQuestionChoices.displayOrder));
  return { ...question, choices };
}

async function assertQuestionStepBelongsToVersion(
  organizationId: string,
  sopVersionId: string,
  stepId: string,
): Promise<void> {
  const [step] = await getDb()
    .select({ id: sopSteps.id })
    .from(sopSteps)
    .where(
      and(
        eq(sopSteps.id, stepId),
        eq(sopSteps.sopVersionId, sopVersionId),
        eq(sopSteps.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!step) throw new AppError("BAD_REQUEST", "That step is not part of this SOP draft.");
}

export async function createTrainingQuestion(
  actor: ManagerSessionContext,
  sopId: string,
  input: TrainingQuestionCreateInput,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);
  if (input.stepId) {
    await assertQuestionStepBelongsToVersion(actor.organizationId, detail.version.id, input.stepId);
  }

  await getDb().transaction(async (tx) => {
    await bumpRevision(tx, actor.organizationId, detail.version.id, input.expectedRevision);
    const maxOrderRows = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${trainingQuestions.displayOrder}), 0)` })
      .from(trainingQuestions)
      .where(questionGroupCondition(detail.version.id, input.stepId));
    const maxOrder = maxOrderRows[0]?.maxOrder ?? 0;
    const questionId = randomUUID();
    await tx.insert(trainingQuestions).values({
      id: questionId,
      sopVersionId: detail.version.id,
      organizationId: actor.organizationId,
      stepId: input.stepId,
      type: input.type,
      text: input.text,
      explanation: input.explanation,
      points: input.points,
      placement: input.placement,
      displayOrder: maxOrder + 1,
      explanationPolicy: input.explanationPolicy,
    });
    await tx.insert(trainingQuestionChoices).values(
      input.choices.map((choice, index) => ({
        id: randomUUID(),
        questionId,
        organizationId: actor.organizationId,
        text: choice.text,
        isCorrect: choice.isCorrect,
        displayOrder: index + 1,
      })),
    );
  });

  await auditSop(actor, "sop.updated", sopId, detail.sop.locationId, requestId);
  return getTrainingQuestionsDraft(actor, sopId);
}

export async function updateTrainingQuestion(
  actor: ManagerSessionContext,
  sopId: string,
  questionId: string,
  input: TrainingQuestionUpdateInput,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);
  if (input.stepId) {
    await assertQuestionStepBelongsToVersion(actor.organizationId, detail.version.id, input.stepId);
  }

  await getDb().transaction(async (tx) => {
    await bumpRevision(tx, actor.organizationId, detail.version.id, input.expectedRevision);
    const [existing] = await tx
      .select({ id: trainingQuestions.id, stepId: trainingQuestions.stepId })
      .from(trainingQuestions)
      .where(
        and(
          eq(trainingQuestions.id, questionId),
          eq(trainingQuestions.sopVersionId, detail.version.id),
        ),
      )
      .limit(1);
    if (!existing) throw new AppError("NOT_FOUND", "Question not found.");

    let displayOrder: number;
    if (existing.stepId === input.stepId) {
      const [current] = await tx
        .select({ displayOrder: trainingQuestions.displayOrder })
        .from(trainingQuestions)
        .where(eq(trainingQuestions.id, questionId))
        .limit(1);
      displayOrder = current?.displayOrder ?? 1;
    } else {
      const maxOrderRows = await tx
        .select({ maxOrder: sql<number>`coalesce(max(${trainingQuestions.displayOrder}), 0)` })
        .from(trainingQuestions)
        .where(questionGroupCondition(detail.version.id, input.stepId));
      displayOrder = (maxOrderRows[0]?.maxOrder ?? 0) + 1;
    }

    await tx
      .update(trainingQuestions)
      .set({
        stepId: input.stepId,
        type: input.type,
        text: input.text,
        explanation: input.explanation,
        points: input.points,
        placement: input.placement,
        displayOrder,
        explanationPolicy: input.explanationPolicy,
        updatedAt: new Date(),
      })
      .where(eq(trainingQuestions.id, questionId));

    await tx
      .delete(trainingQuestionChoices)
      .where(eq(trainingQuestionChoices.questionId, questionId));
    await tx.insert(trainingQuestionChoices).values(
      input.choices.map((choice, index) => ({
        id: randomUUID(),
        questionId,
        organizationId: actor.organizationId,
        text: choice.text,
        isCorrect: choice.isCorrect,
        displayOrder: index + 1,
      })),
    );
  });

  await auditSop(actor, "sop.updated", sopId, detail.sop.locationId, requestId);
  return getTrainingQuestionsDraft(actor, sopId);
}

export async function deleteTrainingQuestion(
  actor: ManagerSessionContext,
  sopId: string,
  questionId: string,
  expectedRevision: number,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);

  await getDb().transaction(async (tx) => {
    await bumpRevision(tx, actor.organizationId, detail.version.id, expectedRevision);
    const [row] = await tx
      .delete(trainingQuestions)
      .where(
        and(
          eq(trainingQuestions.id, questionId),
          eq(trainingQuestions.sopVersionId, detail.version.id),
        ),
      )
      .returning({ id: trainingQuestions.id, stepId: trainingQuestions.stepId });
    if (!row) throw new AppError("NOT_FOUND", "Question not found.");
    const remaining = await tx
      .select({ id: trainingQuestions.id })
      .from(trainingQuestions)
      .where(questionGroupCondition(detail.version.id, row.stepId))
      .orderBy(asc(trainingQuestions.displayOrder));
    for (let index = 0; index < remaining.length; index += 1) {
      const question = remaining[index];
      if (!question) continue;
      await tx
        .update(trainingQuestions)
        .set({ displayOrder: index + 1 })
        .where(eq(trainingQuestions.id, question.id));
    }
  });

  await auditSop(actor, "sop.updated", sopId, detail.sop.locationId, requestId);
  return getTrainingQuestionsDraft(actor, sopId);
}

export async function reorderTrainingQuestions(
  actor: ManagerSessionContext,
  sopId: string,
  stepId: string | null,
  orderedQuestionIds: readonly string[],
  expectedRevision: number,
  requestId?: string,
) {
  const detail = await requireDraftForEdit(actor, sopId);

  await getDb().transaction(async (tx) => {
    await bumpRevision(tx, actor.organizationId, detail.version.id, expectedRevision);
    const existing = await tx
      .select({ id: trainingQuestions.id })
      .from(trainingQuestions)
      .where(questionGroupCondition(detail.version.id, stepId));
    const existingIds = new Set(existing.map((row) => row.id));
    if (
      orderedQuestionIds.length !== existingIds.size ||
      !orderedQuestionIds.every((id) => existingIds.has(id))
    ) {
      throw new AppError("BAD_REQUEST", "The question order is invalid.");
    }
    for (let index = 0; index < orderedQuestionIds.length; index += 1) {
      await tx
        .update(trainingQuestions)
        .set({ displayOrder: index + 1 })
        .where(eq(trainingQuestions.id, orderedQuestionIds[index]!));
    }
  });

  await auditSop(actor, "sop.updated", sopId, detail.sop.locationId, requestId);
  return getTrainingQuestionsDraft(actor, sopId);
}

/** Previews the in-progress draft when one exists, otherwise the current published version. */
export async function previewSop(actor: ManagerSessionContext, sopId: string, requestId?: string) {
  const base = await requireManageableSop(actor, sopId);
  const draft = await findDraftVersion(actor.organizationId, sopId);
  const detail = draft
    ? await buildSopDetail(actor, { ...base, version: draft })
    : await buildSopDetail(actor, base);
  await auditSop(actor, "sop.previewed", sopId, detail.locationId, requestId);
  return detail;
}

export interface SopPublishIssue {
  code: string;
  message: string;
}

async function evaluatePublishReadiness(
  organizationId: string,
  detail: SopDetailBase,
  options: { requireChangeSummary: boolean; changeSummary: string },
): Promise<SopPublishIssue[]> {
  const issues: SopPublishIssue[] = [];
  if (!detail.version.title.trim()) {
    issues.push({ code: "title", message: "The SOP needs a title." });
  }
  if (options.requireChangeSummary && !options.changeSummary.trim()) {
    issues.push({
      code: "change_summary",
      message: "Describe what changed in this version before publishing an update.",
    });
  }

  const steps = await getDb()
    .select()
    .from(sopSteps)
    .where(eq(sopSteps.sopVersionId, detail.version.id))
    .orderBy(asc(sopSteps.displayOrder));
  if (steps.length === 0) {
    issues.push({ code: "steps", message: "Add at least one step before publishing." });
  }
  for (const step of steps) {
    if (!step.instruction.trim()) {
      issues.push({ code: "step_instruction", message: "Every step needs an instruction." });
      break;
    }
  }
  if (steps.some((step) => step.timerSeconds !== null && step.timerSeconds <= 0)) {
    issues.push({ code: "step_timer", message: "Fix invalid step timer values." });
  }

  const referencedFileIds = [
    detail.version.coverImageFileId,
    detail.version.sourceVideoFileId,
    ...steps.map((step) => step.imageFileId),
    ...steps.map((step) => step.videoFileId),
  ].filter((id): id is string => Boolean(id));
  if (referencedFileIds.length > 0) {
    const fileRows = await getDb()
      .select({ id: files.id, status: files.status })
      .from(files)
      .where(and(inArray(files.id, referencedFileIds), eq(files.organizationId, organizationId)));
    const readyIds = new Set(fileRows.filter((row) => row.status === "ready").map((row) => row.id));
    if (referencedFileIds.some((id) => !readyIds.has(id))) {
      issues.push({ code: "media", message: "Finish uploading all media before publishing." });
    }
  }

  const [config, stepRequirementRows, questionRows] = await Promise.all([
    loadTrainingConfig(organizationId, detail.version.id),
    steps.length > 0
      ? getDb()
          .select({
            stepId: stepTrainingRequirements.stepId,
            requireQuestion: stepTrainingRequirements.requireQuestion,
          })
          .from(stepTrainingRequirements)
          .where(
            inArray(
              stepTrainingRequirements.stepId,
              steps.map((step) => step.id),
            ),
          )
      : Promise.resolve([]),
    getDb()
      .select({ id: trainingQuestions.id, stepId: trainingQuestions.stepId })
      .from(trainingQuestions)
      .where(eq(trainingQuestions.sopVersionId, detail.version.id)),
  ]);
  if (
    config.requirementState !== "disabled" &&
    (config.defaultMode === "test" || config.defaultMode === "demonstration") &&
    questionRows.length === 0
  ) {
    issues.push({
      code: "training_questions",
      message: "Add at least one question before publishing test or demonstration training.",
    });
  }
  const questionStepIds = new Set(
    questionRows.filter((question) => question.stepId).map((question) => question.stepId as string),
  );
  if (stepRequirementRows.some((row) => row.requireQuestion && !questionStepIds.has(row.stepId))) {
    issues.push({
      code: "step_question_requirement",
      message: "Every step that requires a question needs at least one attached question.",
    });
  }

  return issues;
}

export async function getPublishReadiness(actor: ManagerSessionContext, sopId: string) {
  const base = await requireManageableSop(actor, sopId);
  const draft = await findDraftVersion(actor.organizationId, sopId);
  const isUpdate = base.sop.status === "published" || base.sop.status === "archived";
  if (!draft) {
    return {
      sopId,
      status: base.sop.status,
      hasDraft: false,
      isUpdate,
      versionNumber: base.version.versionNumber,
      revision: base.version.revision,
      canPublish: false,
      issues: [] as SopPublishIssue[],
    };
  }
  const issues = await evaluatePublishReadiness(
    actor.organizationId,
    { ...base, version: draft },
    { requireChangeSummary: isUpdate, changeSummary: draft.changeSummary },
  );
  // The change summary is filled in on the publish form itself, so it must not permanently
  // disable the submit button before the manager has had a chance to type it in. The form
  // enforces it client-side, and publishSop enforces it again server-side at submit time.
  const structuralIssues = issues.filter((issue) => issue.code !== "change_summary");
  return {
    sopId,
    status: draft.status,
    hasDraft: true,
    isUpdate,
    versionNumber: draft.versionNumber,
    revision: draft.revision,
    canPublish: structuralIssues.length === 0,
    issues,
  };
}

async function persistRetrainingRule(
  tx: Tx,
  organizationId: string,
  sopVersionId: string,
  rule: RetrainingRuleInput,
): Promise<void> {
  if (rule.type === "none") return;
  const ruleId = randomUUID();
  await tx.insert(sopRetrainingRules).values({
    id: ruleId,
    sopVersionId,
    organizationId,
    ruleType: rule.type,
  });
  if (rule.type === "selected_roles") {
    await tx.insert(sopRetrainingRuleRoles).values(
      rule.jobRoles.map((jobRole) => ({
        id: randomUUID(),
        ruleId,
        organizationId,
        jobRole,
      })),
    );
  }
  if (rule.type === "selected_locations") {
    await tx.insert(sopRetrainingRuleLocations).values(
      rule.locationIds.map((locationId) => ({
        id: randomUUID(),
        ruleId,
        organizationId,
        locationId,
      })),
    );
  }
}

export async function publishSop(
  actor: ManagerSessionContext,
  sopId: string,
  input: SopPublishInput,
  requestId?: string,
) {
  const base = await requireManageableSop(actor, sopId);
  if (base.sop.status === "archived") {
    throw new AppError("CONFLICT", "Archived SOPs cannot be published.");
  }
  const draft = await findDraftVersion(actor.organizationId, sopId);
  if (!draft) {
    throw new AppError("CONFLICT", "This SOP does not have a draft to publish.");
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== draft.revision) {
    throw new AppError("CONFLICT", "This SOP draft changed elsewhere. Reload to continue.", {
      details: { currentRevision: draft.revision },
    });
  }

  const isUpdate = base.sop.status === "published";
  if (!isUpdate && input.retrainingRule.type !== "none") {
    throw new AppError(
      "BAD_REQUEST",
      "A retraining rule only applies when publishing an update to a previously published SOP.",
    );
  }
  if (input.retrainingRule.type === "selected_locations") {
    const managedIds = new Set(await getManagedLocationIds(actor));
    if (input.retrainingRule.locationIds.some((locationId) => !managedIds.has(locationId))) {
      throw new AppError("FORBIDDEN", "You do not have access to one of the selected locations.");
    }
  }

  const issues = await evaluatePublishReadiness(
    actor.organizationId,
    { ...base, version: draft },
    { requireChangeSummary: isUpdate, changeSummary: input.changeSummary },
  );
  if (issues.length > 0) {
    throw new AppError("VALIDATION_ERROR", "Fix the issues below before publishing.", {
      details: { issues },
    });
  }

  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(sopVersions)
      .set({
        status: "published",
        publishedAt: new Date(),
        publishedByManagerUserId: actor.managerUserId,
        changeSummary: input.changeSummary,
        revision: draft.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sopVersions.id, draft.id),
          eq(sopVersions.organizationId, actor.organizationId),
          eq(sopVersions.revision, draft.revision),
          eq(sopVersions.status, "draft"),
        ),
      )
      .returning({ id: sopVersions.id });
    if (!row) {
      throw new AppError("CONFLICT", "This SOP draft changed elsewhere. Reload to continue.");
    }
    await tx
      .update(sops)
      .set({ status: "published", currentVersionId: draft.id, updatedAt: new Date() })
      .where(eq(sops.id, sopId));
    // A training configuration always exists for a published version, even if the manager never
    // visited the training page: default it to disabled rather than leaving it unset.
    await tx
      .insert(trainingConfigs)
      .values({
        id: randomUUID(),
        sopVersionId: draft.id,
        organizationId: actor.organizationId,
        ...defaultTrainingConfigValues(),
      })
      .onConflictDoNothing({ target: trainingConfigs.sopVersionId });
    if (isUpdate) {
      await persistRetrainingRule(tx, actor.organizationId, draft.id, input.retrainingRule);
    }
  });

  await auditSop(actor, "sop.published", sopId, base.sop.locationId, requestId);
  const publishedEvent = await writeDomainEvent({
    organizationId: actor.organizationId,
    locationId: base.sop.locationId,
    type: "sop.published",
    subjectType: "sop",
    subjectId: sopId,
    payload: { versionNumber: draft.versionNumber, isUpdate },
  });
  await dispatchNotificationsForDomainEvent(publishedEvent);
  return getSop(actor, sopId);
}

export async function archiveSop(actor: ManagerSessionContext, sopId: string, requestId?: string) {
  const detail = await requireManageableSop(actor, sopId);
  if (detail.sop.status === "archived") {
    throw new AppError("CONFLICT", "This SOP is already archived.");
  }
  const draft = await findDraftVersion(actor.organizationId, sopId);
  await getDb().transaction(async (tx) => {
    await tx
      .update(sops)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(sops.id, sopId));
    await tx
      .update(sopVersions)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(sopVersions.id, detail.version.id));
    if (draft && draft.id !== detail.version.id) {
      await tx
        .update(sopVersions)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(sopVersions.id, draft.id));
    }
  });
  await auditSop(actor, "sop.archived", sopId, detail.sop.locationId, requestId);
  const archivedEvent = await writeDomainEvent({
    organizationId: actor.organizationId,
    locationId: detail.sop.locationId,
    type: "sop.archived",
    subjectType: "sop",
    subjectId: sopId,
    payload: { versionTitle: detail.version.title },
  });
  await dispatchNotificationsForDomainEvent(archivedEvent);
  return getSop(actor, sopId);
}

async function cloneVersionIntoNewDraft(
  tx: Tx,
  organizationId: string,
  sopId: string,
  sourceVersion: typeof sopVersions.$inferSelect,
  nextVersionNumber: number,
): Promise<string> {
  const versionId = randomUUID();
  await tx.insert(sopVersions).values({
    id: versionId,
    sopId,
    organizationId,
    versionNumber: nextVersionNumber,
    status: "draft",
    title: sourceVersion.title,
    description: sourceVersion.description,
    category: sourceVersion.category,
    estimatedMinutes: sourceVersion.estimatedMinutes,
    difficulty: sourceVersion.difficulty,
    coverImageFileId: sourceVersion.coverImageFileId,
    sourceVideoFileId: sourceVersion.sourceVideoFileId,
    sourceVersionId: sourceVersion.id,
  });
  const [materials, warnings, steps] = await Promise.all([
    tx
      .select()
      .from(sopMaterials)
      .where(eq(sopMaterials.sopVersionId, sourceVersion.id))
      .orderBy(asc(sopMaterials.displayOrder)),
    tx
      .select()
      .from(sopWarnings)
      .where(eq(sopWarnings.sopVersionId, sourceVersion.id))
      .orderBy(asc(sopWarnings.displayOrder)),
    tx
      .select()
      .from(sopSteps)
      .where(eq(sopSteps.sopVersionId, sourceVersion.id))
      .orderBy(asc(sopSteps.displayOrder)),
  ]);
  if (materials.length > 0) {
    await tx.insert(sopMaterials).values(
      materials.map((material) => ({
        id: randomUUID(),
        sopVersionId: versionId,
        organizationId,
        kind: material.kind,
        name: material.name,
        quantity: material.quantity,
        unit: material.unit,
        displayOrder: material.displayOrder,
      })),
    );
  }
  if (warnings.length > 0) {
    await tx.insert(sopWarnings).values(
      warnings.map((warning) => ({
        id: randomUUID(),
        sopVersionId: versionId,
        organizationId,
        text: warning.text,
        displayOrder: warning.displayOrder,
      })),
    );
  }
  const stepIdMap = new Map<string, string>();
  if (steps.length > 0) {
    const stepInserts = steps.map((step) => {
      const newStepId = randomUUID();
      stepIdMap.set(step.id, newStepId);
      return {
        id: newStepId,
        sopVersionId: versionId,
        organizationId,
        displayOrder: step.displayOrder,
        title: step.title,
        instruction: step.instruction,
        imageFileId: step.imageFileId,
        videoFileId: step.videoFileId,
        warning: step.warning,
        quantity: step.quantity,
        unit: step.unit,
        equipmentSetting: step.equipmentSetting,
        timerSeconds: step.timerSeconds,
        isRequired: step.isRequired,
      };
    });
    await tx.insert(sopSteps).values(stepInserts);
  }

  const [config, stepRequirementRows, questions] = await Promise.all([
    tx
      .select()
      .from(trainingConfigs)
      .where(eq(trainingConfigs.sopVersionId, sourceVersion.id))
      .limit(1),
    steps.length > 0
      ? tx
          .select()
          .from(stepTrainingRequirements)
          .where(
            inArray(
              stepTrainingRequirements.stepId,
              steps.map((step) => step.id),
            ),
          )
      : Promise.resolve([]),
    tx
      .select()
      .from(trainingQuestions)
      .where(eq(trainingQuestions.sopVersionId, sourceVersion.id))
      .orderBy(asc(trainingQuestions.displayOrder)),
  ]);

  if (config[0]) {
    const sourceConfig = config[0];
    await tx.insert(trainingConfigs).values({
      id: randomUUID(),
      sopVersionId: versionId,
      organizationId,
      requirementState: sourceConfig.requirementState,
      defaultMode: sourceConfig.defaultMode,
      allowBacktracking: sourceConfig.allowBacktracking,
      requireSequentialProgress: sourceConfig.requireSequentialProgress,
      requireFullVideoWatch: sourceConfig.requireFullVideoWatch,
      requireEvidenceApproval: sourceConfig.requireEvidenceApproval,
      passingScorePercent: sourceConfig.passingScorePercent,
      maxAttempts: sourceConfig.maxAttempts,
      qualificationValidityDays: sourceConfig.qualificationValidityDays,
      retrainingGraceDays: sourceConfig.retrainingGraceDays,
    });
  }

  if (stepRequirementRows.length > 0) {
    await tx.insert(stepTrainingRequirements).values(
      stepRequirementRows.map((row) => ({
        id: randomUUID(),
        stepId: stepIdMap.get(row.stepId)!,
        organizationId,
        requireFullVideo: row.requireFullVideo,
        requireConfirmation: row.requireConfirmation,
        requireTimer: row.requireTimer,
        requireQuestion: row.requireQuestion,
        requirePhoto: row.requirePhoto,
        requireVideo: row.requireVideo,
        requireApproval: row.requireApproval,
      })),
    );
  }

  const questionIdMap = new Map<string, string>();
  if (questions.length > 0) {
    const questionInserts = questions.map((question) => {
      const newQuestionId = randomUUID();
      questionIdMap.set(question.id, newQuestionId);
      return {
        id: newQuestionId,
        sopVersionId: versionId,
        organizationId,
        stepId: question.stepId ? (stepIdMap.get(question.stepId) ?? null) : null,
        type: question.type,
        text: question.text,
        explanation: question.explanation,
        points: question.points,
        placement: question.placement,
        displayOrder: question.displayOrder,
        explanationPolicy: question.explanationPolicy,
      };
    });
    await tx.insert(trainingQuestions).values(questionInserts);

    const choices = await tx
      .select()
      .from(trainingQuestionChoices)
      .where(
        inArray(
          trainingQuestionChoices.questionId,
          questions.map((question) => question.id),
        ),
      )
      .orderBy(asc(trainingQuestionChoices.displayOrder));
    if (choices.length > 0) {
      await tx.insert(trainingQuestionChoices).values(
        choices.map((choice) => ({
          id: randomUUID(),
          questionId: questionIdMap.get(choice.questionId)!,
          organizationId,
          text: choice.text,
          isCorrect: choice.isCorrect,
          displayOrder: choice.displayOrder,
        })),
      );
    }
  }

  return versionId;
}

async function createDraftFromVersion(
  actor: ManagerSessionContext,
  sopId: string,
  sourceVersionId: string,
  requestId?: string,
) {
  const base = await requireManageableSop(actor, sopId);
  if (base.sop.status === "archived") {
    throw new AppError("CONFLICT", "Archived SOPs cannot start a new draft.");
  }
  const existingDraft = await findDraftVersion(actor.organizationId, sopId);
  if (existingDraft) {
    throw new AppError("CONFLICT", "This SOP already has a draft in progress.");
  }
  const sourceVersion = await findVersionById(actor.organizationId, sopId, sourceVersionId);
  if (!sourceVersion) throw new AppError("NOT_FOUND", "Version not found.");
  if (sourceVersion.status === "draft") {
    throw new AppError("CONFLICT", "That version is already a draft.");
  }

  const [maxOrderRow] = await getDb()
    .select({ maxVersion: sql<number>`coalesce(max(${sopVersions.versionNumber}), 0)` })
    .from(sopVersions)
    .where(eq(sopVersions.sopId, sopId));
  const nextVersionNumber = (maxOrderRow?.maxVersion ?? 0) + 1;

  await getDb().transaction((tx) =>
    cloneVersionIntoNewDraft(tx, actor.organizationId, sopId, sourceVersion, nextVersionNumber),
  );

  const isRestoration = sourceVersionId !== base.sop.currentVersionId;
  await auditSop(
    actor,
    isRestoration ? "sop.version_restored" : "sop.draft_created",
    sopId,
    base.sop.locationId,
    requestId,
  );
  return getSopDraft(actor, sopId);
}

/** Starts a new editable draft cloned from the SOP's current published version. */
export async function createDraftFromCurrentVersion(
  actor: ManagerSessionContext,
  sopId: string,
  requestId?: string,
) {
  const base = await requireManageableSop(actor, sopId);
  if (base.sop.status !== "published" || !base.sop.currentVersionId) {
    throw new AppError("CONFLICT", "Only published SOPs can start a new draft this way.");
  }
  return createDraftFromVersion(actor, sopId, base.sop.currentVersionId, requestId);
}

/** Restores any historical version by cloning it into a new editable draft. */
export async function restoreSopVersion(
  actor: ManagerSessionContext,
  sopId: string,
  versionId: string,
  requestId?: string,
) {
  return createDraftFromVersion(actor, sopId, versionId, requestId);
}

export async function listSopVersions(actor: ManagerSessionContext, sopId: string) {
  const base = await requireManageableSop(actor, sopId);
  const versions = await getDb()
    .select({
      id: sopVersions.id,
      versionNumber: sopVersions.versionNumber,
      status: sopVersions.status,
      title: sopVersions.title,
      changeSummary: sopVersions.changeSummary,
      sourceVersionId: sopVersions.sourceVersionId,
      revision: sopVersions.revision,
      publishedAt: sopVersions.publishedAt,
      createdAt: sopVersions.createdAt,
      updatedAt: sopVersions.updatedAt,
    })
    .from(sopVersions)
    .where(and(eq(sopVersions.sopId, sopId), eq(sopVersions.organizationId, actor.organizationId)))
    .orderBy(desc(sopVersions.versionNumber));
  return { sopId, currentVersionId: base.sop.currentVersionId, versions };
}

/**
 * Paginated version-history report for `/manager/reports/sop-versions`, across every SOP a manager
 * can see rather than one at a time like `listSopVersions`. Same tenant/location scoping as
 * `listSops`, ordered newest-published-first so managers can review what changed recently.
 */
export async function getSopVersionHistoryReport(
  actor: ManagerSessionContext,
  query: SopVersionHistoryReportQuery,
) {
  const empty = { items: [], total: 0, page: query.page, pageSize: query.pageSize };
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return empty;
  if (query.locationId && !managedIds.includes(query.locationId)) return empty;

  const conditions: SQL[] = [
    eq(sops.organizationId, actor.organizationId),
    inArray(sops.locationId, query.locationId ? [query.locationId] : managedIds),
  ];
  if (query.category) conditions.push(eq(sops.category, query.category));
  if (query.status) conditions.push(eq(sopVersions.status, query.status));
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(ilike(sopVersions.title, pattern));
  }

  const db = getDb();
  const base = () =>
    db
      .select({
        id: sopVersions.id,
        sopId: sops.id,
        versionNumber: sopVersions.versionNumber,
        status: sopVersions.status,
        title: sopVersions.title,
        category: sops.category,
        changeSummary: sopVersions.changeSummary,
        publishedAt: sopVersions.publishedAt,
        publishedByManagerUserId: sopVersions.publishedByManagerUserId,
        locationId: sops.locationId,
        locationName: locations.name,
        createdAt: sopVersions.createdAt,
      })
      .from(sopVersions)
      .innerJoin(
        sops,
        and(eq(sops.id, sopVersions.sopId), eq(sops.organizationId, sopVersions.organizationId)),
      )
      .innerJoin(
        locations,
        and(eq(locations.id, sops.locationId), eq(locations.organizationId, sops.organizationId)),
      );

  const [items, totalRows] = await Promise.all([
    base()
      .where(and(...conditions))
      .orderBy(desc(sopVersions.createdAt), desc(sopVersions.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(sopVersions)
      .innerJoin(
        sops,
        and(eq(sops.id, sopVersions.sopId), eq(sops.organizationId, sopVersions.organizationId)),
      )
      .where(and(...conditions)),
  ]);

  return { items, total: totalRows[0]?.count ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getSopVersionDetail(
  actor: ManagerSessionContext,
  sopId: string,
  versionId: string,
) {
  const base = await requireManageableSop(actor, sopId);
  const version = await findVersionById(actor.organizationId, sopId, versionId);
  if (!version) throw new AppError("NOT_FOUND", "Version not found.");
  const detail = await buildSopDetail(actor, { ...base, version });
  const retrainingRule = await loadRetrainingRule(actor.organizationId, version.id);
  return { ...detail, isCurrent: version.id === base.sop.currentVersionId, retrainingRule };
}

/**
 * The permission-aware print/PDF record for `/manager/print/sops/[versionId]` (Phase 15). Unlike
 * `getSopVersionDetail`, the route only carries a version id, so this resolves the owning SOP
 * first and applies the same location authorization; only `published` or `archived` versions are
 * printable since a `draft` is still mutable and was never a finished, immutable record.
 */
export async function getSopVersionForPrint(actor: ManagerSessionContext, versionId: string) {
  const [version] = await getDb()
    .select()
    .from(sopVersions)
    .where(and(eq(sopVersions.id, versionId), eq(sopVersions.organizationId, actor.organizationId)))
    .limit(1);
  if (!version) throw new AppError("NOT_FOUND", "SOP version not found.");
  const base = await requireManageableSop(actor, version.sopId);
  if (version.status === "draft") {
    throw new AppError("CONFLICT", "Only a published version can be printed.");
  }
  return buildSopDetail(actor, { ...base, version });
}

async function loadRetrainingRule(organizationId: string, sopVersionId: string) {
  const [rule] = await getDb()
    .select({ id: sopRetrainingRules.id, ruleType: sopRetrainingRules.ruleType })
    .from(sopRetrainingRules)
    .where(
      and(
        eq(sopRetrainingRules.sopVersionId, sopVersionId),
        eq(sopRetrainingRules.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!rule) return null;
  const [jobRoles, locationRows] = await Promise.all([
    rule.ruleType === "selected_roles"
      ? getDb()
          .select({ jobRole: sopRetrainingRuleRoles.jobRole })
          .from(sopRetrainingRuleRoles)
          .where(eq(sopRetrainingRuleRoles.ruleId, rule.id))
      : Promise.resolve([] as { jobRole: string }[]),
    rule.ruleType === "selected_locations"
      ? getDb()
          .select({
            locationId: sopRetrainingRuleLocations.locationId,
            locationName: locations.name,
          })
          .from(sopRetrainingRuleLocations)
          .innerJoin(
            locations,
            and(
              eq(locations.id, sopRetrainingRuleLocations.locationId),
              eq(locations.organizationId, sopRetrainingRuleLocations.organizationId),
            ),
          )
          .where(eq(sopRetrainingRuleLocations.ruleId, rule.id))
      : Promise.resolve([] as { locationId: string; locationName: string }[]),
  ]);
  return {
    ruleType: rule.ruleType,
    jobRoles: jobRoles.map((row) => row.jobRole),
    locations: locationRows,
  };
}

export interface SopVersionFieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface SopVersionListDiffEntry<T> {
  status: "unchanged" | "changed" | "added" | "removed";
  before: T | null;
  after: T | null;
  changedFields: string[];
}

function diffByPosition<T extends Record<string, unknown>>(
  before: readonly T[],
  after: readonly T[],
  fields: readonly (keyof T)[],
): SopVersionListDiffEntry<T>[] {
  const length = Math.max(before.length, after.length);
  const entries: SopVersionListDiffEntry<T>[] = [];
  for (let index = 0; index < length; index += 1) {
    const beforeRow = before[index] ?? null;
    const afterRow = after[index] ?? null;
    if (beforeRow && !afterRow) {
      entries.push({ status: "removed", before: beforeRow, after: null, changedFields: [] });
      continue;
    }
    if (!beforeRow && afterRow) {
      entries.push({ status: "added", before: null, after: afterRow, changedFields: [] });
      continue;
    }
    if (beforeRow && afterRow) {
      const changedFields = fields.filter((field) => beforeRow[field] !== afterRow[field]);
      entries.push({
        status: changedFields.length > 0 ? "changed" : "unchanged",
        before: beforeRow,
        after: afterRow,
        changedFields: changedFields as string[],
      });
    }
  }
  return entries;
}

const VERSION_FIELD_DIFF_KEYS = [
  "title",
  "description",
  "category",
  "estimatedMinutes",
  "difficulty",
] as const;

const STEP_DIFF_FIELDS = [
  "title",
  "instruction",
  "warning",
  "quantity",
  "unit",
  "equipmentSetting",
  "timerSeconds",
  "isRequired",
  "imageFileId",
  "videoFileId",
] as const;

export async function compareSopVersions(
  actor: ManagerSessionContext,
  sopId: string,
  fromVersionId: string,
  toVersionId: string,
) {
  await requireManageableSop(actor, sopId);
  const [fromVersion, toVersion] = await Promise.all([
    findVersionById(actor.organizationId, sopId, fromVersionId),
    findVersionById(actor.organizationId, sopId, toVersionId),
  ]);
  if (!fromVersion || !toVersion) throw new AppError("NOT_FOUND", "Version not found.");

  const [fromSteps, toSteps, fromMaterials, toMaterials, fromWarnings, toWarnings] =
    await Promise.all([
      getDb()
        .select()
        .from(sopSteps)
        .where(eq(sopSteps.sopVersionId, fromVersion.id))
        .orderBy(asc(sopSteps.displayOrder)),
      getDb()
        .select()
        .from(sopSteps)
        .where(eq(sopSteps.sopVersionId, toVersion.id))
        .orderBy(asc(sopSteps.displayOrder)),
      getDb()
        .select()
        .from(sopMaterials)
        .where(eq(sopMaterials.sopVersionId, fromVersion.id))
        .orderBy(asc(sopMaterials.displayOrder)),
      getDb()
        .select()
        .from(sopMaterials)
        .where(eq(sopMaterials.sopVersionId, toVersion.id))
        .orderBy(asc(sopMaterials.displayOrder)),
      getDb()
        .select()
        .from(sopWarnings)
        .where(eq(sopWarnings.sopVersionId, fromVersion.id))
        .orderBy(asc(sopWarnings.displayOrder)),
      getDb()
        .select()
        .from(sopWarnings)
        .where(eq(sopWarnings.sopVersionId, toVersion.id))
        .orderBy(asc(sopWarnings.displayOrder)),
    ]);

  const fieldDiffs: SopVersionFieldDiff[] = VERSION_FIELD_DIFF_KEYS.filter(
    (field) => fromVersion[field] !== toVersion[field],
  ).map((field) => ({ field, before: fromVersion[field], after: toVersion[field] }));

  return {
    from: {
      id: fromVersion.id,
      versionNumber: fromVersion.versionNumber,
      title: fromVersion.title,
    },
    to: {
      id: toVersion.id,
      versionNumber: toVersion.versionNumber,
      title: toVersion.title,
      changeSummary: toVersion.changeSummary,
    },
    fieldDiffs,
    stepDiffs: diffByPosition(fromSteps, toSteps, STEP_DIFF_FIELDS),
    materialDiffs: diffByPosition(fromMaterials, toMaterials, ["kind", "name", "quantity", "unit"]),
    warningDiffs: diffByPosition(fromWarnings, toWarnings, ["text"]),
  };
}

async function requireEmployeeSop(session: EmployeeSessionContext, sopId: string) {
  const detail = await loadSopDetail(session.organizationId, sopId);
  if (
    !detail ||
    detail.sop.locationId !== session.locationId ||
    detail.sop.status !== "published"
  ) {
    throw new AppError("NOT_FOUND", "That SOP is not available.");
  }
  return detail;
}

/** The current published version of an SOP, scoped to the employee's authenticated location. */
export async function getPublishedSopForEmployee(session: EmployeeSessionContext, sopId: string) {
  const base = await requireEmployeeSop(session, sopId);
  const detail = await buildSopDetail({ organizationId: session.organizationId }, base);
  await getDb()
    .insert(sopRecentViews)
    .values({
      id: randomUUID(),
      employeeId: session.employeeId,
      organizationId: session.organizationId,
      sopId,
    })
    .onConflictDoUpdate({
      target: [sopRecentViews.employeeId, sopRecentViews.sopId],
      set: { lastViewedAt: new Date() },
    });
  await writeAuditEvent({
    organizationId: session.organizationId,
    locationId: session.locationId,
    actorKind: "employee",
    actorId: session.employeeId,
    action: "sop.viewed",
    targetType: "sop",
    targetId: sopId,
  });
  return detail;
}

export async function listPublishedSopsForEmployee(
  session: EmployeeSessionContext,
  query: EmployeeSopQuery,
) {
  const conditions: SQL[] = [
    eq(sops.organizationId, session.organizationId),
    eq(sops.locationId, session.locationId),
    eq(sops.status, "published"),
  ];
  if (query.category) conditions.push(eq(sops.category, query.category));
  if (query.stationId) conditions.push(eq(sops.stationId, query.stationId));
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(
      or(ilike(sopVersions.title, pattern), ilike(sopVersions.description, pattern))!,
    );
  }
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor) {
    conditions.push(
      or(
        lt(sops.updatedAt, cursor.updatedAt),
        and(eq(sops.updatedAt, cursor.updatedAt), lt(sops.id, cursor.id)),
      )!,
    );
  }

  const rows = await getDb()
    .select({
      id: sops.id,
      title: sopVersions.title,
      description: sopVersions.description,
      category: sops.category,
      difficulty: sopVersions.difficulty,
      estimatedMinutes: sopVersions.estimatedMinutes,
      stationId: sops.stationId,
      stationName: stations.name,
      coverImageFileId: sopVersions.coverImageFileId,
      updatedAt: sops.updatedAt,
    })
    .from(sops)
    .innerJoin(
      sopVersions,
      and(
        eq(sopVersions.id, sops.currentVersionId),
        eq(sopVersions.organizationId, sops.organizationId),
      ),
    )
    .leftJoin(
      stations,
      and(eq(stations.id, sops.stationId), eq(stations.organizationId, sops.organizationId)),
    )
    .where(and(...conditions))
    .orderBy(desc(sops.updatedAt), desc(sops.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last.updatedAt, last.id) : null,
  };
}

export async function listRecentSopsForEmployee(session: EmployeeSessionContext, limit = 12) {
  return getDb()
    .select({
      id: sops.id,
      title: sopVersions.title,
      category: sops.category,
      stationId: sops.stationId,
      stationName: stations.name,
      lastViewedAt: sopRecentViews.lastViewedAt,
    })
    .from(sopRecentViews)
    .innerJoin(
      sops,
      and(
        eq(sops.id, sopRecentViews.sopId),
        eq(sops.organizationId, sopRecentViews.organizationId),
      ),
    )
    .innerJoin(
      sopVersions,
      and(
        eq(sopVersions.id, sops.currentVersionId),
        eq(sopVersions.organizationId, sops.organizationId),
      ),
    )
    .leftJoin(
      stations,
      and(eq(stations.id, sops.stationId), eq(stations.organizationId, sops.organizationId)),
    )
    .where(
      and(
        eq(sopRecentViews.employeeId, session.employeeId),
        eq(sops.organizationId, session.organizationId),
        eq(sops.locationId, session.locationId),
        eq(sops.status, "published"),
      ),
    )
    .orderBy(desc(sopRecentViews.lastViewedAt))
    .limit(limit);
}
