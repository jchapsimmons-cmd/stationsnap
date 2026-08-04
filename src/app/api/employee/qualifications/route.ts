import { errorResponse, successResponse } from "@/lib/api-response";
import { requireEmployee } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { listQualificationsForEmployee } from "@/server/training/qualifications";

export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const session = await requireEmployee(context.requestId);
    return successResponse(await listQualificationsForEmployee(session));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
