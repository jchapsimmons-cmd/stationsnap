import { errorResponse, successResponse } from "@/lib/api-response";
import { getChecklistRunDetail } from "@/server/checklists/runs";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { runId } = await params;
    return successResponse(await getChecklistRunDetail(actor, runId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
