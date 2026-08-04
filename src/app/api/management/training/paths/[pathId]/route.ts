import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { trainingPathUpdateSchema } from "@/server/training/paths-schemas";
import { getPathDetail, updatePath } from "@/server/training/qualifications";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ pathId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { pathId } = await params;
    return successResponse(await getPathDetail(actor, pathId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ pathId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(trainingPathUpdateSchema, await readJson(request));
    const { pathId } = await params;
    return successResponse(await updatePath(actor, pathId, input, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
