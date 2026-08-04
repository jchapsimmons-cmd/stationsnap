import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import { requireManagerManagedLocation } from "@/server/auth/authorization";
import type { EmployeeSessionContext, ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import {
  approvalSubmissions,
  sops,
  sopSteps,
  sopVersions,
  trainingAnswers,
  trainingAssignments,
  trainingEvidence,
  trainingSessions,
  trainingStepProgress,
} from "@/server/db/schema";
import { getEmployee } from "@/server/management/service";
import {
  defaultStepRequirementValues,
  loadStepTrainingRequirementsMap,
  loadTrainingConfig,
  loadTrainingQuestions,
} from "@/server/sops/service";
import type {
  TrainingAssignmentCreateInput,
  TrainingEvidenceUploadFormInput,
} from "@/server/training/schemas";
import { uploadEmployeeMedia } from "@/server/storage/media-service";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type StepRequirements = ReturnType<typeof defaultStepRequirementValues>;

async function auditTraining(
  session: EmployeeSessionContext,
  action:
    | "training.session_started"
    | "training.session_resumed"
    | "training.step_progress_recorded"
    | "training.answer_submitted"
    | "training.evidence_submitted"
    | "training.session_submitted",
  targetId: string,
  requestId?: string,
): Promise<void> {
  await writeAuditEvent({
    organizationId: session.organizationId,
    locationId: session.locationId,
    actorKind: "employee",
    actorId: session.employeeId,
    action,
    targetType: "training_session",
    targetId,
    requestId,
  });
}

async function loadVersionSteps(organizationId: string, sopVersionId: string) {
  const steps = await getDb()
    .select()
    .from(sopSteps)
    .where(eq(sopSteps.sopVersionId, sopVersionId))
    .orderBy(asc(sopSteps.displayOrder));
  const requirementsByStepId = await loadStepTrainingRequirementsMap(sopVersionId);
  return steps.map((step) => ({
    step,
    requirements: requirementsByStepId[step.id] ?? defaultStepRequirementValues(),
  }));
}

interface SessionComputation {
  session: typeof trainingSessions.$inferSelect;
  assignment: typeof trainingAssignments.$inferSelect;
  config: Awaited<ReturnType<typeof loadTrainingConfig>>;
  steps: Array<{ step: typeof sopSteps.$inferSelect; requirements: StepRequirements }>;
  questions: Awaited<ReturnType<typeof loadTrainingQuestions>>;
  progressByStepId: Map<string, typeof trainingStepProgress.$inferSelect>;
  answersByQuestionId: Map<string, typeof trainingAnswers.$inferSelect>;
  evidenceByStepId: Map<string, (typeof trainingEvidence.$inferSelect)[]>;
}

async function requireOwnedAssignment(session: EmployeeSessionContext, assignmentId: string) {
  const [row] = await getDb()
    .select()
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.id, assignmentId),
        eq(trainingAssignments.organizationId, session.organizationId),
      ),
    )
    .limit(1);
  if (!row || row.employeeId !== session.employeeId) {
    throw new AppError("NOT_FOUND", "Assignment not found.");
  }
  return row;
}

async function loadSessionComputation(
  organizationId: string,
  sessionId: string,
): Promise<SessionComputation> {
  const [session] = await getDb()
    .select()
    .from(trainingSessions)
    .where(
      and(eq(trainingSessions.id, sessionId), eq(trainingSessions.organizationId, organizationId)),
    )
    .limit(1);
  if (!session) throw new AppError("NOT_FOUND", "Training session not found.");
  const [assignment] = await getDb()
    .select()
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.id, session.assignmentId),
        eq(trainingAssignments.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!assignment) throw new AppError("NOT_FOUND", "Assignment not found.");
  const config = await loadTrainingConfig(organizationId, assignment.sopVersionId);
  const steps = await loadVersionSteps(organizationId, assignment.sopVersionId);
  const questions = await loadTrainingQuestions(assignment.sopVersionId);
  const [progressRows, answerRows, evidenceRows] = await Promise.all([
    getDb()
      .select()
      .from(trainingStepProgress)
      .where(eq(trainingStepProgress.sessionId, sessionId)),
    getDb().select().from(trainingAnswers).where(eq(trainingAnswers.sessionId, sessionId)),
    getDb().select().from(trainingEvidence).where(eq(trainingEvidence.sessionId, sessionId)),
  ]);
  const progressByStepId = new Map(progressRows.map((row) => [row.stepId, row]));
  const answersByQuestionId = new Map(answerRows.map((row) => [row.questionId, row]));
  const evidenceByStepId = new Map<string, (typeof trainingEvidence.$inferSelect)[]>();
  for (const row of evidenceRows) {
    if (!row.stepId) continue;
    const list = evidenceByStepId.get(row.stepId) ?? [];
    list.push(row);
    evidenceByStepId.set(row.stepId, list);
  }
  return {
    session,
    assignment,
    config,
    steps,
    questions,
    progressByStepId,
    answersByQuestionId,
    evidenceByStepId,
  };
}

function requireSessionOwner(
  computation: SessionComputation,
  session: EmployeeSessionContext,
): void {
  if (computation.assignment.employeeId !== session.employeeId) {
    throw new AppError("NOT_FOUND", "Training session not found.");
  }
}

function stepQuestionsSatisfied(
  stepId: string,
  questions: SessionComputation["questions"],
  answersByQuestionId: SessionComputation["answersByQuestionId"],
): boolean {
  const stepQuestions = questions.filter((question) => question.stepId === stepId);
  return stepQuestions.every((question) => answersByQuestionId.has(question.id));
}

function isStepDone(
  stepId: string,
  requirements: StepRequirements,
  computation: SessionComputation,
): boolean {
  const progress = computation.progressByStepId.get(stepId);
  const evidenceList = computation.evidenceByStepId.get(stepId) ?? [];
  if (requirements.requireConfirmation && !(progress?.confirmed ?? false)) return false;
  if (requirements.requireFullVideo && !(progress?.videoWatchedFully ?? false)) return false;
  if (requirements.requireTimer && !(progress?.timerCompleted ?? false)) return false;
  if (
    requirements.requireQuestion &&
    !stepQuestionsSatisfied(stepId, computation.questions, computation.answersByQuestionId)
  ) {
    return false;
  }
  if (requirements.requirePhoto && !evidenceList.some((row) => row.evidenceType === "photo")) {
    return false;
  }
  if (requirements.requireVideo && !evidenceList.some((row) => row.evidenceType === "video")) {
    return false;
  }
  return true;
}

function resolveCurrentStepId(computation: SessionComputation): string | null {
  for (const { step, requirements } of computation.steps) {
    if (step.isRequired && !isStepDone(step.id, requirements, computation)) {
      return step.id;
    }
  }
  return null;
}

function allRequiredStepsDone(computation: SessionComputation): boolean {
  return resolveCurrentStepId(computation) === null;
}

function finalQuestionsAnswered(computation: SessionComputation): boolean {
  const finalQuestions = computation.questions.filter((question) => question.placement === "final");
  return finalQuestions.every((question) => computation.answersByQuestionId.has(question.id));
}

function computeScorePercent(computation: SessionComputation): number {
  const totalPoints = computation.questions.reduce((sum, question) => sum + question.points, 0);
  if (totalPoints === 0) return 100;
  const awarded = [...computation.answersByQuestionId.values()].reduce(
    (sum, answer) => sum + answer.pointsAwarded,
    0,
  );
  return Math.round((awarded / totalPoints) * 100);
}

function assignmentNeedsApproval(computation: SessionComputation): boolean {
  if (!computation.config.requireEvidenceApproval) return false;
  return computation.steps.some(({ requirements }) => requirements.requireApproval);
}

function assertStepAccessible(computation: SessionComputation, stepId: string): void {
  const stepExists = computation.steps.some(({ step }) => step.id === stepId);
  if (!stepExists) throw new AppError("NOT_FOUND", "Step not found.");
  if (!computation.config.requireSequentialProgress) return;
  const progress = computation.progressByStepId.get(stepId);
  if (progress?.status === "completed") {
    if (computation.config.allowBacktracking) return;
    throw new AppError("BAD_REQUEST", "This step is already complete.");
  }
  const currentStepId = resolveCurrentStepId(computation);
  if (currentStepId === null || currentStepId === stepId) return;
  const orderedIds = computation.steps.map(({ step }) => step.id);
  const stepIndex = orderedIds.indexOf(stepId);
  const currentIndex = orderedIds.indexOf(currentStepId);
  if (stepIndex < currentIndex && computation.config.allowBacktracking) return;
  throw new AppError("BAD_REQUEST", "Complete the current required step before continuing.");
}

function requireSessionInProgress(computation: SessionComputation): void {
  if (computation.session.status !== "in_progress") {
    throw new AppError("CONFLICT", "This training session is no longer in progress.");
  }
}

async function bumpSessionRevision(
  tx: Tx,
  organizationId: string,
  sessionId: string,
  expectedRevision: number,
  extraSet: Record<string, unknown> = {},
): Promise<number> {
  const [row] = await tx
    .update(trainingSessions)
    .set({ ...extraSet, revision: expectedRevision + 1, updatedAt: new Date() })
    .where(
      and(
        eq(trainingSessions.id, sessionId),
        eq(trainingSessions.organizationId, organizationId),
        eq(trainingSessions.revision, expectedRevision),
      ),
    )
    .returning({ revision: trainingSessions.revision });
  if (!row) {
    throw new AppError("CONFLICT", "This training session changed elsewhere. Reload to continue.");
  }
  return row.revision;
}

/** Creates a single-employee training assignment for a published SOP version. Bulk targeting, due dates, and full duplicate-active resolution are Phase 9 scope; this enforces a minimal duplicate guard. */
export async function assignTraining(
  actor: ManagerSessionContext,
  input: TrainingAssignmentCreateInput,
  requestId?: string,
) {
  const employee = await getEmployee(actor, input.employeeId);
  if (employee.status !== "active") {
    throw new AppError("CONFLICT", "This employee is disabled.");
  }

  const [sopRow] = await getDb()
    .select({
      id: sops.id,
      locationId: sops.locationId,
      status: sops.status,
      currentVersionId: sops.currentVersionId,
    })
    .from(sops)
    .where(and(eq(sops.id, input.sopId), eq(sops.organizationId, actor.organizationId)))
    .limit(1);
  if (!sopRow || sopRow.status !== "published" || !sopRow.currentVersionId) {
    throw new AppError("NOT_FOUND", "SOP not found.");
  }
  await requireManagerManagedLocation(actor, sopRow.locationId, requestId);
  if (sopRow.locationId !== employee.primaryLocationId) {
    throw new AppError("BAD_REQUEST", "This SOP is not available at the employee's location.");
  }

  const config = await loadTrainingConfig(actor.organizationId, sopRow.currentVersionId);
  if (config.requirementState === "disabled") {
    throw new AppError("BAD_REQUEST", "This SOP does not have training enabled.");
  }
  const requiredMode = input.requiredMode ?? config.defaultMode;

  const [existing] = await getDb()
    .select({
      id: trainingAssignments.id,
      status: trainingAssignments.status,
      retrainingGeneration: trainingAssignments.retrainingGeneration,
    })
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.employeeId, employee.id),
        eq(trainingAssignments.sopVersionId, sopRow.currentVersionId),
      ),
    )
    .orderBy(desc(trainingAssignments.retrainingGeneration))
    .limit(1);
  if (existing && existing.status !== "failed" && existing.status !== "cancelled") {
    throw new AppError(
      "CONFLICT",
      "This employee already has an active or completed assignment for this SOP version.",
    );
  }
  const retrainingGeneration = existing ? existing.retrainingGeneration + 1 : 0;

  const [row] = await getDb()
    .insert(trainingAssignments)
    .values({
      id: randomUUID(),
      organizationId: actor.organizationId,
      locationId: employee.primaryLocationId,
      employeeId: employee.id,
      sopVersionId: sopRow.currentVersionId,
      requiredMode,
      status: "assigned",
      assignedByManagerUserId: actor.managerUserId,
      retrainingGeneration,
    })
    .returning();
  if (!row) throw new AppError("INTERNAL_ERROR", "The assignment could not be created.");

  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: employee.primaryLocationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "training.assigned",
    targetType: "training_assignment",
    targetId: row.id,
    requestId,
  });

  return row;
}

/** Assignment summary for the owning employee: config, attempt budget, active/latest session, and awareness of a newer published SOP version. */
export async function getAssignmentDetail(session: EmployeeSessionContext, assignmentId: string) {
  const assignment = await requireOwnedAssignment(session, assignmentId);
  const [sopVersion] = await getDb()
    .select()
    .from(sopVersions)
    .where(
      and(
        eq(sopVersions.id, assignment.sopVersionId),
        eq(sopVersions.organizationId, session.organizationId),
      ),
    )
    .limit(1);
  if (!sopVersion) throw new AppError("NOT_FOUND", "SOP version not found.");
  const [sopRow] = await getDb()
    .select({ id: sops.id, currentVersionId: sops.currentVersionId })
    .from(sops)
    .where(and(eq(sops.id, sopVersion.sopId), eq(sops.organizationId, session.organizationId)))
    .limit(1);
  const config = await loadTrainingConfig(session.organizationId, assignment.sopVersionId);
  const sessions = await getDb()
    .select()
    .from(trainingSessions)
    .where(eq(trainingSessions.assignmentId, assignment.id))
    .orderBy(desc(trainingSessions.attemptNumber));
  const activeSession = sessions.find((row) => row.status === "in_progress") ?? null;
  const latestSession = sessions[0] ?? null;

  let newerVersionChangeSummary: string | null = null;
  if (sopRow?.currentVersionId && sopRow.currentVersionId !== assignment.sopVersionId) {
    const [currentVersion] = await getDb()
      .select({ changeSummary: sopVersions.changeSummary })
      .from(sopVersions)
      .where(eq(sopVersions.id, sopRow.currentVersionId))
      .limit(1);
    newerVersionChangeSummary = currentVersion?.changeSummary ?? "";
  }

  return {
    id: assignment.id,
    sopId: sopVersion.sopId,
    sopTitle: sopVersion.title,
    requiredMode: assignment.requiredMode,
    status: assignment.status,
    dueAt: assignment.dueAt,
    config,
    attemptsUsed: sessions.length,
    maxAttempts: config.maxAttempts,
    activeSessionId: activeSession?.id ?? null,
    latestSession: latestSession
      ? {
          id: latestSession.id,
          attemptNumber: latestSession.attemptNumber,
          status: latestSession.status,
          scorePercent: latestSession.scorePercent,
        }
      : null,
    sopHasNewerVersion: newerVersionChangeSummary !== null,
    newerVersionChangeSummary,
  };
}

/** Resumes the in-progress session for this assignment, or starts a new attempt when none is active and attempts remain. */
export async function startOrResumeSession(
  session: EmployeeSessionContext,
  assignmentId: string,
  requestId?: string,
) {
  const assignment = await requireOwnedAssignment(session, assignmentId);
  if (assignment.status === "completed" || assignment.status === "cancelled") {
    throw new AppError("CONFLICT", "This training assignment is no longer active.");
  }
  const config = await loadTrainingConfig(session.organizationId, assignment.sopVersionId);
  const existingSessions = await getDb()
    .select()
    .from(trainingSessions)
    .where(eq(trainingSessions.assignmentId, assignment.id))
    .orderBy(desc(trainingSessions.attemptNumber));

  const active = existingSessions.find((row) => row.status === "in_progress");
  if (active) {
    const [updated] = await getDb()
      .update(trainingSessions)
      .set({ lastResumedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(trainingSessions.id, active.id),
          eq(trainingSessions.organizationId, session.organizationId),
        ),
      )
      .returning();
    await auditTraining(session, "training.session_resumed", active.id, requestId);
    return updated ?? active;
  }

  if (existingSessions.length >= config.maxAttempts) {
    throw new AppError("CONFLICT", "The maximum number of attempts has been reached.");
  }

  const steps = await loadVersionSteps(session.organizationId, assignment.sopVersionId);
  const firstStepId = steps[0]?.step.id ?? null;
  const attemptNumber = existingSessions.length + 1;

  const [created] = await getDb()
    .insert(trainingSessions)
    .values({
      id: randomUUID(),
      organizationId: session.organizationId,
      assignmentId: assignment.id,
      attemptNumber,
      mode: assignment.requiredMode,
      status: "in_progress",
      currentStepId: firstStepId,
    })
    .returning();
  if (!created) throw new AppError("INTERNAL_ERROR", "The training session could not be started.");

  if (assignment.status === "assigned") {
    await getDb()
      .update(trainingAssignments)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(trainingAssignments.id, assignment.id));
  }

  await auditTraining(session, "training.session_started", created.id, requestId);
  return created;
}

function serializeQuestion(
  question: SessionComputation["questions"][number],
  computation: SessionComputation,
) {
  const answer = computation.answersByQuestionId.get(question.id);
  const isTerminal = computation.session.status !== "in_progress";
  let explanation: string | null = null;
  if (answer) {
    if (question.explanationPolicy === "always") explanation = question.explanation;
    else if (question.explanationPolicy === "on_incorrect" && !answer.isCorrect) {
      explanation = question.explanation;
    }
  }
  return {
    id: question.id,
    stepId: question.stepId,
    type: question.type,
    text: question.text,
    points: question.points,
    placement: question.placement,
    displayOrder: question.displayOrder,
    choices: question.choices.map((choice) => ({
      id: choice.id,
      text: choice.text,
      displayOrder: choice.displayOrder,
      ...(isTerminal ? { isCorrect: choice.isCorrect } : {}),
    })),
    answer: answer
      ? {
          selectedChoiceIds: answer.selectedChoiceIds,
          isCorrect: answer.isCorrect,
          pointsAwarded: answer.pointsAwarded,
          explanation,
        }
      : null,
  };
}

function serializeSessionState(computation: SessionComputation) {
  const stepPayloads = computation.steps.map(({ step, requirements }) => {
    const progress = computation.progressByStepId.get(step.id);
    const evidenceList = computation.evidenceByStepId.get(step.id) ?? [];
    const stepQuestions = computation.questions.filter((question) => question.stepId === step.id);
    return {
      id: step.id,
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
      requirements,
      progress: {
        status: progress?.status ?? "pending",
        confirmed: progress?.confirmed ?? false,
        videoWatchedFully: progress?.videoWatchedFully ?? false,
        timerCompleted: progress?.timerCompleted ?? false,
      },
      evidence: evidenceList.map((row) => ({
        id: row.id,
        evidenceType: row.evidenceType,
        status: row.status,
        submissionGeneration: row.submissionGeneration,
        fileId: row.fileId,
        createdAt: row.createdAt.toISOString(),
      })),
      beforeQuestions: stepQuestions
        .filter((question) => question.placement === "before_step")
        .map((question) => serializeQuestion(question, computation)),
      afterQuestions: stepQuestions
        .filter((question) => question.placement === "after_step")
        .map((question) => serializeQuestion(question, computation)),
    };
  });

  const finalQuestions = computation.questions
    .filter((question) => question.placement === "final")
    .map((question) => serializeQuestion(question, computation));

  return {
    id: computation.session.id,
    assignmentId: computation.session.assignmentId,
    attemptNumber: computation.session.attemptNumber,
    mode: computation.session.mode,
    status: computation.session.status,
    currentStepId: computation.session.currentStepId,
    scorePercent: computation.session.scorePercent,
    revision: computation.session.revision,
    startedAt: computation.session.startedAt,
    submittedAt: computation.session.submittedAt,
    completedAt: computation.session.completedAt,
    allRequiredStepsDone: allRequiredStepsDone(computation),
    finalQuestionsAnswered: finalQuestionsAnswered(computation),
    steps: stepPayloads,
    finalQuestions,
  };
}

/** The authoritative, resumable state of a training session: steps, progress, evidence, and redacted questions. */
export async function getSessionState(
  session: EmployeeSessionContext,
  assignmentId: string,
  sessionId: string,
) {
  const assignment = await requireOwnedAssignment(session, assignmentId);
  const computation = await loadSessionComputation(session.organizationId, sessionId);
  requireSessionOwner(computation, session);
  if (computation.session.assignmentId !== assignment.id) {
    throw new AppError("NOT_FOUND", "Training session not found.");
  }
  return serializeSessionState(computation);
}

/** Records a step-level action (view, confirmation, full video watch, or timer completion) and recomputes the authoritative current step. */
export async function recordStepAction(
  session: EmployeeSessionContext,
  assignmentId: string,
  sessionId: string,
  stepId: string,
  action: "viewed" | "confirmed" | "video_watched" | "timer_completed",
  expectedRevision: number,
  requestId?: string,
) {
  const assignment = await requireOwnedAssignment(session, assignmentId);
  const computation = await loadSessionComputation(session.organizationId, sessionId);
  requireSessionOwner(computation, session);
  if (computation.session.assignmentId !== assignment.id) {
    throw new AppError("NOT_FOUND", "Training session not found.");
  }
  requireSessionInProgress(computation);
  assertStepAccessible(computation, stepId);

  const stepEntry = computation.steps.find(({ step }) => step.id === stepId);
  if (!stepEntry) throw new AppError("NOT_FOUND", "Step not found.");
  if (action === "video_watched" && !stepEntry.step.videoFileId) {
    throw new AppError("BAD_REQUEST", "This step has no video to watch.");
  }
  if (action === "timer_completed" && !stepEntry.step.timerSeconds) {
    throw new AppError("BAD_REQUEST", "This step has no timer.");
  }

  const existingProgress = computation.progressByStepId.get(stepId);
  const now = new Date();
  const patch: Partial<typeof trainingStepProgress.$inferInsert> = {};
  if (action === "confirmed") patch.confirmed = true;
  if (action === "video_watched") patch.videoWatchedFully = true;
  if (action === "timer_completed") patch.timerCompleted = true;

  await getDb().transaction(async (tx) => {
    await bumpSessionRevision(tx, session.organizationId, sessionId, expectedRevision);
    await tx
      .insert(trainingStepProgress)
      .values({
        id: randomUUID(),
        organizationId: session.organizationId,
        sessionId,
        stepId,
        status: "in_progress",
        confirmed: patch.confirmed ?? false,
        videoWatchedFully: patch.videoWatchedFully ?? false,
        timerCompleted: patch.timerCompleted ?? false,
        startedAt: now,
      })
      .onConflictDoUpdate({
        target: [trainingStepProgress.sessionId, trainingStepProgress.stepId],
        set: {
          ...patch,
          startedAt: existingProgress?.startedAt ?? now,
          updatedAt: now,
        },
      });

    const patchedProgress = {
      ...(existingProgress ?? {
        id: randomUUID(),
        organizationId: session.organizationId,
        sessionId,
        stepId,
        status: "in_progress" as const,
        confirmed: false,
        videoWatchedFully: false,
        timerCompleted: false,
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
      ...patch,
    };
    computation.progressByStepId.set(stepId, patchedProgress);
    const done = isStepDone(stepId, stepEntry.requirements, computation);
    if (done && patchedProgress.status !== "completed") {
      patchedProgress.status = "completed";
      patchedProgress.completedAt = now;
      await tx
        .update(trainingStepProgress)
        .set({ status: "completed", completedAt: now, updatedAt: now })
        .where(
          and(
            eq(trainingStepProgress.sessionId, sessionId),
            eq(trainingStepProgress.stepId, stepId),
          ),
        );
      computation.progressByStepId.set(stepId, patchedProgress);
    }

    const currentStepId = resolveCurrentStepId(computation);
    await tx
      .update(trainingSessions)
      .set({ currentStepId, updatedAt: now })
      .where(eq(trainingSessions.id, sessionId));
  });

  await auditTraining(session, "training.step_progress_recorded", sessionId, requestId);
  return getSessionState(session, assignmentId, sessionId);
}

/** Grades and records a quiz answer, upserting while the session is in progress so employees may revise before final submission. */
export async function submitAnswer(
  session: EmployeeSessionContext,
  assignmentId: string,
  sessionId: string,
  questionId: string,
  selectedChoiceIds: string[],
  expectedRevision: number,
  requestId?: string,
) {
  const assignment = await requireOwnedAssignment(session, assignmentId);
  const computation = await loadSessionComputation(session.organizationId, sessionId);
  requireSessionOwner(computation, session);
  if (computation.session.assignmentId !== assignment.id) {
    throw new AppError("NOT_FOUND", "Training session not found.");
  }
  requireSessionInProgress(computation);

  const question = computation.questions.find((row) => row.id === questionId);
  if (!question) throw new AppError("NOT_FOUND", "Question not found.");
  if (question.stepId) {
    assertStepAccessible(computation, question.stepId);
  } else if (!allRequiredStepsDone(computation)) {
    throw new AppError("BAD_REQUEST", "Complete all required steps before final questions.");
  }

  const validChoiceIds = new Set(question.choices.map((choice) => choice.id));
  if (!selectedChoiceIds.every((id) => validChoiceIds.has(id))) {
    throw new AppError("BAD_REQUEST", "One or more selected choices are invalid.");
  }
  const correctChoiceIds = new Set(
    question.choices.filter((choice) => choice.isCorrect).map((choice) => choice.id),
  );
  const selectedSet = new Set(selectedChoiceIds);
  const isCorrect =
    selectedSet.size === correctChoiceIds.size &&
    [...selectedSet].every((id) => correctChoiceIds.has(id));
  const pointsAwarded = isCorrect ? question.points : 0;

  await getDb().transaction(async (tx) => {
    await bumpSessionRevision(tx, session.organizationId, sessionId, expectedRevision);
    await tx
      .insert(trainingAnswers)
      .values({
        id: randomUUID(),
        organizationId: session.organizationId,
        sessionId,
        questionId,
        selectedChoiceIds,
        isCorrect,
        pointsAwarded,
      })
      .onConflictDoUpdate({
        target: [trainingAnswers.sessionId, trainingAnswers.questionId],
        set: { selectedChoiceIds, isCorrect, pointsAwarded, answeredAt: new Date() },
      });

    if (question.stepId) {
      computation.answersByQuestionId.set(questionId, {
        id: randomUUID(),
        organizationId: session.organizationId,
        sessionId,
        questionId,
        selectedChoiceIds,
        isCorrect,
        pointsAwarded,
        answeredAt: new Date(),
      });
      const stepEntry = computation.steps.find(({ step }) => step.id === question.stepId);
      if (stepEntry) {
        const done = isStepDone(question.stepId, stepEntry.requirements, computation);
        const existingProgress = computation.progressByStepId.get(question.stepId);
        if (done && existingProgress?.status !== "completed") {
          const now = new Date();
          await tx
            .insert(trainingStepProgress)
            .values({
              id: randomUUID(),
              organizationId: session.organizationId,
              sessionId,
              stepId: question.stepId,
              status: "completed",
              startedAt: now,
              completedAt: now,
            })
            .onConflictDoUpdate({
              target: [trainingStepProgress.sessionId, trainingStepProgress.stepId],
              set: { status: "completed", completedAt: now, updatedAt: now },
            });
          computation.progressByStepId.set(question.stepId, {
            ...(existingProgress ?? {
              id: randomUUID(),
              organizationId: session.organizationId,
              sessionId,
              stepId: question.stepId,
              confirmed: false,
              videoWatchedFully: false,
              timerCompleted: false,
              startedAt: now,
              createdAt: now,
              updatedAt: now,
            }),
            status: "completed",
            completedAt: now,
          });
        }
      }
    }

    const currentStepId = resolveCurrentStepId(computation);
    await tx
      .update(trainingSessions)
      .set({ currentStepId, updatedAt: new Date() })
      .where(eq(trainingSessions.id, sessionId));
  });

  await auditTraining(session, "training.answer_submitted", sessionId, requestId);
  return getSessionState(session, assignmentId, sessionId);
}

/** Uploads employee-submitted evidence for a step and links it to the session as a new, append-only submission generation. */
export async function submitStepEvidence(
  session: EmployeeSessionContext,
  assignmentId: string,
  sessionId: string,
  stepId: string,
  formData: FormData,
  input: TrainingEvidenceUploadFormInput,
  requestId?: string,
) {
  const assignment = await requireOwnedAssignment(session, assignmentId);
  const computation = await loadSessionComputation(session.organizationId, sessionId);
  requireSessionOwner(computation, session);
  if (computation.session.assignmentId !== assignment.id) {
    throw new AppError("NOT_FOUND", "Training session not found.");
  }
  requireSessionInProgress(computation);
  assertStepAccessible(computation, stepId);

  const stepEntry = computation.steps.find(({ step }) => step.id === stepId);
  if (!stepEntry) throw new AppError("NOT_FOUND", "Step not found.");
  if (!stepEntry.requirements.requirePhoto && !stepEntry.requirements.requireVideo) {
    throw new AppError("BAD_REQUEST", "This step does not require evidence.");
  }

  const uploaded = await uploadEmployeeMedia(session, formData, requestId);
  const evidenceType = uploaded.mediaType === "image" ? "photo" : "video";
  if (evidenceType === "photo" && !stepEntry.requirements.requirePhoto) {
    throw new AppError("BAD_REQUEST", "This step does not accept photo evidence.");
  }
  if (evidenceType === "video" && !stepEntry.requirements.requireVideo) {
    throw new AppError("BAD_REQUEST", "This step does not accept video evidence.");
  }

  const existingForStep = computation.evidenceByStepId.get(stepId) ?? [];
  const submissionGeneration =
    existingForStep.reduce((max, row) => Math.max(max, row.submissionGeneration), 0) + 1;

  await getDb().transaction(async (tx) => {
    await bumpSessionRevision(tx, session.organizationId, sessionId, input.expectedRevision);
    const [evidenceRow] = await tx
      .insert(trainingEvidence)
      .values({
        id: randomUUID(),
        organizationId: session.organizationId,
        sessionId,
        stepId,
        fileId: uploaded.id,
        evidenceType,
        submissionGeneration,
        employeeNote: input.employeeNote,
      })
      .returning();
    if (evidenceRow) {
      computation.evidenceByStepId.set(stepId, [...existingForStep, evidenceRow]);
    }

    const done = isStepDone(stepId, stepEntry.requirements, computation);
    const existingProgress = computation.progressByStepId.get(stepId);
    if (done && existingProgress?.status !== "completed") {
      const now = new Date();
      await tx
        .insert(trainingStepProgress)
        .values({
          id: randomUUID(),
          organizationId: session.organizationId,
          sessionId,
          stepId,
          status: "completed",
          startedAt: now,
          completedAt: now,
        })
        .onConflictDoUpdate({
          target: [trainingStepProgress.sessionId, trainingStepProgress.stepId],
          set: { status: "completed", completedAt: now, updatedAt: now },
        });
      computation.progressByStepId.set(stepId, {
        ...(existingProgress ?? {
          id: randomUUID(),
          organizationId: session.organizationId,
          sessionId,
          stepId,
          confirmed: false,
          videoWatchedFully: false,
          timerCompleted: false,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        }),
        status: "completed",
        completedAt: now,
      });
    }

    const currentStepId = resolveCurrentStepId(computation);
    await tx
      .update(trainingSessions)
      .set({ currentStepId, updatedAt: new Date() })
      .where(eq(trainingSessions.id, sessionId));
  });

  await auditTraining(session, "training.evidence_submitted", sessionId, requestId);
  return getSessionState(session, assignmentId, sessionId);
}

/** Finalizes a session: verifies completion, grades the attempt, routes to manager approval when required, and updates the assignment. Idempotent once no longer in progress. */
export async function submitSession(
  session: EmployeeSessionContext,
  assignmentId: string,
  sessionId: string,
  expectedRevision: number,
  requestId?: string,
) {
  const assignment = await requireOwnedAssignment(session, assignmentId);
  const computation = await loadSessionComputation(session.organizationId, sessionId);
  requireSessionOwner(computation, session);
  if (computation.session.assignmentId !== assignment.id) {
    throw new AppError("NOT_FOUND", "Training session not found.");
  }

  if (computation.session.status !== "in_progress") {
    return getSessionState(session, assignmentId, sessionId);
  }

  if (!allRequiredStepsDone(computation)) {
    throw new AppError("BAD_REQUEST", "Complete all required steps before submitting.");
  }
  if (!finalQuestionsAnswered(computation)) {
    throw new AppError("BAD_REQUEST", "Answer all final questions before submitting.");
  }

  const scorePercent = computeScorePercent(computation);
  const needsApproval = assignmentNeedsApproval(computation);
  const now = new Date();

  await getDb().transaction(async (tx) => {
    if (needsApproval) {
      await bumpSessionRevision(tx, session.organizationId, sessionId, expectedRevision, {
        status: "awaiting_approval",
        scorePercent,
        submittedAt: now,
      });
      await tx.insert(approvalSubmissions).values({
        id: randomUUID(),
        organizationId: session.organizationId,
        sessionId,
        submissionGeneration: 1,
        status: "pending",
      });
    } else {
      const passed = scorePercent >= computation.config.passingScorePercent;
      await bumpSessionRevision(tx, session.organizationId, sessionId, expectedRevision, {
        status: passed ? "passed" : "failed",
        scorePercent,
        submittedAt: now,
        completedAt: now,
      });
      const attemptsRemaining = computation.session.attemptNumber < computation.config.maxAttempts;
      await tx
        .update(trainingAssignments)
        .set({
          status: passed ? "completed" : attemptsRemaining ? "in_progress" : "failed",
          updatedAt: now,
        })
        .where(eq(trainingAssignments.id, assignment.id));
    }
  });

  await auditTraining(session, "training.session_submitted", sessionId, requestId);
  return getSessionState(session, assignmentId, sessionId);
}
