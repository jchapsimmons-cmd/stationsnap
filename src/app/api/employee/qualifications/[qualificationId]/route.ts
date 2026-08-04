import { errorResponse, successResponse } from "@/lib/api-response";
import { requireEmployee } from "@/server/auth/authorization";
import { getRequestFingerprint } from "@/server/auth/request-security";
import { getQualificationDetailForEmployee } from "@/server/training/qualifications";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ qualificationId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const session = await requireEmployee(context.requestId);
    const { qualificationId } = await params;
    return successResponse(await getQualificationDetailForEmployee(session, qualificationId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
