import { errorResponse, successResponse } from "@/lib/api-response";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { qualificationOverviewQuerySchema } from "@/server/training/paths-schemas";
import { listQualificationsOverview } from "@/server/training/qualifications";

export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const url = new URL(request.url);
    const input = parseInput(qualificationOverviewQuerySchema, {
      locationId: url.searchParams.get("locationId") ?? undefined,
      tab: url.searchParams.get("tab") ?? undefined,
    });
    return successResponse(await listQualificationsOverview(actor, input));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
