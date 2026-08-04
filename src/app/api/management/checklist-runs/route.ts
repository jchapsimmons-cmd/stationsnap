import { errorResponse, successResponse } from "@/lib/api-response";
import { parseInput } from "@/lib/validation";
import { checklistRunQuerySchema } from "@/server/checklists/schemas";
import { listChecklistRuns } from "@/server/checklists/runs";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";

export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const url = new URL(request.url);
    const input = parseInput(checklistRunQuerySchema, {
      locationId: url.searchParams.get("locationId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    return successResponse(await listChecklistRuns(actor, input));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
