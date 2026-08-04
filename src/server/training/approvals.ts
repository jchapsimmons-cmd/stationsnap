import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import { requireManagerManagedLocation } from "@/server/auth/authorization";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import { writeDomainEvent } from "@/server/events";
import {
  approvalDecisions,
  approvalSubmissions,
  correctionRequests,
  employees,
  locations,
  managerUsers,
  sopVersions,
  trainingAssignments,
  trainingEvidence,
  trainingSessions,
} from "@/server/db/schema";
import { getManagedLocationIds } from "@/server/management/service";
import { loadTrainingConfig } from "@/server/sops/service";
import { uploadEmployeeMedia } from "@/server/storage/media-service";
import {
  evaluateAndAwardQualifications,
  type QualificationAwardOutcome,
} from "@/server/training/qualifications";
import type {
  ApprovalDecisionInput,
  ApprovalQueueQuery,
  ApprovalResubmitFormInput,
} from "@/server/training/schemas";
import { bumpSessionRevision, loadSessionComputation } from "@/server/training/service";

type ApprovalSubmissionRow = typeof approvalSubmissions.$inferSelect;
type TrainingSessionRow = typeof trainingSessions.$inferSelect;
type TrainingAssignmentRow = typeof trainingAssignments.$inferSelect;

interface SubmissionContext {
  submission: ApprovalSubmissionRow;
  session: TrainingSessionRow;
  assignment: TrainingAssignmentRow;
}

/**
 * Loads a submission with the session and assignment it belongs to, always constrained to the
 * caller's organization. Location authorization is applied by the caller, because the manager
 * and employee sides answer that question differently.
 */
async function loadSubmissionContext(
  organizationId: string,
  submissionId: string,
): Promise<SubmissionContext> {
  const [row] = await getDb()
    .select({
      submission: approvalSubmissions,
      session: trainingSessions,
      assignment: trainingAssignments,
    })
    .from(approvalSubmissions)
    .innerJoin(
      trainingSessions,
      and(
        eq(trainingSessions.id, approvalSubmissions.sessionId),
        eq(trainingSessions.organizationId, approvalSubmissions.organizationId),
      ),
    )
    .innerJoin(
      trainingAssignments,
      and(
        eq(trainingAssignments.id, trainingSessions.assignmentId),
        eq(trainingAssignments.organizationId, trainingSessions.organizationId),
      ),
    )
    .where(
      and(
        eq(approvalSubmissions.id, submissionId),
        eq(approvalSubmissions.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Approval submission not found.");
  return row;
}

/** Every decision ever recorded for a session, across all of its submission generations. */
async function loadSessionDecisionHistory(organizationId: string, sessionId: string) {
  return getDb()
    .select({
      id: approvalDecisions.id,
      submissionId: approvalDecisions.submissionId,
      submissionGeneration: approvalSubmissions.submissionGeneration,
      decision: approvalDecisions.decision,
      note: approvalDecisions.note,
      decidedAt: approvalDecisions.decidedAt,
      decidedByManagerUserId: approvalDecisions.decidedByManagerUserId,
      decidedByName: managerUsers.displayName,
    })
    .from(approvalDecisions)
    .innerJoin(
      approvalSubmissions,
      and(
        eq(approvalSubmissions.id, approvalDecisions.submissionId),
        eq(approvalSubmissions.organizationId, approvalDecisions.organizationId),
      ),
    )
    .innerJoin(managerUsers, eq(managerUsers.id, approvalDecisions.decidedByManagerUserId))
    .where(
      and(
        eq(approvalDecisions.organizationId, organizationId),
        eq(approvalSubmissions.sessionId, sessionId),
      ),
    )
    .orderBy(asc(approvalDecisions.decidedAt));
}

/** Every correction round ever opened for a session, resolved or still open. */
async function loadSessionCorrectionHistory(organizationId: string, sessionId: string) {
  return getDb()
    .select({
      id: correctionRequests.id,
      submissionId: correctionRequests.submissionId,
      submissionGeneration: approvalSubmissions.submissionGeneration,
      decisionId: correctionRequests.decisionId,
      managerNote: approvalDecisions.note,
      replacementGeneration: correctionRequests.replacementGeneration,
      requestedAt: correctionRequests.createdAt,
      resolvedAt: correctionRequests.resolvedAt,
      resolvedSubmissionId: correctionRequests.resolvedSubmissionId,
    })
    .from(correctionRequests)
    .innerJoin(
      approvalSubmissions,
      and(
        eq(approvalSubmissions.id, correctionRequests.submissionId),
        eq(approvalSubmissions.organizationId, correctionRequests.organizationId),
      ),
    )
    .innerJoin(
      approvalDecisions,
      and(
        eq(approvalDecisions.id, correctionRequests.decisionId),
        eq(approvalDecisions.organizationId, correctionRequests.organizationId),
      ),
    )
    .where(
      and(
        eq(correctionRequests.organizationId, organizationId),
        eq(approvalSubmissions.sessionId, sessionId),
      ),
    )
    .orderBy(asc(correctionRequests.createdAt));
}

/**
 * The approval queue for a manager's permitted locations (owners see the whole organization),
 * scoped exactly like `listAssignments`: through the assignment's own location, never through a
 * client-supplied identifier.
 */
export async function listApprovalQueue(actor: ManagerSessionContext, query: ApprovalQueueQuery) {
  const managedIds = await getManagedLocationIds(actor);
  if (managedIds.length === 0) return [];
  if (query.locationId && !managedIds.includes(query.locationId)) return [];

  const conditions = [
    eq(approvalSubmissions.organizationId, actor.organizationId),
    inArray(trainingAssignments.locationId, query.locationId ? [query.locationId] : managedIds),
  ];
  if (query.status) conditions.push(eq(approvalSubmissions.status, query.status));

  return getDb()
    .select({
      id: approvalSubmissions.id,
      status: approvalSubmissions.status,
      submissionGeneration: approvalSubmissions.submissionGeneration,
      submittedAt: approvalSubmissions.submittedAt,
      sessionId: approvalSubmissions.sessionId,
      attemptNumber: trainingSessions.attemptNumber,
      scorePercent: trainingSessions.scorePercent,
      mode: trainingSessions.mode,
      assignmentId: trainingAssignments.id,
      employeeId: trainingAssignments.employeeId,
      employeeName: employees.displayName,
      locationId: trainingAssignments.locationId,
      locationName: locations.name,
      sopId: sopVersions.sopId,
      sopVersionId: sopVersions.id,
      sopTitle: sopVersions.title,
      sopVersionNumber: sopVersions.versionNumber,
    })
    .from(approvalSubmissions)
    .innerJoin(
      trainingSessions,
      and(
        eq(trainingSessions.id, approvalSubmissions.sessionId),
        eq(trainingSessions.organizationId, approvalSubmissions.organizationId),
      ),
    )
    .innerJoin(
      trainingAssignments,
      and(
        eq(trainingAssignments.id, trainingSessions.assignmentId),
        eq(trainingAssignments.organizationId, trainingSessions.organizationId),
      ),
    )
    .innerJoin(
      employees,
      and(
        eq(employees.id, trainingAssignments.employeeId),
        eq(employees.organizationId, trainingAssignments.organizationId),
      ),
    )
    .innerJoin(
      locations,
      and(
        eq(locations.id, trainingAssignments.locationId),
        eq(locations.organizationId, trainingAssignments.organizationId),
      ),
    )
    .innerJoin(
      sopVersions,
      and(
        eq(sopVersions.id, trainingAssignments.sopVersionId),
        eq(sopVersions.organizationId, trainingAssignments.organizationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(approvalSubmissions.submittedAt))
    .limit(300);
}

/**
 * Full review context for one submission: every evidence generation the session ever produced,
 * the graded quiz summary, the employee/location/SOP context, and the permanent decision and
 * correction history for the session.
 */
export async function getApprovalSubmissionDetail(
  actor: ManagerSessionContext,
  submissionId: string,
) {
  const context = await loadSubmissionContext(actor.organizationId, submissionId);
  await requireManagerManagedLocation(actor, context.assignment.locationId);

  const [contextRow] = await getDb()
    .select({
      employeeId: employees.id,
      employeeName: employees.displayName,
      employeeNumber: employees.employeeNumber,
      locationId: locations.id,
      locationName: locations.name,
      sopId: sopVersions.sopId,
      sopVersionId: sopVersions.id,
      sopTitle: sopVersions.title,
      sopVersionNumber: sopVersions.versionNumber,
    })
    .from(trainingAssignments)
    .innerJoin(
      employees,
      and(
        eq(employees.id, trainingAssignments.employeeId),
        eq(employees.organizationId, trainingAssignments.organizationId),
      ),
    )
    .innerJoin(
      locations,
      and(
        eq(locations.id, trainingAssignments.locationId),
        eq(locations.organizationId, trainingAssignments.organizationId),
      ),
    )
    .innerJoin(
      sopVersions,
      and(
        eq(sopVersions.id, trainingAssignments.sopVersionId),
        eq(sopVersions.organizationId, trainingAssignments.organizationId),
      ),
    )
    .where(eq(trainingAssignments.id, context.assignment.id))
    .limit(1);
  if (!contextRow) throw new AppError("NOT_FOUND", "Approval submission not found.");

  const computation = await loadSessionComputation(actor.organizationId, context.session.id);
  const stepTitleById = new Map(
    computation.steps.map(({ step }) => [
      step.id,
      { title: step.title, displayOrder: step.displayOrder },
    ]),
  );

  const evidenceRows = await getDb()
    .select()
    .from(trainingEvidence)
    .where(
      and(
        eq(trainingEvidence.organizationId, actor.organizationId),
        eq(trainingEvidence.sessionId, context.session.id),
      ),
    )
    .orderBy(asc(trainingEvidence.createdAt));

  const answeredQuestions = [...computation.answersByQuestionId.values()];
  const [submissions, decisions, corrections] = await Promise.all([
    getDb()
      .select()
      .from(approvalSubmissions)
      .where(
        and(
          eq(approvalSubmissions.organizationId, actor.organizationId),
          eq(approvalSubmissions.sessionId, context.session.id),
        ),
      )
      .orderBy(asc(approvalSubmissions.submissionGeneration)),
    loadSessionDecisionHistory(actor.organizationId, context.session.id),
    loadSessionCorrectionHistory(actor.organizationId, context.session.id),
  ]);

  return {
    submission: {
      id: context.submission.id,
      status: context.submission.status,
      submissionGeneration: context.submission.submissionGeneration,
      submittedAt: context.submission.submittedAt,
      isDecidable: context.submission.status === "pending",
    },
    session: {
      id: context.session.id,
      attemptNumber: context.session.attemptNumber,
      status: context.session.status,
      mode: context.session.mode,
      scorePercent: context.session.scorePercent,
      submittedAt: context.session.submittedAt,
    },
    assignment: {
      id: context.assignment.id,
      status: context.assignment.status,
      requiredMode: context.assignment.requiredMode,
    },
    ...contextRow,
    passingScorePercent: computation.config.passingScorePercent,
    quiz: {
      totalQuestions: computation.questions.length,
      answeredQuestions: answeredQuestions.length,
      correctAnswers: answeredQuestions.filter((answer) => answer.isCorrect).length,
    },
    evidence: evidenceRows.map((row) => ({
      id: row.id,
      stepId: row.stepId,
      stepTitle: row.stepId ? (stepTitleById.get(row.stepId)?.title ?? null) : null,
      stepDisplayOrder: row.stepId ? (stepTitleById.get(row.stepId)?.displayOrder ?? null) : null,
      fileId: row.fileId,
      evidenceType: row.evidenceType,
      submissionGeneration: row.submissionGeneration,
      employeeNote: row.employeeNote,
      createdAt: row.createdAt,
    })),
    submissions: submissions.map((row) => ({
      id: row.id,
      submissionGeneration: row.submissionGeneration,
      status: row.status,
      submittedAt: row.submittedAt,
    })),
    decisions,
    corrections,
  };
}

/**
 * Records one immutable decision for a pending submission and applies its consequences in a
 * single transaction. A submission that already carries a decision is rejected rather than
 * re-decided, so history can never be overwritten.
 */
export async function decideApprovalSubmission(
  actor: ManagerSessionContext,
  submissionId: string,
  input: ApprovalDecisionInput,
  requestId?: string,
) {
  const context = await loadSubmissionContext(actor.organizationId, submissionId);
  await requireManagerManagedLocation(actor, context.assignment.locationId, requestId);
  if (context.submission.status !== "pending") {
    throw new AppError("CONFLICT", "This submission has already been decided.");
  }

  const config = await loadTrainingConfig(actor.organizationId, context.assignment.sopVersionId);
  const attemptsRemaining = context.session.attemptNumber < config.maxAttempts;
  const now = new Date();
  let awardOutcomes: QualificationAwardOutcome[] = [];

  const decisionId = randomUUID();
  await getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .update(approvalSubmissions)
      .set({ status: input.decision })
      .where(
        and(
          eq(approvalSubmissions.id, submissionId),
          eq(approvalSubmissions.organizationId, actor.organizationId),
          eq(approvalSubmissions.status, "pending"),
        ),
      )
      .returning({ id: approvalSubmissions.id });
    if (!claimed) {
      throw new AppError("CONFLICT", "This submission has already been decided.");
    }

    await tx.insert(approvalDecisions).values({
      id: decisionId,
      organizationId: actor.organizationId,
      submissionId,
      decision: input.decision,
      note: input.note,
      decidedByManagerUserId: actor.managerUserId,
      pinConfirmationAuditEventId: null,
      decidedAt: now,
    });

    if (input.decision === "approved") {
      await bumpSessionRevision(
        tx,
        actor.organizationId,
        context.session.id,
        context.session.revision,
        { status: "passed", completedAt: now },
      );
      await tx
        .update(trainingAssignments)
        .set({ status: "completed", updatedAt: now })
        .where(eq(trainingAssignments.id, context.assignment.id));

      const [sopVersionRow] = await tx
        .select({ sopId: sopVersions.sopId })
        .from(sopVersions)
        .where(
          and(
            eq(sopVersions.id, context.assignment.sopVersionId),
            eq(sopVersions.organizationId, actor.organizationId),
          ),
        )
        .limit(1);
      if (sopVersionRow) {
        awardOutcomes = await evaluateAndAwardQualifications(
          tx,
          actor.organizationId,
          context.assignment.employeeId,
          sopVersionRow.sopId,
        );
      }
    } else if (input.decision === "rejected") {
      await bumpSessionRevision(
        tx,
        actor.organizationId,
        context.session.id,
        context.session.revision,
        { status: "failed", completedAt: now },
      );
      await tx
        .update(trainingAssignments)
        .set({ status: attemptsRemaining ? "in_progress" : "failed", updatedAt: now })
        .where(eq(trainingAssignments.id, context.assignment.id));
    } else {
      // The session deliberately stays `awaiting_approval`: the attempt is not finished, it is
      // waiting on the employee's replacement evidence.
      await tx.insert(correctionRequests).values({
        id: randomUUID(),
        organizationId: actor.organizationId,
        submissionId,
        decisionId,
        replacementGeneration: context.submission.submissionGeneration + 1,
        createdAt: now,
      });
    }
  });

  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: context.assignment.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "training.approval_decided",
    targetType: "approval_submission",
    targetId: submissionId,
    metadata: {
      decision: input.decision,
      submissionGeneration: context.submission.submissionGeneration,
    },
    requestId,
  });
  if (input.decision === "needs_correction") {
    await writeAuditEvent({
      organizationId: actor.organizationId,
      locationId: context.assignment.locationId,
      actorKind: "manager",
      actorId: actor.managerUserId,
      action: "training.correction_requested",
      targetType: "approval_submission",
      targetId: submissionId,
      metadata: { replacementGeneration: context.submission.submissionGeneration + 1 },
      requestId,
    });
  }
  await writeDomainEvent({
    organizationId: actor.organizationId,
    locationId: context.assignment.locationId,
    type: "training.approval_decided",
    subjectType: "training_assignment",
    subjectId: context.assignment.id,
    payload: { decision: input.decision, submissionId },
  });
  for (const outcome of awardOutcomes) {
    await writeAuditEvent({
      organizationId: actor.organizationId,
      locationId: context.assignment.locationId,
      actorKind: "manager",
      actorId: actor.managerUserId,
      action: "qualification.awarded",
      targetType: "employee_qualification",
      targetId: outcome.qualificationId,
      metadata: { definitionId: outcome.definitionId, isNewAward: outcome.isNewAward },
      requestId,
    });
    await writeDomainEvent({
      organizationId: actor.organizationId,
      locationId: context.assignment.locationId,
      type: "qualification.awarded",
      subjectType: "employee_qualification",
      subjectId: outcome.qualificationId,
      payload: { definitionId: outcome.definitionId, isNewAward: outcome.isNewAward },
    });
  }

  return getApprovalSubmissionDetail(actor, submissionId);
}

function requireSubmissionOwner(context: SubmissionContext, session: EmployeeSessionContext): void {
  if (context.assignment.employeeId !== session.employeeId) {
    throw new AppError("NOT_FOUND", "Approval submission not found.");
  }
}

async function loadLatestCorrection(organizationId: string, submissionId: string) {
  const [row] = await getDb()
    .select()
    .from(correctionRequests)
    .where(
      and(
        eq(correctionRequests.organizationId, organizationId),
        eq(correctionRequests.submissionId, submissionId),
      ),
    )
    .orderBy(desc(correctionRequests.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * The signed-in employee's own correction: the manager's note, which evidence already exists
 * (every generation, never overwritten), and the steps whose proof can be replaced.
 */
export async function getEmployeeCorrectionDetail(
  session: EmployeeSessionContext,
  submissionId: string,
) {
  const context = await loadSubmissionContext(session.organizationId, submissionId);
  requireSubmissionOwner(context, session);

  const correction = await loadLatestCorrection(session.organizationId, submissionId);
  if (!correction) {
    throw new AppError("NOT_FOUND", "No correction has been requested for this submission.");
  }

  const [decision] = await getDb()
    .select({
      note: approvalDecisions.note,
      decidedAt: approvalDecisions.decidedAt,
      decidedByName: managerUsers.displayName,
    })
    .from(approvalDecisions)
    .innerJoin(managerUsers, eq(managerUsers.id, approvalDecisions.decidedByManagerUserId))
    .where(
      and(
        eq(approvalDecisions.id, correction.decisionId),
        eq(approvalDecisions.organizationId, session.organizationId),
      ),
    )
    .limit(1);
  if (!decision) throw new AppError("NOT_FOUND", "Correction request not found.");

  const computation = await loadSessionComputation(session.organizationId, context.session.id);
  const [sopVersion] = await getDb()
    .select({ title: sopVersions.title })
    .from(sopVersions)
    .where(
      and(
        eq(sopVersions.id, context.assignment.sopVersionId),
        eq(sopVersions.organizationId, session.organizationId),
      ),
    )
    .limit(1);

  const decisions = await loadSessionDecisionHistory(session.organizationId, context.session.id);

  return {
    submission: {
      id: context.submission.id,
      status: context.submission.status,
      submissionGeneration: context.submission.submissionGeneration,
      submittedAt: context.submission.submittedAt,
    },
    session: {
      id: context.session.id,
      assignmentId: context.session.assignmentId,
      attemptNumber: context.session.attemptNumber,
      revision: context.session.revision,
      status: context.session.status,
    },
    sopTitle: sopVersion?.title ?? "",
    correction: {
      id: correction.id,
      managerNote: decision.note,
      managerName: decision.decidedByName,
      requestedAt: decision.decidedAt,
      replacementGeneration: correction.replacementGeneration,
      resolvedAt: correction.resolvedAt,
      resolvedSubmissionId: correction.resolvedSubmissionId,
      isOpen: correction.resolvedAt === null,
    },
    // Only steps that carry an evidence requirement can take replacement proof; each one keeps
    // every generation it has ever had so the original submission stays visible.
    steps: computation.steps
      .filter(({ requirements }) => requirements.requirePhoto || requirements.requireVideo)
      .map(({ step, requirements }) => ({
        id: step.id,
        displayOrder: step.displayOrder,
        title: step.title,
        instruction: step.instruction,
        acceptsPhoto: requirements.requirePhoto,
        acceptsVideo: requirements.requireVideo,
        evidence: (computation.evidenceByStepId.get(step.id) ?? [])
          .slice()
          .sort((left, right) => left.submissionGeneration - right.submissionGeneration)
          .map((row) => ({
            id: row.id,
            fileId: row.fileId,
            evidenceType: row.evidenceType,
            submissionGeneration: row.submissionGeneration,
            employeeNote: row.employeeNote,
            createdAt: row.createdAt,
          })),
      })),
    decisions: decisions.map((row) => ({
      decision: row.decision,
      note: row.note,
      decidedAt: row.decidedAt,
      decidedByName: row.decidedByName,
      submissionGeneration: row.submissionGeneration,
    })),
  };
}

/**
 * Uploads replacement evidence against an open correction and resubmits for review. Evidence is
 * append-only: the replacement is added as the step's next evidence generation and the original
 * stays linked to the session. Resolving the correction is guarded twice — by an optimistic
 * session revision and by a conditional update on `resolved_at is null` — so a duplicate retry is
 * rejected instead of creating a second submission generation.
 */
export async function resubmitCorrection(
  session: EmployeeSessionContext,
  submissionId: string,
  formData: FormData,
  input: ApprovalResubmitFormInput,
  requestId?: string,
) {
  const context = await loadSubmissionContext(session.organizationId, submissionId);
  requireSubmissionOwner(context, session);

  const correction = await loadLatestCorrection(session.organizationId, submissionId);
  if (!correction) {
    throw new AppError("NOT_FOUND", "No correction has been requested for this submission.");
  }
  if (correction.resolvedAt !== null) {
    throw new AppError("CONFLICT", "This correction has already been resubmitted.");
  }

  const computation = await loadSessionComputation(session.organizationId, context.session.id);
  const stepEntry = computation.steps.find(({ step }) => step.id === input.stepId);
  if (!stepEntry) throw new AppError("NOT_FOUND", "Step not found.");
  if (!stepEntry.requirements.requirePhoto && !stepEntry.requirements.requireVideo) {
    throw new AppError("BAD_REQUEST", "This step does not accept evidence.");
  }

  const uploaded = await uploadEmployeeMedia(session, formData, requestId);
  const evidenceType = uploaded.mediaType === "image" ? "photo" : "video";
  if (evidenceType === "photo" && !stepEntry.requirements.requirePhoto) {
    throw new AppError("BAD_REQUEST", "This step does not accept photo evidence.");
  }
  if (evidenceType === "video" && !stepEntry.requirements.requireVideo) {
    throw new AppError("BAD_REQUEST", "This step does not accept video evidence.");
  }

  // The evidence counter is per step and independent of the approval submission generation; it
  // only ever moves forward so previous evidence is never replaced in place.
  const existingForStep = computation.evidenceByStepId.get(input.stepId) ?? [];
  const evidenceGeneration =
    existingForStep.reduce((max, row) => Math.max(max, row.submissionGeneration), 0) + 1;

  const replacementSubmissionId = randomUUID();
  const now = new Date();

  await getDb().transaction(async (tx) => {
    await bumpSessionRevision(
      tx,
      session.organizationId,
      context.session.id,
      input.expectedRevision,
    );
    await tx.insert(trainingEvidence).values({
      id: randomUUID(),
      organizationId: session.organizationId,
      sessionId: context.session.id,
      stepId: input.stepId,
      fileId: uploaded.id,
      evidenceType,
      submissionGeneration: evidenceGeneration,
      employeeNote: input.employeeNote,
    });
    await tx.insert(approvalSubmissions).values({
      id: replacementSubmissionId,
      organizationId: session.organizationId,
      sessionId: context.session.id,
      submissionGeneration: correction.replacementGeneration,
      status: "pending",
      submittedAt: now,
    });
    const [resolved] = await tx
      .update(correctionRequests)
      .set({ resolvedAt: now, resolvedSubmissionId: replacementSubmissionId })
      .where(
        and(
          eq(correctionRequests.id, correction.id),
          eq(correctionRequests.organizationId, session.organizationId),
          isNull(correctionRequests.resolvedAt),
        ),
      )
      .returning({ id: correctionRequests.id });
    if (!resolved) {
      throw new AppError("CONFLICT", "This correction has already been resubmitted.");
    }
  });

  await writeAuditEvent({
    organizationId: session.organizationId,
    locationId: session.locationId,
    actorKind: "employee",
    actorId: session.employeeId,
    action: "training.correction_resubmitted",
    targetType: "approval_submission",
    targetId: replacementSubmissionId,
    metadata: { replacementGeneration: correction.replacementGeneration },
    requestId,
  });

  // Returns the corrected submission, now resolved: the manager note, the original evidence, and
  // the replacement all stay readable on the same record.
  return getEmployeeCorrectionDetail(session, submissionId);
}

/**
 * The submission the owning employee currently needs to act on for an assignment, if any. Used to
 * link the training result screen into the correction flow without exposing another employee's
 * submissions.
 */
export async function getOpenCorrectionSubmissionId(
  session: EmployeeSessionContext,
  assignmentId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ submissionId: correctionRequests.submissionId })
    .from(correctionRequests)
    .innerJoin(
      approvalSubmissions,
      and(
        eq(approvalSubmissions.id, correctionRequests.submissionId),
        eq(approvalSubmissions.organizationId, correctionRequests.organizationId),
      ),
    )
    .innerJoin(
      trainingSessions,
      and(
        eq(trainingSessions.id, approvalSubmissions.sessionId),
        eq(trainingSessions.organizationId, approvalSubmissions.organizationId),
      ),
    )
    .innerJoin(
      trainingAssignments,
      and(
        eq(trainingAssignments.id, trainingSessions.assignmentId),
        eq(trainingAssignments.organizationId, trainingSessions.organizationId),
      ),
    )
    .where(
      and(
        eq(correctionRequests.organizationId, session.organizationId),
        eq(trainingAssignments.id, assignmentId),
        eq(trainingAssignments.employeeId, session.employeeId),
        isNull(correctionRequests.resolvedAt),
      ),
    )
    .orderBy(desc(correctionRequests.createdAt))
    .limit(1);
  return row?.submissionId ?? null;
}
