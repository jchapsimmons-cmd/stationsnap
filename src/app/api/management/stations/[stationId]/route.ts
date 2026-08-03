import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { stationUpdateSchema } from "@/server/management/schemas";
import { updateStation } from "@/server/management/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ stationId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(stationUpdateSchema, await readJson(request));
    const { stationId } = await params;
    return successResponse(await updateStation(actor, stationId, input, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
