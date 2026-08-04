import { errorResponse, successResponse } from "@/lib/api-response";
import { requireEmployee } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { getAssignmentDetail } from "@/server/training/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const session = await requireEmployee(context.requestId);
    const { assignmentId } = await params;
    return successResponse(await getAssignmentDetail(session, assignmentId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
