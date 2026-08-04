import { errorResponse, successResponse } from "@/lib/api-response";
import { getChecklistRunState } from "@/server/checklists/runs";
import { requireEmployee } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const session = await requireEmployee(context.requestId);
    const { runId } = await params;
    return successResponse(await getChecklistRunState(session, runId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
