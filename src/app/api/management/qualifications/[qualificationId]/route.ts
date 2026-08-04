import { errorResponse, successResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { getQualificationDetail } from "@/server/training/qualifications";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ qualificationId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { qualificationId } = await params;
    return successResponse(await getQualificationDetail(actor, qualificationId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
