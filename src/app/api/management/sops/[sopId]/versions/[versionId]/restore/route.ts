import { errorResponse, successResponse } from "@/lib/api-response";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { restoreSopVersion } from "@/server/sops/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sopId: string; versionId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const { sopId, versionId } = await params;
    return successResponse(await restoreSopVersion(actor, sopId, versionId, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
