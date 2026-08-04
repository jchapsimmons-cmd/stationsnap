import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { checklistUpdateSchema } from "@/server/checklists/schemas";
import { getChecklistDetail, updateChecklist } from "@/server/checklists/service";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ checklistId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    const actor = await requireManager(context.requestId);
    const { checklistId } = await params;
    return successResponse(await getChecklistDetail(actor, checklistId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ checklistId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(checklistUpdateSchema, await readJson(request));
    const { checklistId } = await params;
    return successResponse(await updateChecklist(actor, checklistId, input, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
