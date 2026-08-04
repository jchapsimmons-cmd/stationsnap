import { errorResponse, successResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { getApprovalSubmissionDetail } from "@/server/training/approvals";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const { submissionId } = await params;
    return successResponse(await getApprovalSubmissionDetail(actor, submissionId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
