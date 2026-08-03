import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { trainingConfigUpdateSchema } from "@/server/sops/schemas";
import { getTrainingConfigDraft, updateTrainingConfig } from "@/server/sops/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sopId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { sopId } = await params;
    return successResponse(await getTrainingConfigDraft(actor, sopId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sopId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(trainingConfigUpdateSchema, await readJson(request));
    const { sopId } = await params;
    return successResponse(await updateTrainingConfig(actor, sopId, input, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
