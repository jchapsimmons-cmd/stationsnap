import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { parseAiDraftedSop } from "@/server/ai/draft-schema";
import { writeAuditEvent } from "@/server/audit";
import { requireManagerManagedLocation } from "@/server/auth/authorization";
import type { ManagerSessionContext } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import { aiSopJobOutputs, aiSopJobs, files, sops } from "@/server/db/schema";
import {
  regenerateAiSopJobDraft as runRegenerateAiSopJobDraft,
  retryAiSopJob as runRetryAiSopJob,
} from "@/server/jobs/ai-sop-job-runner";
import { applyAiDraftToSopDraft, getSopDraft } from "@/server/sops/service";
import type { CreateVideoDraftJobInput } from "@/server/sops/ai-jobs-schemas";

async function requireManageableSopForAi(actor: ManagerSessionContext, sopId: string) {
  const [sop] = await getDb()
    .select({ id: sops.id, locationId: sops.locationId })
    .from(sops)
    .where(and(eq(sops.id, sopId), eq(sops.organizationId, actor.organizationId)))
    .limit(1);
  if (!sop) throw new AppError("NOT_FOUND", "SOP not found.");
  await requireManagerManagedLocation(actor, sop.locationId);
  return sop;
}

async function loadJobWithOutputs(organizationId: string, sopId: string, jobId: string) {
  const [job] = await getDb()
    .select()
    .from(aiSopJobs)
    .where(
      and(
        eq(aiSopJobs.id, jobId),
        eq(aiSopJobs.sopId, sopId),
        eq(aiSopJobs.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!job) throw new AppError("NOT_FOUND", "AI job not found.");
  const outputs = await getDb()
    .select()
    .from(aiSopJobOutputs)
    .where(
      and(eq(aiSopJobOutputs.jobId, jobId), eq(aiSopJobOutputs.organizationId, organizationId)),
    )
    .orderBy(desc(aiSopJobOutputs.createdAt));
  return { job, outputs };
}

/**
 * Starts a video-to-draft job for an already-uploaded video. Requires an existing draft version
 * (the job only ever writes onto a draft — never a published version), reusing the same media
 * upload pipeline every other SOP file field uses (`POST /api/management/media`, then this call
 * references the resulting file id). `nextAttemptAt` defaults to now, so the very first cron tick
 * after creation is eligible to claim it.
 */
export async function createVideoDraftJob(
  actor: ManagerSessionContext,
  sopId: string,
  input: CreateVideoDraftJobInput,
  requestId?: string,
) {
  const draft = await getSopDraft(actor, sopId);
  const [file] = await getDb()
    .select()
    .from(files)
    .where(and(eq(files.id, input.sourceFileId), eq(files.organizationId, actor.organizationId)))
    .limit(1);
  if (!file || file.status !== "ready") {
    throw new AppError("BAD_REQUEST", "Finish uploading the video before generating a draft.");
  }
  if (file.mediaType !== "video") {
    throw new AppError("BAD_REQUEST", "Choose an uploaded video to generate a draft from.");
  }

  const id = randomUUID();
  await getDb().insert(aiSopJobs).values({
    id,
    organizationId: actor.organizationId,
    locationId: draft.locationId,
    sopId,
    sourceFileId: input.sourceFileId,
    status: "upload_received",
    createdByManagerUserId: actor.managerUserId,
  });

  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: draft.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "ai_sop_job.created",
    targetType: "ai_sop_job",
    targetId: id,
    metadata: { sopId },
    requestId,
  });

  return loadJobWithOutputs(actor.organizationId, sopId, id);
}

export async function listAiJobsForSop(actor: ManagerSessionContext, sopId: string) {
  await requireManageableSopForAi(actor, sopId);
  const jobs = await getDb()
    .select()
    .from(aiSopJobs)
    .where(and(eq(aiSopJobs.sopId, sopId), eq(aiSopJobs.organizationId, actor.organizationId)))
    .orderBy(desc(aiSopJobs.createdAt));
  const outputs =
    jobs.length > 0
      ? await getDb()
          .select()
          .from(aiSopJobOutputs)
          .where(eq(aiSopJobOutputs.organizationId, actor.organizationId))
          .orderBy(desc(aiSopJobOutputs.createdAt))
      : [];
  const outputsByJob = new Map<string, typeof outputs>();
  for (const output of outputs) {
    if (!jobs.some((job) => job.id === output.jobId)) continue;
    const list = outputsByJob.get(output.jobId) ?? [];
    list.push(output);
    outputsByJob.set(output.jobId, list);
  }
  return jobs.map((job) => ({ job, outputs: outputsByJob.get(job.id) ?? [] }));
}

export async function getAiJob(actor: ManagerSessionContext, sopId: string, jobId: string) {
  await requireManageableSopForAi(actor, sopId);
  return loadJobWithOutputs(actor.organizationId, sopId, jobId);
}

export async function retryAiJob(
  actor: ManagerSessionContext,
  sopId: string,
  jobId: string,
  requestId?: string,
) {
  const sop = await requireManageableSopForAi(actor, sopId);
  await runRetryAiSopJob(jobId, actor.organizationId);
  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: sop.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "ai_sop_job.retried",
    targetType: "ai_sop_job",
    targetId: jobId,
    requestId,
  });
  return loadJobWithOutputs(actor.organizationId, sopId, jobId);
}

export async function regenerateAiJobDraft(
  actor: ManagerSessionContext,
  sopId: string,
  jobId: string,
  requestId?: string,
) {
  const sop = await requireManageableSopForAi(actor, sopId);
  await runRegenerateAiSopJobDraft(jobId, actor.organizationId);
  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: sop.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "ai_sop_job.regenerated",
    targetType: "ai_sop_job",
    targetId: jobId,
    requestId,
  });
  return loadJobWithOutputs(actor.organizationId, sopId, jobId);
}

/**
 * A manager's explicit "use this draft" action — the only code path in this whole feature that
 * writes AI content onto the SOP's editable draft, and it still never publishes anything (see
 * `applyAiDraftToSopDraft`'s own comment). Re-validates the stored output against the schema
 * version it was recorded with before applying it, rather than trusting the jsonb column's
 * contents outright, even though it can only have gotten there by already passing that same
 * validation once.
 */
export async function applyAiJobOutput(
  actor: ManagerSessionContext,
  sopId: string,
  jobId: string,
  outputId: string,
  requestId?: string,
) {
  const sop = await requireManageableSopForAi(actor, sopId);
  const [output] = await getDb()
    .select()
    .from(aiSopJobOutputs)
    .where(
      and(
        eq(aiSopJobOutputs.id, outputId),
        eq(aiSopJobOutputs.jobId, jobId),
        eq(aiSopJobOutputs.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!output) throw new AppError("NOT_FOUND", "Generated draft not found.");
  if (output.acceptanceState !== "pending") {
    throw new AppError("CONFLICT", "This generated draft was already applied or dismissed.");
  }
  const draft = parseAiDraftedSop(output.schemaVersion, output.structuredDraft);

  await applyAiDraftToSopDraft(actor, sopId, draft, requestId);
  await getDb()
    .update(aiSopJobOutputs)
    .set({
      acceptanceState: "applied",
      appliedAt: new Date(),
      appliedByManagerUserId: actor.managerUserId,
    })
    .where(eq(aiSopJobOutputs.id, outputId));

  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: sop.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "ai_sop_job.output_applied",
    targetType: "ai_sop_job",
    targetId: jobId,
    requestId,
  });

  return loadJobWithOutputs(actor.organizationId, sopId, jobId);
}

export async function dismissAiJobOutput(
  actor: ManagerSessionContext,
  sopId: string,
  jobId: string,
  outputId: string,
  requestId?: string,
) {
  const sop = await requireManageableSopForAi(actor, sopId);
  const [output] = await getDb()
    .select()
    .from(aiSopJobOutputs)
    .where(
      and(
        eq(aiSopJobOutputs.id, outputId),
        eq(aiSopJobOutputs.jobId, jobId),
        eq(aiSopJobOutputs.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!output) throw new AppError("NOT_FOUND", "Generated draft not found.");
  if (output.acceptanceState !== "pending") {
    throw new AppError("CONFLICT", "This generated draft was already applied or dismissed.");
  }
  await getDb()
    .update(aiSopJobOutputs)
    .set({ acceptanceState: "dismissed" })
    .where(eq(aiSopJobOutputs.id, outputId));

  await writeAuditEvent({
    organizationId: actor.organizationId,
    locationId: sop.locationId,
    actorKind: "manager",
    actorId: actor.managerUserId,
    action: "ai_sop_job.output_dismissed",
    targetType: "ai_sop_job",
    targetId: jobId,
    requestId,
  });

  return loadJobWithOutputs(actor.organizationId, sopId, jobId);
}
