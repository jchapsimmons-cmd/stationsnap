import { errorResponse, successResponse } from "@/lib/api-response";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { listApprovalQueue } from "@/server/training/approvals";
import { approvalQueueQuerySchema } from "@/server/training/schemas";

export async function GET(request: Request): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const url = new URL(request.url);
    const input = parseInput(approvalQueueQuerySchema, {
      status: url.searchParams.get("status") ?? undefined,
      locationId: url.searchParams.get("locationId") ?? undefined,
    });
    return successResponse(await listApprovalQueue(actor, input));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
