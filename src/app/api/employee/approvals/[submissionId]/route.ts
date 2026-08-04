import { errorResponse, successResponse } from "@/lib/api-response";
import { requireEmployee } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { getEmployeeCorrectionDetail } from "@/server/training/approvals";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const session = await requireEmployee(context.requestId);
    const { submissionId } = await params;
    return successResponse(await getEmployeeCorrectionDetail(session, submissionId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
