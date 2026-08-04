import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { parseInput } from "@/lib/validation";
import { decideChecklistRun } from "@/server/checklists/approvals";
import { checklistApprovalDecisionSchema } from "@/server/checklists/schemas";
import { requireManager } from "@/server/auth/authorization";
import { assertSameOrigin, getRequestFingerprint } from "@/server/auth/request-security";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const context = getRequestFingerprint(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManager(context.requestId);
    const input = parseInput(checklistApprovalDecisionSchema, await readJson(request));
    const { runId } = await params;
    return successResponse(await decideChecklistRun(actor, runId, input, context.requestId), {
      status: 201,
    });
  } catch (error: unknown) {
    return errorResponse(error, context.requestId);
  }
}
