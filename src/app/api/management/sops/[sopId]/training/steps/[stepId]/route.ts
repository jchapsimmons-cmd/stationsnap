import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { stepTrainingRequirementsSchema } from "@/server/sops/schemas";
import { updateStepTrainingRequirements } from "@/server/sops/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sopId: string; stepId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(stepTrainingRequirementsSchema, await readJson(request));
    const { sopId, stepId } = await params;
    return successResponse(
      await updateStepTrainingRequirements(actor, sopId, stepId, input, context.requestId),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
