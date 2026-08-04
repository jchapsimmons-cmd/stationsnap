import { errorResponse, successResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { requireEmployee } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { VIDEO_MAX_BYTES } from "@/server/storage/constants";
import { resubmitCorrection } from "@/server/training/approvals";
import { approvalResubmitFormSchema } from "@/server/training/schemas";

const REQUEST_CEILING_BYTES = VIDEO_MAX_BYTES + 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const session = await requireEmployee(context.requestId);
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > REQUEST_CEILING_BYTES) {
      throw new AppError("BAD_REQUEST", "The upload exceeds the allowed size.");
    }
    const formData = await request.formData();
    const input = parseInput(approvalResubmitFormSchema, {
      stepId: formData.get("stepId"),
      employeeNote: formData.get("employeeNote") ?? "",
      expectedRevision: formData.get("expectedRevision"),
    });
    const { submissionId } = await params;
    return successResponse(
      await resubmitCorrection(session, submissionId, formData, input, context.requestId),
      { status: 201 },
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
