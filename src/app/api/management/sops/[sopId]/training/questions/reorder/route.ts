import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { trainingQuestionReorderSchema } from "@/server/sops/schemas";
import { reorderTrainingQuestions } from "@/server/sops/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sopId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(trainingQuestionReorderSchema, await readJson(request));
    const { sopId } = await params;
    return successResponse(
      await reorderTrainingQuestions(
        actor,
        sopId,
        input.stepId,
        input.orderedQuestionIds,
        input.expectedRevision,
        context.requestId,
      ),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
