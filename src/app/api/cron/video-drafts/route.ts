import { errorResponse, successResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { getServerEnv } from "@/lib/env";
import { writeAuditEvent } from "@/server/audit";
import { advanceOneAiSopJobStep } from "@/server/jobs/ai-sop-job-runner";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron's endpoint for the video-to-draft job runner (see `vercel.json`'s `crons` entry).
 * Vercel issues a GET request with `Authorization: Bearer <CRON_SECRET>` on schedule; this route
 * verifies that header against `CRON_SECRET` from `src/lib/env.ts` before doing anything else and
 * rejects with 401 otherwise — the same "authenticate before any work" shape every other guarded
 * route in this app follows, just with a shared secret instead of a session cookie. On success it
 * claims and advances exactly one `ai_sop_jobs` row's one step (see
 * `src/server/jobs/ai-sop-job-runner.ts`) and returns — this route is intentionally cheap and
 * idempotent-per-tick; the schedule interval, not this handler, is what drains a backlog over
 * time.
 */
function verifyCronAuthorization(request: Request): void {
  const configuredSecret = getServerEnv().CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!configuredSecret || header !== `Bearer ${configuredSecret}`) {
    throw new AppError("UNAUTHENTICATED", "Cron authorization failed.");
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    verifyCronAuthorization(request);
  } catch (error: unknown) {
    await writeAuditEvent({
      actorKind: "anonymous",
      action: "cron.unauthorized",
      targetType: "cron_route",
      targetId: "video-drafts",
    }).catch(() => undefined);
    return errorResponse(error);
  }

  try {
    const outcome = await advanceOneAiSopJobStep();
    return successResponse(outcome);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
