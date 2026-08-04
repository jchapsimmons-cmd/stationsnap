import { errorResponse, successResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { approveTranslation } from "@/server/sops/translations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sopId: string; translationId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const { sopId, translationId } = await params;
    return successResponse(
      await approveTranslation(actor, sopId, translationId, context.requestId),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
