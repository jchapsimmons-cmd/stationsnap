import { errorResponse, successResponse } from "@/lib/api-response";
import { startOrResumeRun } from "@/server/checklists/runs";
import { requireEmployee } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ checklistId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const session = await requireEmployee(context.requestId);
    const { checklistId } = await params;
    return successResponse(await startOrResumeRun(session, checklistId, context.requestId), {
      status: 201,
    });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
