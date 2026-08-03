import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { AppError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { sopRevisionOnlySchema, sopStepUpdateSchema } from "@/server/sops/schemas";
import { deleteStep, updateStep } from "@/server/sops/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sopId: string; stepId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(sopStepUpdateSchema, await readJson(request));
    const { sopId, stepId } = await params;
    return successResponse(await updateStep(actor, sopId, stepId, input, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sopId: string; stepId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const revisionParam = new URL(request.url).searchParams.get("expectedRevision");
    if (!revisionParam) throw new AppError("BAD_REQUEST", "expectedRevision is required.");
    const input = parseInput(sopRevisionOnlySchema, { expectedRevision: revisionParam });
    const { sopId, stepId } = await params;
    return successResponse(
      await deleteStep(actor, sopId, stepId, input.expectedRevision, context.requestId),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
