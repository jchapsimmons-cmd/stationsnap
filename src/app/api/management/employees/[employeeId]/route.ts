import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";
import { employeeUpdateSchema } from "@/server/management/schemas";
import { updateEmployee } from "@/server/management/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(employeeUpdateSchema, await readJson(request));
    const { employeeId } = await params;
    return successResponse(await updateEmployee(actor, employeeId, input, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
