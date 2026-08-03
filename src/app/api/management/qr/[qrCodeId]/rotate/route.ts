import { errorResponse, successResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { rotateQrCode } from "@/server/qr/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ qrCodeId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const { qrCodeId } = await params;
    return successResponse(await rotateQrCode(actor, qrCodeId, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
