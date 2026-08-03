import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { AppError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { sopRevisionOnlySchema, trainingQuestionUpdateSchema } from "@/server/sops/schemas";
import {
  deleteTrainingQuestion,
  getTrainingQuestion,
  updateTrainingQuestion,
} from "@/server/sops/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sopId: string; questionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { sopId, questionId } = await params;
    return successResponse(await getTrainingQuestion(actor, sopId, questionId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sopId: string; questionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(trainingQuestionUpdateSchema, await readJson(request));
    const { sopId, questionId } = await params;
    return successResponse(
      await updateTrainingQuestion(actor, sopId, questionId, input, context.requestId),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sopId: string; questionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const revisionParam = new URL(request.url).searchParams.get("expectedRevision");
    if (!revisionParam) throw new AppError("BAD_REQUEST", "expectedRevision is required.");
    const input = parseInput(sopRevisionOnlySchema, { expectedRevision: revisionParam });
    const { sopId, questionId } = await params;
    return successResponse(
      await deleteTrainingQuestion(
        actor,
        sopId,
        questionId,
        input.expectedRevision,
        context.requestId,
      ),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
