import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte, or, isNull } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import {
  AI_DRAFT_SCHEMA_VERSION,
  AiDraftSchemaValidationError,
  parseAiDraftedSop,
} from "@/server/ai/draft-schema";
import {
  AiProviderError,
  claudeDraftingProvider,
  whisperTranscriptionProvider,
} from "@/server/ai/providers";
import type { DraftingProvider, TranscriptionProvider } from "@/server/ai/types";
import { getDb } from "@/server/db/client";
import { aiSopJobOutputs, aiSopJobs, files, sopVersions, sops } from "@/server/db/schema";
import { readStoredObject } from "@/server/storage/driver";

/**
 * The claimable statuses: everything short of the two terminal states. A job in `upload_received`
 * or `transcribing` needs the transcription step attempted; a job in `drafting` needs the drafting
 * step attempted. See the module-level comment below for the full state machine.
 */
const CLAIMABLE_STATUSES = ["upload_received", "transcribing", "drafting"] as const;

/** Long enough to comfortably cover one real Whisper + Claude HTTP round trip; short enough that a
 * genuinely crashed invocation (the lease holder died before writing back a result) frees the job
 * up again within a handful of 1-minute cron ticks rather than stalling it indefinitely. */
const LEASE_MS = 5 * 60_000;

/** Exponential backoff between step attempts, capped at 15 minutes. Vercel Cron's minimum
 * granularity is 1 minute, so the first backoff (60s) is already the smallest meaningful delay.
 * Exported for its own focused unit test; every other function here needs a real database. */
export function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}

/** Canned, secret-free messages keyed by error code — the same "no raw provider error text in a
 * stored record" rule `notification_deliveries.errorCode` already follows. Never store `error.message`
 * from a caught exception verbatim; it could echo back a URL, header, or environment fragment. */
const SAFE_ERROR_MESSAGES: Record<string, string> = {
  provider_not_configured: "The AI provider is not configured.",
  transcription_unreachable: "The transcription service could not be reached.",
  transcription_failed: "The transcription attempt failed.",
  transcription_invalid_response: "The transcription service returned an unusable response.",
  draft_unreachable: "The drafting service could not be reached.",
  draft_generation_failed: "The drafting attempt failed.",
  draft_invalid_response: "The drafting service returned an unusable response.",
  draft_invalid_json: "The drafting service response was not valid JSON.",
  schema_validation_failed: "The AI-generated draft did not match the expected structure.",
  source_file_unavailable: "The source video is no longer available.",
  unknown_error: "An unexpected error occurred.",
};

function safeMessageForCode(code: string): string {
  return SAFE_ERROR_MESSAGES[code] ?? SAFE_ERROR_MESSAGES["unknown_error"]!;
}

function codeForError(error: unknown): string {
  if (error instanceof AiDraftSchemaValidationError) return "schema_validation_failed";
  if (error instanceof AiProviderError) return error.code;
  return "unknown_error";
}

export interface AiJobRunnerDeps {
  transcription: TranscriptionProvider;
  drafting: DraftingProvider;
}

/** Production wiring: the real, paid providers. Never imported by a test — tests always pass an
 * explicit `deps` built from `@/server/ai/fakes` instead. */
export const productionAiJobRunnerDeps: AiJobRunnerDeps = {
  transcription: whisperTranscriptionProvider,
  drafting: claudeDraftingProvider,
};

type AiSopJobRow = typeof aiSopJobs.$inferSelect;

/**
 * Atomically claims exactly one eligible job: a non-terminal job whose next attempt is due and
 * whose previous lease (if any) has expired. `FOR UPDATE SKIP LOCKED` means two concurrent
 * invocations (an overlapping cron tick and a manual trigger, say) can never claim the same job —
 * the second one simply skips it and finds nothing (or the next job) instead of blocking. Setting
 * `claimedAt`/`leaseExpiresAt` here, in its own short transaction, is the whole claim; the actual
 * provider call happens afterward, outside any open transaction, so a slow network call never
 * holds a database lock.
 */
async function claimNextJob(now: Date): Promise<AiSopJobRow | null> {
  return getDb().transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(aiSopJobs)
      .where(
        and(
          inArray(aiSopJobs.status, CLAIMABLE_STATUSES),
          lte(aiSopJobs.nextAttemptAt, now),
          or(isNull(aiSopJobs.leaseExpiresAt), lte(aiSopJobs.leaseExpiresAt, now)),
        ),
      )
      .orderBy(asc(aiSopJobs.nextAttemptAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;

    const [claimed] = await tx
      .update(aiSopJobs)
      .set({ claimedAt: now, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now })
      .where(eq(aiSopJobs.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

async function recordStepFailure(
  job: AiSopJobRow,
  step: "transcribing" | "drafting",
  error: unknown,
  now: Date,
): Promise<void> {
  const attempts = job.stepAttempts + 1;
  const code = codeForError(error);
  const message = safeMessageForCode(code);
  if (attempts >= job.maxStepAttempts) {
    await getDb()
      .update(aiSopJobs)
      .set({
        status: "failed",
        failedStep: step,
        stepAttempts: attempts,
        lastErrorCode: code,
        lastErrorMessage: message,
        claimedAt: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(aiSopJobs.id, job.id));
    return;
  }
  await getDb()
    .update(aiSopJobs)
    .set({
      status: step,
      stepAttempts: attempts,
      lastErrorCode: code,
      lastErrorMessage: message,
      claimedAt: null,
      leaseExpiresAt: null,
      nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
      updatedAt: now,
    })
    .where(eq(aiSopJobs.id, job.id));
}

async function runTranscriptionStep(
  job: AiSopJobRow,
  deps: AiJobRunnerDeps,
  now: Date,
): Promise<void> {
  if (job.status === "upload_received") {
    await getDb()
      .update(aiSopJobs)
      .set({ status: "transcribing", updatedAt: now })
      .where(eq(aiSopJobs.id, job.id));
  }
  try {
    const [file] = await getDb()
      .select()
      .from(files)
      .where(and(eq(files.id, job.sourceFileId), eq(files.organizationId, job.organizationId)))
      .limit(1);
    if (!file || file.status !== "ready") {
      throw new AiProviderError("source_file_unavailable", "The source video is unavailable.");
    }
    const buffer = await readStoredObject(file.objectKey);
    const result = await deps.transcription.transcribe({
      buffer,
      mimeType: file.mimeType,
      fileName: file.originalName,
    });
    await getDb()
      .update(aiSopJobs)
      .set({
        status: "drafting",
        transcript: result.text,
        transcriptProvider: result.provider,
        transcriptModel: result.model,
        stepAttempts: 0,
        lastErrorCode: "",
        lastErrorMessage: "",
        claimedAt: null,
        leaseExpiresAt: null,
        nextAttemptAt: now,
        updatedAt: now,
      })
      .where(eq(aiSopJobs.id, job.id));
  } catch (error: unknown) {
    await recordStepFailure(job, "transcribing", error, now);
  }
}

async function runDraftingStep(job: AiSopJobRow, deps: AiJobRunnerDeps, now: Date): Promise<void> {
  try {
    const [versionRow] = await getDb()
      .select({ title: sopVersions.title })
      .from(sops)
      .innerJoin(
        sopVersions,
        and(
          eq(sopVersions.id, sops.currentVersionId),
          eq(sopVersions.organizationId, sops.organizationId),
        ),
      )
      .where(and(eq(sops.id, job.sopId), eq(sops.organizationId, job.organizationId)))
      .limit(1);
    const result = await deps.drafting.draftSop({
      transcript: job.transcript,
      sourceTitleHint: versionRow?.title ?? "",
    });
    const parsed = parseAiDraftedSop(AI_DRAFT_SCHEMA_VERSION, result.raw);

    await getDb().transaction(async (tx) => {
      await tx
        .update(aiSopJobs)
        .set({
          status: "ready",
          draftProvider: result.provider,
          draftModel: result.model,
          draftSchemaVersion: AI_DRAFT_SCHEMA_VERSION,
          stepAttempts: 0,
          lastErrorCode: "",
          lastErrorMessage: "",
          claimedAt: null,
          leaseExpiresAt: null,
          readyAt: now,
          updatedAt: now,
        })
        .where(eq(aiSopJobs.id, job.id));
      await tx.insert(aiSopJobOutputs).values({
        id: randomUUID(),
        jobId: job.id,
        organizationId: job.organizationId,
        schemaVersion: AI_DRAFT_SCHEMA_VERSION,
        structuredDraft: parsed,
        acceptanceState: "pending",
        provenance: { provider: result.provider, model: result.model },
      });
    });
  } catch (error: unknown) {
    await recordStepFailure(job, "drafting", error, now);
  }
}

export type AdvanceOutcome =
  { claimed: false } | { claimed: true; jobId: string; status: AiSopJobRow["status"] };

/**
 * The cron entry point: claims and advances exactly one job's one step, then returns. Never loops,
 * never processes more than one job — a single Vercel Cron invocation calling this once is exactly
 * "one job's one step advanced," matching the job-runner decision in
 * docs/implementation-plan.md. Callers needing to drain a backlog for tests call this in their own
 * loop instead of this function looping internally.
 */
export async function advanceOneAiSopJobStep(
  deps: AiJobRunnerDeps = productionAiJobRunnerDeps,
  now: Date = new Date(),
): Promise<AdvanceOutcome> {
  const claimed = await claimNextJob(now);
  if (!claimed) return { claimed: false };

  if (claimed.status === "upload_received" || claimed.status === "transcribing") {
    await runTranscriptionStep(claimed, deps, now);
  } else {
    await runDraftingStep(claimed, deps, now);
  }

  const [final] = await getDb()
    .select({ status: aiSopJobs.status })
    .from(aiSopJobs)
    .where(eq(aiSopJobs.id, claimed.id))
    .limit(1);
  return { claimed: true, jobId: claimed.id, status: final?.status ?? claimed.status };
}

/** Resumes a permanently `failed` job at the step it failed on, clearing the failure record and
 * making it immediately claimable again. Never resets the transcript: a job that failed during
 * drafting keeps its already-transcribed text and retries drafting only, never re-transcribing
 * (and never re-billing Whisper for a step that already succeeded). */
export async function retryAiSopJob(
  jobId: string,
  organizationId: string,
  now: Date = new Date(),
): Promise<void> {
  const [job] = await getDb()
    .select()
    .from(aiSopJobs)
    .where(and(eq(aiSopJobs.id, jobId), eq(aiSopJobs.organizationId, organizationId)))
    .limit(1);
  if (!job) throw new AppError("NOT_FOUND", "AI job not found.");
  if (job.status !== "failed") {
    throw new AppError("CONFLICT", "Only a failed job can be retried.");
  }
  const resumeStatus = job.failedStep ?? "transcribing";
  await getDb()
    .update(aiSopJobs)
    .set({
      status: resumeStatus,
      failedStep: null,
      stepAttempts: 0,
      lastErrorCode: "",
      lastErrorMessage: "",
      claimedAt: null,
      leaseExpiresAt: null,
      nextAttemptAt: now,
      updatedAt: now,
    })
    .where(eq(aiSopJobs.id, jobId));
}

/** Re-runs only the drafting step against the already-stored transcript (single-step
 * regeneration): a manager unhappy with the generated draft can ask for another attempt without
 * paying for a fresh transcription. Adds a brand new `ai_sop_job_outputs` row on success; earlier
 * outputs are never deleted or overwritten. */
export async function regenerateAiSopJobDraft(
  jobId: string,
  organizationId: string,
  now: Date = new Date(),
): Promise<void> {
  const [job] = await getDb()
    .select()
    .from(aiSopJobs)
    .where(and(eq(aiSopJobs.id, jobId), eq(aiSopJobs.organizationId, organizationId)))
    .limit(1);
  if (!job) throw new AppError("NOT_FOUND", "AI job not found.");
  if (job.status !== "ready" && job.status !== "failed") {
    throw new AppError("CONFLICT", "Only a ready or failed job can be regenerated.");
  }
  if (!job.transcript.trim()) {
    throw new AppError("CONFLICT", "This job has no transcript to draft from yet.");
  }
  await getDb()
    .update(aiSopJobs)
    .set({
      status: "drafting",
      failedStep: null,
      stepAttempts: 0,
      lastErrorCode: "",
      lastErrorMessage: "",
      claimedAt: null,
      leaseExpiresAt: null,
      readyAt: null,
      nextAttemptAt: now,
      updatedAt: now,
    })
    .where(eq(aiSopJobs.id, jobId));
}
