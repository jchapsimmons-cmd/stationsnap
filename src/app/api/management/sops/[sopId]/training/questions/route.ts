import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { trainingQuestionCreateSchema } from "@/server/sops/schemas";
import { createTrainingQuestion, getTrainingQuestionsDraft } from "@/server/sops/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sopId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { sopId } = await params;
    return successResponse(await getTrainingQuestionsDraft(actor, sopId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sopId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(trainingQuestionCreateSchema, await readJson(request));
    const { sopId } = await params;
    return successResponse(await createTrainingQuestion(actor, sopId, input, context.requestId), {
      status: 201,
    });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
