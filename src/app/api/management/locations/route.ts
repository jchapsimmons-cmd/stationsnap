import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { locationCreateSchema } from "@/server/management/schemas";
import { createLocation } from "@/server/management/service";

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(locationCreateSchema, await readJson(request));
    return successResponse(await createLocation(actor, input, context.requestId), { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
