import { errorResponse, successResponse } from "@/lib/api-response";
import { requireEmployee } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { getSessionState } from "@/server/training/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string; sessionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const session = await requireEmployee(context.requestId);
    const { assignmentId, sessionId } = await params;
    return successResponse(await getSessionState(session, assignmentId, sessionId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
