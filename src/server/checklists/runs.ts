import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { calendarDateInTimeZone, isoWeekStartInTimeZone } from "@/lib/timezone";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import { requireManagerManagedLocation } from "@/server/auth/authorization";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import type {
  ChecklistItemActionInput,
  ChecklistItemEvidenceUploadFormInput,
  ChecklistItemNoteInput,
  ChecklistRunQuery,
} from "@/server/checklists/schemas";
import { getDb } from "@/server/db/client";
import {
  checklistApprovalSubmissions,
  checklistCorrectionRequests,
  checklistEvidence,
  checklistItemProgress,
  checklistItems,
  checklistRuns,
  checklists,
  employees,
  locations,
} from "@/server/db/schema";
import { getManagedLocationIds } from "@/server/management/service";
import { uploadEmployeeMedia } from "@/server/storage/media-service";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type ChecklistRow = typeof checklists.$inferSelect;
type ChecklistRunRow = typeof checklistRuns.$inferSelect;
type ChecklistItemRow = typeof checklistItems.$inferSelect;
type ChecklistItemProgressRow = typeof checklistItemProgress.$inferSelect;
type ChecklistEvidenceRow = typeof checklistEvidence.$inferSelect;

interface RunComputation {
  run: ChecklistRunRow;
  checklist: ChecklistRow;
  items: ChecklistItemRow[];
  progressByItemId: Map<string, ChecklistItemProgressRow>;
  evidenceByProgressId: Map<string, ChecklistEvidenceRow[]>;
}

function isItemDone(item: ChecklistItemRow, computation: RunComputation): boolean {
  const progress = computation.progressByItemId.get(item.id);
  const evidenceList = progress ? (computation.evidenceByProgressId.get(progress.id) ?? []) : [];
  const hasAutoRequirement = item.timerSeconds !== null || item.requirePhoto || item.requireNote;

  if (item.timerSeconds !== null && !(progress?.timerCompleted ?? false)) return false;
  if (item.requirePhoto && evidenceList.length === 0) return false;
  if (item.requireNote && !(progress?.employeeNote ?? "").trim()) return false;
  if (!hasAutoRequirement) return progress?.status === "completed";
  return true;
}

function computeOccurrenceKey(
  recurrenceType: ChecklistRow["recurrenceType"],
  runId: string,
  now: Date,
  timeZone: string,
): string {
  if (recurrenceType === "daily") return `daily:${calendarDateInTimeZone(now, timeZone)}`;
  if (recurrenceType === "weekly") return `weekly:${isoWeekStartInTimeZone(now, timeZone)}`;
  return `once:${runId}`;
}

async function auditChecklistRun(
  actor: { organizationId: string; locationId: string; actorKind: "employee" | "manager"; actorId: string },
  action:
    | "checklist_run.started"
    | "checklist_run.resumed"
    | "checklist_run.item_progress_recorded"
    | "checklist_run.evidence_submitted"
    | "checklist_run.submitted"
    | "checklist_run.correction_resubmitted",
  runId: string,
  requestId?: string,
): Promise<void> {
  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: actor.locationId,
    actorKind: actor.actorKind,
    actorId: actor.actorId,
    action,
    targetType: "checklist_run",
    targetId: runId,
    requestId,
  });
}

async function loadRunComputation(organizationId: string, runId: string): Promise<RunComputation> {
  const [run] = await getDb()
    .select()
    .from(checklistRuns)
    .where(and(eq(checklistRuns.id, runId), eq(checklistRuns.organizationId, organizationId)))
    .limit(1);
  if (!run) throw new AppError("NOT_FOUND", "Checklist run not found.");

  const [checklist] = await getDb()
    .select()
    .from(checklists)
    .where(and(eq(checklists.id, run.checklistId), eq(checklists.organizationId, organizationId)))
    .limit(1);
  if (!checklist) throw new AppError("NOT_FOUND", "Checklist not found.");

  const progressRows = await getDb()
    .select()
    .from(checklistItemProgress)
    .where(
      and(
        eq(checklistItemProgress.organizationId, organizationId),
        eq(checklistItemProgress.runId, runId),
      ),
    );
  const itemIds = progressRows.map((row) => row.itemId);
  const items = itemIds.length
    ? await getDb()
        .select()
        .from(checklistItems)
        .where(
          and(eq(checklistItems.organizationId, organizationId), inArray(checklistItems.id, itemIds)),
        )
        .orderBy(asc(checklistItems.displayOrder))
    : [];

  const progressByItemId = new Map(progressRows.map((row) => [row.itemId, row]));
  const progressIds = progressRows.map((row) => row.id);
  const evidenceRows = progressIds.length
    ? await getDb()
        .select()
        .from(checklistEvidence)
        .where(
          and(
            eq(checklistEvidence.organizationId, organizationId),
            inArray(checklistEvidence.progressId, progressIds),
          ),
        )
        .orderBy(asc(checklistEvidence.createdAt))
    : [];
  const evidenceByProgressId = new Map<string, ChecklistEvidenceRow[]>();
  for (const row of evidenceRows) {
    const list = evidenceByProgressId.get(row.progressId) ?? [];
    list.push(row);
    evidenceByProgressId.set(row.progressId, list);
  }

  return { run, checklist, items, progressByItemId, evidenceByProgressId };
}

function requireRunOwner(computation: RunComputation, session: EmployeeSessionContext): void {
  if (computation.run.employeeId !== session.employeeId) {
    throw new AppError("NOT_FOUND", "Checklist run not found.");
  }
}

export async function bumpRunRevision(
  tx: Tx,
  organizationId: string,
  runId: string,
  expectedRevision: number,
  extraSet: Record<string, unknown> = {},
): Promise<number> {
  const [row] = await tx
    .update(checklistRuns)
    .set({ ...extraSet, revision: expectedRevision + 1, updatedAt: new Date() })
    .where(
      and(
        eq(checklistRuns.id, runId),
        eq(checklistRuns.organizationId, organizationId),
        eq(checklistRuns.revision, expectedRevision),
      ),
    )
    .returning({ revision: checklistRuns.revision });
  if (!row) {
    throw new AppError("CONFLICT", "This checklist run changed elsewhere. Reload to continue.");
  }
  return row.revision;
}

function serializeRunState(computation: RunComputation) {
  const { run, checklist, items, progressByItemId, evidenceByProgressId } = computation;
  return {
    id: run.id,
    checklistId: checklist.id,
    checklistTitle: checklist.title,
    status: run.status,
    revision: run.revision,
    startedAt: run.startedAt,
    lastResumedAt: run.lastResumedAt,
    submittedAt: run.submittedAt,
    completedAt: run.completedAt,
    items: items.map((item) => {
      const progress = progressByItemId.get(item.id);
      const evidenceList = progress ? (evidenceByProgressId.get(progress.id) ?? []) : [];
      return {
        id: item.id,
        displayOrder: item.displayOrder,
        title: item.title,
        instructions: item.instructions,
        isRequired: item.isRequired,
        timerSeconds: item.timerSeconds,
        requirePhoto: item.requirePhoto,
        requireApproval: item.requireApproval,
        requireNote: item.requireNote,
        referenceFileId: item.referenceFileId,
        status: progress?.status ?? "pending",
        timerCompleted: progress?.timerCompleted ?? false,
        employeeNote: progress?.employeeNote ?? "",
        isDone: isItemDone(item, computation),
        evidence: evidenceList.map((row) => ({
          id: row.id,
          fileId: row.fileId,
          submissionGeneration: row.submissionGeneration,
          employeeNote: row.employeeNote,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    }),
  };
}

async function requireOpenCorrection(organizationId: string, runId: string) {
  const [submission] = await getDb()
    .select()
    .from(checklistApprovalSubmissions)
    .where(
      and(
        eq(checklistApprovalSubmissions.organizationId, organizationId),
        eq(checklistApprovalSubmissions.runId, runId),
      ),
    )
    .orderBy(desc(checklistApprovalSubmissions.submissionGeneration))
    .limit(1);
  if (!submission || submission.status !== "needs_correction") {
    throw new AppError("CONFLICT", "This checklist run is not awaiting a correction.");
  }
  const [correction] = await getDb()
    .select()
    .from(checklistCorrectionRequests)
    .where(
      and(
        eq(checklistCorrectionRequests.organizationId, organizationId),
        eq(checklistCorrectionRequests.submissionId, submission.id),
        isNull(checklistCorrectionRequests.resolvedAt),
      ),
    )
    .orderBy(desc(checklistCorrectionRequests.createdAt))
    .limit(1);
  if (!correction) {
    throw new AppError("CONFLICT", "This checklist run is not awaiting a correction.");
  }
  return { submission, correction };
}

/** Starts a fresh run for the current occurrence, or resumes an already in-progress one. */
export async function startOrResumeRun(
  session: EmployeeSessionContext,
  checklistId: string,
  requestId?: string,
) {
  const [checklist] = await getDb()
    .select()
    .from(checklists)
    .where(
      and(
        eq(checklists.id, checklistId),
        eq(checklists.organizationId, session.organizationId),
        eq(checklists.locationId, session.locationId),
        eq(checklists.status, "active"),
      ),
    )
    .limit(1);
  if (!checklist) throw new AppError("NOT_FOUND", "Checklist not found.");

  const existingActive = await getDb()
    .select({ id: checklistRuns.id, status: checklistRuns.status })
    .from(checklistRuns)
    .where(
      and(
        eq(checklistRuns.organizationId, session.organizationId),
        eq(checklistRuns.checklistId, checklistId),
        eq(checklistRuns.employeeId, session.employeeId),
      ),
    )
    .orderBy(desc(checklistRuns.startedAt))
    .limit(1);
  const latest = existingActive[0];

  if (latest?.status === "in_progress") {
    await getDb()
      .update(checklistRuns)
      .set({ lastResumedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(checklistRuns.id, latest.id), eq(checklistRuns.organizationId, session.organizationId)),
      );
    await auditChecklistRun(
      { organizationId: session.organizationId, locationId: session.locationId, actorKind: "employee", actorId: session.employeeId },
      "checklist_run.resumed",
      latest.id,
      requestId,
    );
    return getChecklistRunState(session, latest.id);
  }
  if (latest?.status === "awaiting_approval") {
    throw new AppError("CONFLICT", "This checklist is already awaiting manager review.");
  }
  if (latest?.status === "submitted") {
    throw new AppError("CONFLICT", "This checklist has already been completed for this period.");
  }

  const [location] = await getDb()
    .select({ timezone: locations.timezone })
    .from(locations)
    .where(and(eq(locations.id, session.locationId), eq(locations.organizationId, session.organizationId)))
    .limit(1);
  if (!location) throw new AppError("NOT_FOUND", "Location not found.");

  const items = await getDb()
    .select()
    .from(checklistItems)
    .where(
      and(
        eq(checklistItems.organizationId, session.organizationId),
        eq(checklistItems.checklistId, checklistId),
        eq(checklistItems.status, "active"),
      ),
    )
    .orderBy(asc(checklistItems.displayOrder));
  if (items.length === 0) {
    throw new AppError("BAD_REQUEST", "This checklist has no active items.");
  }

  const runId = randomUUID();
  const now = new Date();
  const occurrenceKey = computeOccurrenceKey(checklist.recurrenceType, runId, now, location.timezone);

  try {
    await getDb().transaction(async (tx) => {
      await tx.insert(checklistRuns).values({
        id: runId,
        organizationId: session.organizationId,
        locationId: session.locationId,
        checklistId,
        employeeId: session.employeeId,
        occurrenceKey,
        status: "in_progress",
        startedAt: now,
        lastResumedAt: now,
      });
      await tx.insert(checklistItemProgress).values(
        items.map((item) => ({
          id: randomUUID(),
          organizationId: session.organizationId,
          runId,
          itemId: item.id,
        })),
      );
    });
  } catch (error: unknown) {
    const code =
      error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "23505") {
      throw new AppError("CONFLICT", "This checklist has already been started for this period.");
    }
    throw error;
  }

  await auditChecklistRun(
    { organizationId: session.organizationId, locationId: session.locationId, actorKind: "employee", actorId: session.employeeId },
    "checklist_run.started",
    runId,
    requestId,
  );
  return getChecklistRunState(session, runId);
}

export async function getChecklistRunState(session: EmployeeSessionContext, runId: string) {
  const computation = await loadRunComputation(session.organizationId, runId);
  requireRunOwner(computation, session);
  return serializeRunState(computation);
}

function requireRunInProgress(computation: RunComputation): void {
  if (computation.run.status !== "in_progress") {
    throw new AppError("CONFLICT", "This checklist run is no longer in progress.");
  }
}

export async function recordItemAction(
  session: EmployeeSessionContext,
  runId: string,
  itemId: string,
  input: ChecklistItemActionInput,
  requestId?: string,
) {
  const computation = await loadRunComputation(session.organizationId, runId);
  requireRunOwner(computation, session);
  requireRunInProgress(computation);

  const item = computation.items.find((row) => row.id === itemId);
  if (!item) throw new AppError("NOT_FOUND", "Checklist item not found.");

  if (input.action === "timer_completed") {
    if (item.timerSeconds === null) {
      throw new AppError("BAD_REQUEST", "This item has no timer.");
    }
  } else {
    const hasAutoRequirement = item.timerSeconds !== null || item.requirePhoto || item.requireNote;
    if (hasAutoRequirement) {
      throw new AppError(
        "BAD_REQUEST",
        "This item completes automatically once its requirements are met.",
      );
    }
  }

  const now = new Date();
  await getDb().transaction(async (tx) => {
    await bumpRunRevision(tx, session.organizationId, runId, input.expectedRevision);
    const existing = computation.progressByItemId.get(itemId);
    const patch: Record<string, unknown> = { updatedAt: now };
    if (input.action === "timer_completed") patch["timerCompleted"] = true;
    if (input.action === "ticked") patch["status"] = "completed";
    if (input.action === "unticked") patch["status"] = "pending";

    await tx
      .insert(checklistItemProgress)
      .values({
        id: existing?.id ?? randomUUID(),
        organizationId: session.organizationId,
        runId,
        itemId,
        status: input.action === "ticked" ? "completed" : "pending",
        timerCompleted: input.action === "timer_completed",
        startedAt: existing?.startedAt ?? now,
        completedAt: input.action === "ticked" ? now : (existing?.completedAt ?? null),
      })
      .onConflictDoUpdate({
        target: [checklistItemProgress.runId, checklistItemProgress.itemId],
        set: {
          ...patch,
          completedAt: input.action === "ticked" ? now : (existing?.completedAt ?? null),
        },
      });
  });

  await auditChecklistRun(
    { organizationId: session.organizationId, locationId: session.locationId, actorKind: "employee", actorId: session.employeeId },
    "checklist_run.item_progress_recorded",
    runId,
    requestId,
  );
  return getChecklistRunState(session, runId);
}

export async function saveItemNote(
  session: EmployeeSessionContext,
  runId: string,
  itemId: string,
  input: ChecklistItemNoteInput,
  requestId?: string,
) {
  const computation = await loadRunComputation(session.organizationId, runId);
  requireRunOwner(computation, session);
  requireRunInProgress(computation);

  const item = computation.items.find((row) => row.id === itemId);
  if (!item) throw new AppError("NOT_FOUND", "Checklist item not found.");

  const now = new Date();
  await getDb().transaction(async (tx) => {
    await bumpRunRevision(tx, session.organizationId, runId, input.expectedRevision);
    const existing = computation.progressByItemId.get(itemId);
    await tx
      .insert(checklistItemProgress)
      .values({
        id: existing?.id ?? randomUUID(),
        organizationId: session.organizationId,
        runId,
        itemId,
        employeeNote: input.employeeNote,
        startedAt: existing?.startedAt ?? now,
      })
      .onConflictDoUpdate({
        target: [checklistItemProgress.runId, checklistItemProgress.itemId],
        set: { employeeNote: input.employeeNote, updatedAt: now },
      });
  });

  await auditChecklistRun(
    { organizationId: session.organizationId, locationId: session.locationId, actorKind: "employee", actorId: session.employeeId },
    "checklist_run.item_progress_recorded",
    runId,
    requestId,
  );
  return getChecklistRunState(session, runId);
}

/**
 * Uploads photo evidence for an item. While the run is `in_progress` this is ordinary progress.
 * While it is `awaiting_approval` with an open correction on its latest submission, the same
 * upload instead resolves the correction and opens the next approval submission generation —
 * mirroring training's evidence-only correction resubmission exactly, scoped here to the item the
 * upload targets.
 */
export async function submitItemEvidence(
  session: EmployeeSessionContext,
  runId: string,
  itemId: string,
  formData: FormData,
  input: ChecklistItemEvidenceUploadFormInput,
  requestId?: string,
) {
  const computation = await loadRunComputation(session.organizationId, runId);
  requireRunOwner(computation, session);

  const item = computation.items.find((row) => row.id === itemId);
  if (!item) throw new AppError("NOT_FOUND", "Checklist item not found.");
  if (!item.requirePhoto) throw new AppError("BAD_REQUEST", "This item does not require a photo.");

  if (computation.run.status === "in_progress") {
    const uploaded = await uploadEmployeeMedia(session, formData, requestId);
    if (uploaded.mediaType !== "image") {
      throw new AppError("BAD_REQUEST", "This item accepts only photo evidence.");
    }
    const existingProgress = computation.progressByItemId.get(itemId);
    const existingEvidence = existingProgress
      ? (computation.evidenceByProgressId.get(existingProgress.id) ?? [])
      : [];
    const submissionGeneration =
      existingEvidence.reduce((max, row) => Math.max(max, row.submissionGeneration), 0) + 1;
    const now = new Date();

    await getDb().transaction(async (tx) => {
      await bumpRunRevision(tx, session.organizationId, runId, input.expectedRevision);
      const progressId = existingProgress?.id ?? randomUUID();
      await tx
        .insert(checklistItemProgress)
        .values({
          id: progressId,
          organizationId: session.organizationId,
          runId,
          itemId,
          startedAt: existingProgress?.startedAt ?? now,
        })
        .onConflictDoUpdate({
          target: [checklistItemProgress.runId, checklistItemProgress.itemId],
          set: { updatedAt: now },
        });
      await tx.insert(checklistEvidence).values({
        id: randomUUID(),
        organizationId: session.organizationId,
        progressId,
        fileId: uploaded.id,
        evidenceType: "photo",
        submissionGeneration,
        employeeNote: input.employeeNote,
      });
    });

    await auditChecklistRun(
      { organizationId: session.organizationId, locationId: session.locationId, actorKind: "employee", actorId: session.employeeId },
      "checklist_run.evidence_submitted",
      runId,
      requestId,
    );
    return getChecklistRunState(session, runId);
  }

  if (computation.run.status === "awaiting_approval") {
    const { correction } = await requireOpenCorrection(session.organizationId, runId);
    const uploaded = await uploadEmployeeMedia(session, formData, requestId);
    if (uploaded.mediaType !== "image") {
      throw new AppError("BAD_REQUEST", "This item accepts only photo evidence.");
    }
    const existingProgress = computation.progressByItemId.get(itemId);
    const existingEvidence = existingProgress
      ? (computation.evidenceByProgressId.get(existingProgress.id) ?? [])
      : [];
    const submissionGeneration =
      existingEvidence.reduce((max, row) => Math.max(max, row.submissionGeneration), 0) + 1;
    const replacementSubmissionId = randomUUID();
    const now = new Date();

    await getDb().transaction(async (tx) => {
      await bumpRunRevision(tx, session.organizationId, runId, input.expectedRevision);
      const progressId = existingProgress?.id ?? randomUUID();
      await tx
        .insert(checklistItemProgress)
        .values({
          id: progressId,
          organizationId: session.organizationId,
          runId,
          itemId,
          startedAt: existingProgress?.startedAt ?? now,
        })
        .onConflictDoUpdate({
          target: [checklistItemProgress.runId, checklistItemProgress.itemId],
          set: { updatedAt: now },
        });
      await tx.insert(checklistEvidence).values({
        id: randomUUID(),
        organizationId: session.organizationId,
        progressId,
        fileId: uploaded.id,
        evidenceType: "photo",
        submissionGeneration,
        employeeNote: input.employeeNote,
      });
      await tx.insert(checklistApprovalSubmissions).values({
        id: replacementSubmissionId,
        organizationId: session.organizationId,
        runId,
        submissionGeneration: correction.replacementGeneration,
        status: "pending",
        submittedAt: now,
      });
      const [resolved] = await tx
        .update(checklistCorrectionRequests)
        .set({ resolvedAt: now, resolvedSubmissionId: replacementSubmissionId })
        .where(
          and(
            eq(checklistCorrectionRequests.id, correction.id),
            eq(checklistCorrectionRequests.organizationId, session.organizationId),
            isNull(checklistCorrectionRequests.resolvedAt),
          ),
        )
        .returning({ id: checklistCorrectionRequests.id });
      if (!resolved) {
        throw new AppError("CONFLICT", "This correction has already been resubmitted.");
      }
    });

    await auditChecklistRun(
      { organizationId: session.organizationId, locationId: session.locationId, actorKind: "employee", actorId: session.employeeId },
      "checklist_run.correction_resubmitted",
      runId,
      requestId,
    );
    return getChecklistRunState(session, runId);
  }

  throw new AppError("CONFLICT", "This checklist run is no longer accepting changes.");
}

/** Finalizes a run once every required item is done, routing to manager approval when needed. */
export async function submitChecklistRun(
  session: EmployeeSessionContext,
  runId: string,
  expectedRevision: number,
  requestId?: string,
) {
  const computation = await loadRunComputation(session.organizationId, runId);
  requireRunOwner(computation, session);

  if (computation.run.status !== "in_progress") {
    return getChecklistRunState(session, runId);
  }

  const requiredIncomplete = computation.items.filter(
    (item) => item.isRequired && !isItemDone(item, computation),
  );
  if (requiredIncomplete.length > 0) {
    throw new AppError("BAD_REQUEST", "Complete all required items before submitting.");
  }

  const needsApproval = computation.items.some(
    (item) => item.requireApproval && isItemDone(item, computation),
  );
  const now = new Date();

  await getDb().transaction(async (tx) => {
    if (needsApproval) {
      await bumpRunRevision(tx, session.organizationId, runId, expectedRevision, {
        status: "awaiting_approval",
        submittedAt: now,
      });
      await tx.insert(checklistApprovalSubmissions).values({
        id: randomUUID(),
        organizationId: session.organizationId,
        runId,
        submissionGeneration: 1,
        status: "pending",
        submittedAt: now,
      });
    } else {
      await bumpRunRevision(tx, session.organizationId, runId, expectedRevision, {
        status: "submitted",
        submittedAt: now,
        completedAt: now,
      });
    }
  });

  await auditChecklistRun(
    { organizationId: session.organizationId, locationId: session.locationId, actorKind: "employee", actorId: session.employeeId },
    "checklist_run.submitted",
    runId,
    requestId,
  );
  return getChecklistRunState(session, runId);
}

export async function listChecklistsForEmployeeWithActiveRun(session: EmployeeSessionContext) {
  const activeRuns = await getDb()
    .select({
      checklistId: checklistRuns.checklistId,
      runId: checklistRuns.id,
      status: checklistRuns.status,
    })
    .from(checklistRuns)
    .where(
      and(
        eq(checklistRuns.organizationId, session.organizationId),
        eq(checklistRuns.employeeId, session.employeeId),
        inArray(checklistRuns.status, ["in_progress", "awaiting_approval"]),
      ),
    );
  return new Map(activeRuns.map((row) => [row.checklistId, row]));
}

/** Manager-facing run list: active, incomplete (in_progress), awaiting approval, completed, rejected. */
export async function listChecklistRuns(actor: ManagerSessionContext, query: ChecklistRunQuery) {
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return [];
  if (query.locationId && !managedIds.includes(query.locationId)) return [];

  const conditions = [
    eq(checklistRuns.organizationId, actor.organizationId),
    inArray(checklistRuns.locationId, query.locationId ? [query.locationId] : managedIds),
  ];
  if (query.status) conditions.push(eq(checklistRuns.status, query.status));

  return getDb()
    .select({
      id: checklistRuns.id,
      status: checklistRuns.status,
      startedAt: checklistRuns.startedAt,
      submittedAt: checklistRuns.submittedAt,
      completedAt: checklistRuns.completedAt,
      checklistId: checklistRuns.checklistId,
      checklistTitle: checklists.title,
      checklistType: checklists.type,
      employeeId: checklistRuns.employeeId,
      employeeName: employees.displayName,
      locationId: checklistRuns.locationId,
      locationName: locations.name,
    })
    .from(checklistRuns)
    .innerJoin(
      checklists,
      and(eq(checklists.id, checklistRuns.checklistId), eq(checklists.organizationId, checklistRuns.organizationId)),
    )
    .innerJoin(
      employees,
      and(eq(employees.id, checklistRuns.employeeId), eq(employees.organizationId, checklistRuns.organizationId)),
    )
    .innerJoin(
      locations,
      and(eq(locations.id, checklistRuns.locationId), eq(locations.organizationId, checklistRuns.organizationId)),
    )
    .where(and(...conditions))
    .orderBy(desc(checklistRuns.updatedAt))
    .limit(300);
}

/** Full manager review context for one run: items, evidence, and the approval/correction history. */
export async function getChecklistRunDetail(actor: ManagerSessionContext, runId: string) {
  const computation = await loadRunComputation(actor.organizationId, runId);
  await requireManagerManagedLocation(actor, computation.run.locationId);

  const [context] = await getDb()
    .select({
      employeeId: employees.id,
      employeeName: employees.displayName,
      employeeNumber: employees.employeeNumber,
      locationId: locations.id,
      locationName: locations.name,
    })
    .from(checklistRuns)
    .innerJoin(
      employees,
      and(eq(employees.id, checklistRuns.employeeId), eq(employees.organizationId, checklistRuns.organizationId)),
    )
    .innerJoin(
      locations,
      and(eq(locations.id, checklistRuns.locationId), eq(locations.organizationId, checklistRuns.organizationId)),
    )
    .where(eq(checklistRuns.id, runId))
    .limit(1);

  const submissions = await getDb()
    .select()
    .from(checklistApprovalSubmissions)
    .where(
      and(
        eq(checklistApprovalSubmissions.organizationId, actor.organizationId),
        eq(checklistApprovalSubmissions.runId, runId),
      ),
    )
    .orderBy(asc(checklistApprovalSubmissions.submissionGeneration));
  const latestSubmission = submissions.at(-1) ?? null;

  return {
    ...serializeRunState(computation),
    employeeId: context?.employeeId ?? null,
    employeeName: context?.employeeName ?? "",
    employeeNumber: context?.employeeNumber ?? "",
    locationId: context?.locationId ?? computation.run.locationId,
    locationName: context?.locationName ?? "",
    checklistType: computation.checklist.type,
    submission: latestSubmission
      ? {
          id: latestSubmission.id,
          status: latestSubmission.status,
          submissionGeneration: latestSubmission.submissionGeneration,
          submittedAt: latestSubmission.submittedAt,
          isDecidable: latestSubmission.status === "pending",
        }
      : null,
    submissions: submissions.map((row) => ({
      id: row.id,
      submissionGeneration: row.submissionGeneration,
      status: row.status,
      submittedAt: row.submittedAt,
    })),
  };
}
