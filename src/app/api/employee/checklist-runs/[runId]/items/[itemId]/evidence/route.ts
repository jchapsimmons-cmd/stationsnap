import { errorResponse, successResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { submitItemEvidence } from "@/server/checklists/runs";
import { checklistItemEvidenceUploadFormSchema } from "@/server/checklists/schemas";
import { requireEmployee } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { IMAGE_MAX_BYTES } from "@/server/storage/constants";

const REQUEST_CEILING_BYTES = IMAGE_MAX_BYTES + 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; itemId: string }> },
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
    const input = parseInput(checklistItemEvidenceUploadFormSchema, {
      employeeNote: formData.get("employeeNote") ?? "",
      expectedRevision: formData.get("expectedRevision"),
    });
    const { runId, itemId } = await params;
    return successResponse(
      await submitItemEvidence(session, runId, itemId, formData, input, context.requestId),
      { status: 201 },
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
