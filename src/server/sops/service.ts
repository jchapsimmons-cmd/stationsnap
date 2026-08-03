import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import { requireManagerManagedLocation } from "@/server/auth/authorization";
import type { ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import {
  files,
  locations,
  sopMaterials,
  sops,
  sopSteps,
  sopVersions,
  sopWarnings,
  stations,
} from "@/server/db/schema";
import { getManagedLocationIds, requireActiveManagedLocation } from "@/server/management/service";
import type {
  SopCreateInput,
  SopDraftUpdateInput,
  SopQuery,
  SopStepCreateInput,
  SopStepUpdateInput,
} from "@/server/sops/schemas";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function auditSop(
  actor: ManagerSessionContext,
  action:
    | "sop.created"
    | "sop.updated"
    | "sop.step_deleted"
    | "sop.archived"
    | "sop.previewed"
    | "sop.published",
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

async function requireDraftForEdit(actor: ManagerSessionContext, sopId: string) {
  const detail = await requireManageableSop(actor, sopId);
  if (detail.version.status !== "draft") {
    throw new AppError(
      "CONFLICT",
      "Published SOPs are read-only in this phase. Archive and create a new SOP to make changes.",
    );
  }
  return detail;
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

export async function getSop(actor: ManagerSessionContext, sopId: string) {
  const detail = await requireManageableSop(actor, sopId);
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
  return getSop(actor, sopId);
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
  return getSop(actor, sopId);
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
  return getSop(actor, sopId);
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
  return getSop(actor, sopId);
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
  return getSop(actor, sopId);
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
  return getSop(actor, sopId);
}

export async function previewSop(actor: ManagerSessionContext, sopId: string, requestId?: string) {
  const detail = await getSop(actor, sopId);
  await auditSop(actor, "sop.previewed", sopId, detail.locationId, requestId);
  return detail;
}

export interface SopPublishIssue {
  code: string;
  message: string;
}

async function evaluatePublishReadiness(
  organizationId: string,
  detail: NonNullable<Awaited<ReturnType<typeof loadSopDetail>>>,
): Promise<SopPublishIssue[]> {
  const issues: SopPublishIssue[] = [];
  if (!detail.version.title.trim()) {
    issues.push({ code: "title", message: "The SOP needs a title." });
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

  return issues;
}

export async function getPublishReadiness(actor: ManagerSessionContext, sopId: string) {
  const detail = await requireManageableSop(actor, sopId);
  const issues =
    detail.version.status === "draft"
      ? await evaluatePublishReadiness(actor.organizationId, detail)
      : [];
  return {
    sopId,
    status: detail.version.status,
    revision: detail.version.revision,
    canPublish: detail.version.status === "draft" && issues.length === 0,
    issues,
  };
}

export async function publishSop(
  actor: ManagerSessionContext,
  sopId: string,
  expectedRevision: number | undefined,
  requestId?: string,
) {
  const detail = await requireManageableSop(actor, sopId);
  if (detail.version.status !== "draft") {
    throw new AppError("CONFLICT", "This SOP is not a draft.");
  }
  if (expectedRevision !== undefined && expectedRevision !== detail.version.revision) {
    throw new AppError("CONFLICT", "This SOP draft changed elsewhere. Reload to continue.", {
      details: { currentRevision: detail.version.revision },
    });
  }

  const issues = await evaluatePublishReadiness(actor.organizationId, detail);
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
        revision: detail.version.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sopVersions.id, detail.version.id),
          eq(sopVersions.organizationId, actor.organizationId),
          eq(sopVersions.revision, detail.version.revision),
          eq(sopVersions.status, "draft"),
        ),
      )
      .returning({ id: sopVersions.id });
    if (!row) {
      throw new AppError("CONFLICT", "This SOP draft changed elsewhere. Reload to continue.");
    }
    await tx
      .update(sops)
      .set({ status: "published", updatedAt: new Date() })
      .where(eq(sops.id, sopId));
  });

  await auditSop(actor, "sop.published", sopId, detail.sop.locationId, requestId);
  return getSop(actor, sopId);
}

export async function archiveSop(actor: ManagerSessionContext, sopId: string, requestId?: string) {
  const detail = await requireManageableSop(actor, sopId);
  if (detail.sop.status === "archived") {
    throw new AppError("CONFLICT", "This SOP is already archived.");
  }
  await getDb().transaction(async (tx) => {
    await tx
      .update(sops)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(sops.id, sopId));
    await tx
      .update(sopVersions)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(sopVersions.id, detail.version.id));
  });
  await auditSop(actor, "sop.archived", sopId, detail.sop.locationId, requestId);
  return getSop(actor, sopId);
}
