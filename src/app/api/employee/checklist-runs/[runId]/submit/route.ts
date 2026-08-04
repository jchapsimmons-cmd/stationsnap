import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { checklistRunSubmitSchema } from "@/server/checklists/schemas";
import { submitChecklistRun } from "@/server/checklists/runs";
import { requireEmployee } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const session = await requireEmployee(context.requestId);
    const input = parseInput(checklistRunSubmitSchema, await readJson(request));
    const { runId } = await params;
    return successResponse(
      await submitChecklistRun(session, runId, input.expectedRevision, context.requestId),
    );
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
