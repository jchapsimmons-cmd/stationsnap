import { errorResponse, successResponse } from "@/lib/api-response";
import { requireEmployee } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { markEmployeeNotificationRead } from "@/server/notifications/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ notificationId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const session = await requireEmployee(context.requestId);
    const { notificationId } = await params;
    await markEmployeeNotificationRead(session, notificationId);
    return successResponse({ id: notificationId });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
