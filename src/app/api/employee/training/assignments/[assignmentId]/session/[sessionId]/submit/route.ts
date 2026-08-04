import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireEmployee } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { trainingSessionSubmitSchema } from "@/server/training/schemas";
import { submitSession } from "@/server/training/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string; sessionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const session = await requireEmployee(context.requestId);
    const input = parseInput(trainingSessionSubmitSchema, await readJson(request));
    const { assignmentId, sessionId } = await params;
    return successResponse(
      await submitSession(
        session,
        assignmentId,
        sessionId,
        input.expectedRevision,
        context.requestId,
      ),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
