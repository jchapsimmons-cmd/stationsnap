import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { decideApprovalSubmission } from "@/server/training/approvals";
import { approvalDecisionSchema } from "@/server/training/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(approvalDecisionSchema, await readJson(request));
    const { submissionId } = await params;
    return successResponse(
      await decideApprovalSubmission(actor, submissionId, input, context.requestId),
      { status: 201 },
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
