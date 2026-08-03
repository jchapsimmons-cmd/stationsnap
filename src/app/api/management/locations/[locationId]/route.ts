import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { locationUpdateSchema } from "@/server/management/schemas";
import { updateLocation } from "@/server/management/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ locationId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(locationUpdateSchema, await readJson(request));
    const { locationId } = await params;
    return successResponse(await updateLocation(actor, locationId, input, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
