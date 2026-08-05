import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { writeAuditEvent } from "@/server/audit";
import { requireManagerManagedLocation } from "@/server/auth/authorization";
import type { ManagerSessionContext } from "@/server/auth/sessions";
import { bumpRunRevision, getChecklistRunDetail } from "@/server/checklists/runs";
import type { ChecklistApprovalDecisionInput } from "@/server/checklists/schemas";
import { getDb } from "@/server/db/client";
import { writeDomainEvent } from "@/server/events";
import { dispatchNotificationsForDomainEvent } from "@/server/notifications/service";
import {
  checklistApprovalDecisions,
  checklistApprovalSubmissions,
  checklistCorrectionRequests,
  checklistRuns,
} from "@/server/db/schema";

/**
 * Decides the current pending approval submission for a checklist run and applies its
 * consequences in one transaction. Mirrors `decideApprovalSubmission` in
 * `training/approvals.ts` exactly (claim-then-decide, immutable decision row, `needs_correction`
 * leaves the run `awaiting_approval` and opens a correction), minus the training-specific scoring
 * and qualification-award side effects that don't apply to checklists.
 */
export async function decideChecklistRun(
  actor: ManagerSessionContext,
  runId: string,
  input: ChecklistApprovalDecisionInput,
  requestId?: string,
) {
  const [run] = await getDb()
    .select()
    .from(checklistRuns)
    .where(and(eq(checklistRuns.id, runId), eq(checklistRuns.organizationId, actor.organizationId)))
    .limit(1);
  if (!run) throw new AppError("NOT_FOUND", "Checklist run not found.");
  await requireManagerManagedLocation(actor, run.locationId, requestId);

  const [submission] = await getDb()
    .select()
    .from(checklistApprovalSubmissions)
    .where(
      and(
        eq(checklistApprovalSubmissions.organizationId, actor.organizationId),
        eq(checklistApprovalSubmissions.runId, runId),
        eq(checklistApprovalSubmissions.status, "pending"),
      ),
    )
    .orderBy(desc(checklistApprovalSubmissions.submissionGeneration))
    .limit(1);
  if (!submission) {
    throw new AppError("CONFLICT", "This checklist run has no pending submission to decide.");
  }

  const now = new Date();
  const decisionId = randomUUID();

  await getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .update(checklistApprovalSubmissions)
      .set({ status: input.decision })
      .where(
        and(
          eq(checklistApprovalSubmissions.id, submission.id),
          eq(checklistApprovalSubmissions.organizationId, actor.organizationId),
          eq(checklistApprovalSubmissions.status, "pending"),
        ),
      )
      .returning({ id: checklistApprovalSubmissions.id });
    if (!claimed) {
      throw new AppError("CONFLICT", "This submission has already been decided.");
    }

    await tx.insert(checklistApprovalDecisions).values({
      id: decisionId,
      organizationId: actor.organizationId,
      submissionId: submission.id,
      decision: input.decision,
      note: input.note,
      decidedByManagerUserId: actor.managerUserId,
      decidedAt: now,
    });

    if (input.decision === "approved") {
      await bumpRunRevision(tx, actor.organizationId, runId, run.revision, {
        status: "submitted",
        completedAt: now,
      });
    } else if (input.decision === "rejected") {
      await bumpRunRevision(tx, actor.organizationId, runId, run.revision, {
        status: "rejected",
        completedAt: now,
      });
    } else {
      // The run deliberately stays `awaiting_approval`: it is waiting on the employee's
      // replacement evidence, resolved by `submitItemEvidence` in `runs.ts`.
      await tx.insert(checklistCorrectionRequests).values({
        id: randomUUID(),
        organizationId: actor.organizationId,
        submissionId: submission.id,
        decisionId,
        replacementGeneration: submission.submissionGeneration + 1,
        createdAt: now,
      });
    }
  });

  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: run.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "checklist_run.approval_decided",
    targetType: "checklist_approval_submission",
    targetId: submission.id,
    metadata: { decision: input.decision, submissionGeneration: submission.submissionGeneration },
    requestId,
  });
  if (input.decision === "needs_correction") {
    await writeAuditEvent({
      organizationId: actor.organizationId,
      locationId: run.locationId,
      actorKind: "manager",
      actorId: actor.managerUserId,
      action: "checklist_run.correction_requested",
      targetType: "checklist_approval_submission",
      targetId: submission.id,
      metadata: { replacementGeneration: submission.submissionGeneration + 1 },
      requestId,
    });
  }
  const approvalDecidedEvent = await writeDomainEvent({
    organizationId: actor.organizationId,
    locationId: run.locationId,
    type: "checklist_run.approval_decided",
    subjectType: "checklist_run",
    subjectId: runId,
    payload: { decision: input.decision, submissionId: submission.id },
  });
  await dispatchNotificationsForDomainEvent(approvalDecidedEvent);

  return getChecklistRunDetail(actor, runId);
}
