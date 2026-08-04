import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { checklistItemNoteSchema } from "@/server/checklists/schemas";
import { saveItemNote } from "@/server/checklists/runs";
import { requireEmployee } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string; itemId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const session = await requireEmployee(context.requestId);
    const input = parseInput(checklistItemNoteSchema, await readJson(request));
    const { runId, itemId } = await params;
    return successResponse(await saveItemNote(session, runId, itemId, input, context.requestId));
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
