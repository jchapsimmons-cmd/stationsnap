import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { trainingPathCreateSchema, trainingPathQuerySchema } from "@/server/training/paths-schemas";
import { createPath, listPaths } from "@/server/training/qualifications";

export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const url = new URL(request.url);
    const input = parseInput(trainingPathQuerySchema, {
      locationId: url.searchParams.get("locationId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    return successResponse(await listPaths(actor, input));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}

export async function POST(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(trainingPathCreateSchema, await readJson(request));
    return successResponse(await createPath(actor, input, context.requestId), { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
