import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { managerLocationAssignmentSchema } from "@/server/management/schemas";
import { setManagerLocationAssignments } from "@/server/management/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(managerLocationAssignmentSchema, await readJson(request));
    const { membershipId } = await params;
    return successResponse(
      await setManagerLocationAssignments(
        actor,
        membershipId,
        input.locationIds,
        context.requestId,
      ),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
