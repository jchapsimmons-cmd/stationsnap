import { errorResponse, successResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { markManagerNotificationRead } from "@/server/notifications/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ notificationId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const { notificationId } = await params;
    await markManagerNotificationRead(actor, notificationId);
    return successResponse({ id: notificationId });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
