import { errorResponse, successResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { regenerateAiJobDraft } from "@/server/sops/ai-jobs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sopId: string; jobId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const { sopId, jobId } = await params;
    return successResponse(await regenerateAiJobDraft(actor, sopId, jobId, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
