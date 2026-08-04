import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireEmployee } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { trainingAnswerSubmitSchema } from "@/server/training/schemas";
import { submitAnswer } from "@/server/training/service";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string; sessionId: string; questionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const session = await requireEmployee(context.requestId);
    const input = parseInput(trainingAnswerSubmitSchema, await readJson(request));
    const { assignmentId, sessionId, questionId } = await params;
    return successResponse(
      await submitAnswer(
        session,
        assignmentId,
        sessionId,
        questionId,
        input.selectedChoiceIds,
        input.expectedRevision,
        context.requestId,
      ),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
