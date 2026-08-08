import { errorResponse, successResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { getAiJob } from "@/server/sops/ai-jobs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sopId: string; jobId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { sopId, jobId } = await params;
    return successResponse(await getAiJob(actor, sopId, jobId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
