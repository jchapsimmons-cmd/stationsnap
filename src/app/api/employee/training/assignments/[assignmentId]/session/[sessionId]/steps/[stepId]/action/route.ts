import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireEmployee } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { trainingStepActionSchema } from "@/server/training/schemas";
import { recordStepAction } from "@/server/training/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string; sessionId: string; stepId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const session = await requireEmployee(context.requestId);
    const input = parseInput(trainingStepActionSchema, await readJson(request));
    const { assignmentId, sessionId, stepId } = await params;
    return successResponse(
      await recordStepAction(
        session,
        assignmentId,
        sessionId,
        stepId,
        input.action,
        input.expectedRevision,
        context.requestId,
      ),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
